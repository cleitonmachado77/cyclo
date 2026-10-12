import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { AnalysisEta } from "@/lib/analysis-eta";
import { formatClock, parseClock } from "@/lib/clock";
import { toUserMessage } from "@/lib/errors";
import { formatBytes } from "@/lib/format";
import { analyzeVideoSegment } from "@/lib/gemini-segment";
import { stitchSegments, type SegmentSlice } from "@/lib/segment-stitch";
import {
  cutSegment,
  inspectMedia,
  MAX_SEGMENT_BYTES,
  planSegmentWindows,
  proxyOutputPath,
  streamStorageToFile,
  TARGET_SEGMENT_SECONDS,
  transcodeProxy,
} from "@/lib/video-segments";
import type { Activity, VideoFile } from "@/types/activity";
import type { AnalysisItemResult, MonitorStage, MonitorStageStatus } from "@/types/pipeline";

type VideoProgress = {
  percent: number;
  message: string;
  detail?: string;
  stages: MonitorStage[];
  etaSeconds: number | null;
  segmentIndex?: number;
  segmentCount?: number;
};

const STAGE_LABELS = [
  ["download", "Baixar vídeo"],
  ["proxy", "Gerar proxy 720p"],
  ["split", "Fatiar em trechos"],
  ["analyze", "Analisar trechos"],
  ["stitch", "Costurar linha do tempo"],
] as const;

type StageId = (typeof STAGE_LABELS)[number][0];

