import { promises as fs } from "fs";
import os from "os";
import path from "path";
import OpenAI from "openai";
import { buildAnalysisSystemPrompt } from "@/lib/analysis-prompt";
import { runFfmpeg } from "@/lib/media-tools";
import type { Activity, AnalysisResult, VideoAnalysis } from "@/types/activity";
import { downloadVideoToTemp } from "@/lib/store";

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const MAX_FRAMES = Number(process.env.OPENAI_MAX_FRAMES || 24);

export type OpenAIProgressEvent = {
  phase:
    | "starting"
    | "downloading"
    | "uploading_gemini"
    | "processing_gemini"
    | "analyzing"
    | "parsing"
    | "done"
    | "error";
  percent: number;
  message: string;
  detail?: string;
};

type ProgressCallback = (event: OpenAIProgressEvent) => void;

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || text.trim();
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("A resposta da OpenAI não contém JSON válido.");
  }
  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
}

function buildPrompt(activity: Activity, frameGuide: string) {
  return buildAnalysisSystemPrompt(
    activity,
    `Guia de frames (timestamp aproximado):\n${frameGuide}\nUse os timestamps dos frames para estimar início/fim.`,
  );
}

function formatTimestamp(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

async function extractFrames(videoPath: string, outputDir: string, maxFrames: number) {
  await fs.mkdir(outputDir, { recursive: true });
  const pattern = path.join(outputDir, "frame_%03d.jpg");

  // ~1 frame a cada 2s, limitado a maxFrames
  await runFfmpeg([
    "-y",
    "-i",
    videoPath,
    "-vf",
    "fps=1/2",
    "-frames:v",
    String(maxFrames),
    "-q:v",
    "3",
    pattern,
  ]);

  const files = (await fs.readdir(outputDir))
    .filter((name) => name.endsWith(".jpg"))
    .sort();

  return files.map((name, index) => ({
    path: path.join(outputDir, name),
    timestamp: formatTimestamp(index * 2),
    label: `${name} ≈ ${formatTimestamp(index * 2)}`,
  }));
}

function mapResult(rawText: string, activity: Activity): AnalysisResult {
  const parsed = extractJson(rawText) as {
    summary?: string;
    videos?: VideoAnalysis[];
  };

  const videos: VideoAnalysis[] = (parsed.videos ?? []).map((item, index) => {
    const source = activity.videos[index];
    const movements = Array.isArray(item.movements)
      ? item.movements.map((movement) => ({
          name: movement.name || "Movimento",
          status: movement.status,
          startTime: movement.startTime || "00:00",
          endTime: movement.endTime || "00:00",
          durationSeconds: Number(movement.durationSeconds) || 0,
          notes: movement.notes,
        }))
      : [];

    const computedTotal = movements
      .filter((movement) => movement.status !== "not_found")
      .reduce((sum, movement) => sum + (Number(movement.durationSeconds) || 0), 0);

    return {
      videoId: item.videoId || source?.id || `video-${index + 1}`,
      fileName: item.fileName || source?.originalName || `video-${index + 1}`,
      movements,
      totalDurationSeconds: Number(item.totalDurationSeconds) || computedTotal,
      observations: item.observations,
    };
  });

  return {
    analyzedAt: new Date().toISOString(),
    model: OPENAI_MODEL,
    summary: parsed.summary || "Análise concluída via OpenAI.",
    videos,
    rawText,
  };
}

export async function analyzeActivityVideosWithOpenAI(
  activity: Activity,
  options?: {
    localPaths?: string[];
    onProgress?: ProgressCallback;
  },
): Promise<AnalysisResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY não configurada.");
  }

  const emit = (event: OpenAIProgressEvent) => options?.onProgress?.(event);
  const openai = new OpenAI({ apiKey });
  const workDirs: string[] = [];
  const ownedTemps: string[] = [];

  try {
    emit({
      phase: "analyzing",
      percent: 56,
      message: "Fallback OpenAI iniciado",
      detail: `Modelo ${OPENAI_MODEL} (análise por frames)`,
    });

    const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
    const frameGuideLines: string[] = [];

    for (let index = 0; index < activity.videos.length; index += 1) {
      const video = activity.videos[index];
      let localPath = options?.localPaths?.[index];

      if (!localPath) {
        emit({
          phase: "downloading",
          percent: 58 + index,
          message: `OpenAI: baixando vídeo ${index + 1}/${activity.videos.length}`,
          detail: video.originalName,
        });
        localPath = path.join(
          os.tmpdir(),
          `cyclo-openai-${video.id}${path.extname(video.storedName) || ".mp4"}`,
        );
        await downloadVideoToTemp(video, localPath);
        ownedTemps.push(localPath);
      }

      const framesDir = path.join(os.tmpdir(), `cyclo-frames-${video.id}-${Date.now()}`);
      workDirs.push(framesDir);

      emit({
        phase: "analyzing",
        percent: 62 + index * 4,
        message: `OpenAI: extraindo frames ${index + 1}/${activity.videos.length}`,
        detail: video.originalName,
      });

      const frames = await extractFrames(localPath, framesDir, MAX_FRAMES);
      if (!frames.length) {
        throw new Error(`Não foi possível extrair frames de ${video.originalName}`);
      }

      frameGuideLines.push(`Vídeo ${video.originalName}:`);
      for (const frame of frames) {
        frameGuideLines.push(`- ${frame.label}`);
        const bytes = await fs.readFile(frame.path);
        content.push({
          type: "text",
          text: `Frame do vídeo "${video.originalName}" em ${frame.timestamp}`,
        });
        content.push({
          type: "image_url",
          image_url: {
            url: `data:image/jpeg;base64,${bytes.toString("base64")}`,
            detail: "low",
          },
        });
      }
    }

    content.unshift({
      type: "text",
      text: buildPrompt(activity, frameGuideLines.join("\n")),
    });

    emit({
      phase: "analyzing",
      percent: 78,
      message: "OpenAI analisando frames...",
      detail: OPENAI_MODEL,
    });

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Você analisa sequências de frames de vídeos industriais e responde somente com JSON válido.",
        },
        {
          role: "user",
          content,
        },
      ],
    });

    const rawText = completion.choices[0]?.message?.content?.trim() || "";
    if (!rawText) {
      throw new Error("A OpenAI retornou uma resposta vazia.");
    }

    emit({
      phase: "parsing",
      percent: 94,
      message: "OpenAI: interpretando tempos...",
    });

    const result = mapResult(rawText, activity);

    emit({
      phase: "done",
      percent: 100,
      message: "Análise concluída via OpenAI",
      detail: result.summary.slice(0, 180),
    });

    return result;
  } finally {
    for (const dir of workDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    for (const filePath of ownedTemps) {
      await fs.unlink(filePath).catch(() => undefined);
    }
  }
}