export async function analyzeStoredVideo(input: {
  activity: Activity;
  video: VideoFile;
  eta: AnalysisEta;
  videosAfter: number;
  onProgress: (event: VideoProgress) => void;
  onCheckpoint?: (result: AnalysisItemResult) => Promise<void>;
}): Promise<AnalysisItemResult> {
  const workDir = path.join(os.tmpdir(), `cyclo-${input.video.id}-${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });
  const sourcePath = path.join(workDir, "source.mp4");
  let proxySkipped = false;

  const report = (active: StageId, percent: number, message: string, detail?: string, segment?: { index: number; count: number }) => {
    const remaining = segment ? Math.max(0, segment.count - (segment.index - 1)) : 0;
    input.onProgress({
      percent,
      message,
      detail,
      stages: buildStages(active, proxySkipped, detail),
      etaSeconds: input.eta.estimate(remaining, segment ? input.videosAfter : input.videosAfter + 1),
      segmentIndex: segment?.index,
      segmentCount: segment?.count,
    });
  };

  try {
    input.eta.beginPrep();
    report("download", 4, "Baixando vídeo para análise", input.video.originalName);
    await streamStorageToFile(input.video.storagePath, sourcePath, (loaded, total) => {
      const percent = total ? Math.round((loaded / total) * 100) : undefined;
      report(
        "download",
        4 + Math.round(((percent || 0) / 100) * 8),
        "Baixando vídeo para análise",
        total ? `${formatBytes(loaded)} de ${formatBytes(total)}` : formatBytes(loaded),
      );
    });

    const source = await inspectMedia(sourcePath);
    const needsProxy = source.bytes > MAX_SEGMENT_BYTES;
    const needsSplit = source.durationSeconds > TARGET_SEGMENT_SECONDS || needsProxy;
    let mediaPath = sourcePath;
    let media = source;

    if (!needsProxy) {
      proxySkipped = true;
    } else {
      const proxyPath = proxyOutputPath(workDir);
      report("proxy", 14, "Gerando proxy 720p", "Reduz o arquivo sem cortar a duração");
      await transcodeProxy(sourcePath, proxyPath, source.durationSeconds, (percent) => {
        report("proxy", 14 + Math.round(percent * 0.14), "Gerando proxy 720p", `${percent}% do proxy`);
      });
      mediaPath = proxyPath;
      media = await inspectMedia(proxyPath);
      report("proxy", 28, "Proxy pronto", formatBytes(media.bytes));
    }

    const windows = needsSplit || media.bytes > MAX_SEGMENT_BYTES ? planSegmentWindows(media.durationSeconds, media.bytes) : [
      { index: 0, startSeconds: 0, endSeconds: media.durationSeconds, overlapSeconds: 0 },
    ];
    input.eta.rememberPlan(windows.length);
    input.eta.finishPrep();
    report("split", 30, `Vídeo dividido em ${windows.length} trecho(s)`, `${formatClock(media.durationSeconds)} no total`, {
      index: 0,
      count: windows.length,
    });

    if (windows.length === 1 && media.bytes > MAX_SEGMENT_BYTES) {
      throw new Error("O vídeo continua acima de 50 MB depois da preparação e não pôde ser fatiado.");
    }

    const slices: SegmentSlice[] = [];
    let handoff = "";
    const singleFile = windows.length === 1 && media.bytes <= MAX_SEGMENT_BYTES;

    for (let index = 0; index < windows.length; index += 1) {
      const window = windows[index];
      const segmentPath = singleFile ? mediaPath : path.join(workDir, `part-${index + 1}.mp4`);
      const position = { index: index + 1, count: windows.length };
      input.eta.beginSegment();
      report(
        "analyze",
        32 + Math.round((index / windows.length) * 60),
        `Analisando trecho ${index + 1} de ${windows.length}`,
        `${formatClock(window.startSeconds)} – ${formatClock(window.endSeconds)}`,
        position,
      );

      try {
        if (!singleFile) {
          report("analyze", 32 + Math.round((index / windows.length) * 60), `Cortando trecho ${index + 1} de ${windows.length}`, input.video.originalName, position);
          await cutSegment(mediaPath, window, segmentPath);
        }

        const analysis = await analyzeVideoSegment({
          activity: { ...input.activity, videos: [input.video] },
          filePath: segmentPath,
          mimeType: mediaPath === sourcePath ? input.video.mimeType || "video/mp4" : "video/mp4",
          index,
          count: windows.length,
          startSeconds: window.startSeconds,
          endSeconds: window.endSeconds,
          overlapSeconds: window.overlapSeconds,
          handoff,
          onProgress: (message, detail) => {
            report("analyze", 34 + Math.round((index / windows.length) * 60), message, detail, position);
          },
        });

        slices.push({
          index,
          startSeconds: window.startSeconds,
          endSeconds: window.endSeconds,
          overlapSeconds: window.overlapSeconds,
          movements: analysis.movements,
          summary: analysis.summary,
          observations: analysis.observations,
          model: analysis.model,
        });
        handoff = latestMovement(analysis.movements);
      } catch (error) {
        const reason = toUserMessage(error, "Este trecho não pôde ser medido.");
        slices.push({
          index,
          startSeconds: window.startSeconds,
          endSeconds: window.endSeconds,
          overlapSeconds: window.overlapSeconds,
          movements: [],
          error: reason,
        });
        report("analyze", 34 + Math.round(((index + 1) / windows.length) * 60), `Trecho ${index + 1} ficou de fora`, reason, position);
      } finally {
        input.eta.finishSegment();
        if (!singleFile) await fs.unlink(segmentPath).catch(() => undefined);
      }

      await input.onCheckpoint?.(toItemResult(input.video, slices, windows.length));
    }

    report("stitch", 98, "Unindo a sequência do vídeo", input.video.originalName, {
      index: windows.length,
      count: windows.length,
    });
    return toItemResult(input.video, slices, windows.length);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function toItemResult(video: VideoFile, slices: SegmentSlice[], planned: number): AnalysisItemResult {
  const stitched = stitchSegments(slices);
  const notes = [
    `Linha do tempo unificada a partir de ${planned} trecho(s).`,
    stitched.gaps.length
      ? `Lacunas sem medição: ${stitched.gaps.map((gap) => `${gap.startTime}–${gap.endTime} (${gap.reason})`).join("; ")}.`
      : "",
    slices.map((slice) => slice.observations).find(Boolean) || "",
  ].filter(Boolean);

  const movements = stitched.movements.filter((movement) => movement.durationSeconds > 0);
  const leaves = movements.filter((movement) => !isRollupMovement(movement.name));
  return {
    videoId: video.id,
    fileName: video.originalName,
    summary: [...slices].reverse().find((slice) => slice.summary)?.summary || "Análise concluída em trechos.",
    movements,
    totalDurationSeconds: (leaves.length ? leaves : movements).reduce((sum, movement) => sum + movement.durationSeconds, 0),
    observations: notes.join(" "),
    model: stitched.models[0],
    gaps: stitched.gaps,
    segmentCount: planned,
  };
}

function isRollupMovement(name: string) {
  const key = name.trim().toLowerCase();
  return key === "ciclo completo" || key === "esteira de processo";
}

function latestMovement(movements: SegmentSlice["movements"]) {
  const timed = movements.filter((movement) => movement.status !== "not_found" && movement.durationSeconds > 0);
  const last = [...timed].sort((a, b) => parseClock(a.endTime) - parseClock(b.endTime)).at(-1);
  if (!last) return "";
  return `${last.name} até ${last.endTime} deste trecho (${last.status || "medido"})`;
}

function buildStages(active: StageId, proxySkipped: boolean, detail?: string): MonitorStage[] {
  const order = STAGE_LABELS.map(([id]) => id);
  const activeIndex = order.indexOf(active);
  return STAGE_LABELS.map(([id, label], index) => {
    let status: MonitorStageStatus = "pending";
    if (id === "proxy" && proxySkipped && index <= activeIndex) status = "skipped";
    else if (index < activeIndex) status = "done";
    else if (index === activeIndex) status = "active";
    return { id, label, status, detail: status === "active" ? detail : undefined };
  });
}
