import { createWriteStream, promises as fs } from "fs";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { formatBytes } from "@/lib/format";
import { probeDurationSeconds, progressSeconds, runFfmpeg } from "@/lib/media-tools";
import { getSupabaseAdmin, VIDEO_BUCKET } from "@/lib/supabase/server";

export const TARGET_SEGMENT_SECONDS = 8 * 60;
export const SEGMENT_OVERLAP_SECONDS = 10;
export const MAX_SEGMENT_BYTES = 50 * 1024 * 1024;

export type SegmentWindow = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  overlapSeconds: number;
};

export async function streamStorageToFile(
  storagePath: string,
  targetPath: string,
  onBytes?: (loaded: number, total: number | null) => void,
) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.from(VIDEO_BUCKET).createSignedUrl(storagePath, 60 * 60);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "Falha ao preparar o download do vídeo.");
  }

  const response = await fetch(data.signedUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Falha ao baixar o vídeo (${response.status}).`);
  }

  const totalHeader = Number(response.headers.get("content-length") || 0);
  const total = totalHeader > 0 ? totalHeader : null;
  let loaded = 0;
  let lastEmit = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      loaded += chunk.length;
      const now = Date.now();
      const complete = total != null && loaded >= total;
      if (complete || now - lastEmit >= 800) {
        lastEmit = now;
        onBytes?.(loaded, total);
      }
      callback(null, chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body as import("stream/web").ReadableStream<Uint8Array>),
    counter,
    createWriteStream(targetPath),
  );
  const stat = await fs.stat(targetPath);
  if (stat.size < 1024) {
    throw new Error("O vídeo baixado está vazio ou incompleto.");
  }
  return stat.size;
}

export function planSegmentWindows(durationSeconds: number, fileBytes: number): SegmentWindow[] {
  const duration = Math.max(durationSeconds, 1);
  const bytesPerSecond = fileBytes > 0 ? fileBytes / duration : MAX_SEGMENT_BYTES;
  const maxBySize = Math.floor(MAX_SEGMENT_BYTES / Math.max(bytesPerSecond, 1));
  const window = clamp(Math.min(TARGET_SEGMENT_SECONDS, maxBySize), 45, TARGET_SEGMENT_SECONDS);
  const overlap = Math.min(SEGMENT_OVERLAP_SECONDS, Math.floor(window / 5));
  const step = Math.max(20, window - overlap);
  const windows: SegmentWindow[] = [];

  let start = 0;
  while (start < duration - 0.4 && windows.length < 400) {
    const end = Math.min(duration, start + window);
    windows.push({
      index: windows.length,
      startSeconds: roundSeconds(start),
      endSeconds: roundSeconds(end),
      overlapSeconds: windows.length === 0 ? 0 : overlap,
    });
    if (end >= duration - 0.4) break;
    start += step;
  }

  return windows.length ? windows : [{ index: 0, startSeconds: 0, endSeconds: roundSeconds(duration), overlapSeconds: 0 }];
}

export async function transcodeProxy(
  inputPath: string,
  outputPath: string,
  durationSeconds: number,
  onPercent?: (percent: number) => void,
) {
  let lastEmit = 0;
  let lastPercent = -1;
  await runFfmpeg(
    [
      "-y",
      "-i",
      inputPath,
      "-vf",
      "scale=-2:min(720\\,ih)",
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-b:v",
      "600k",
      "-maxrate",
      "800k",
      "-bufsize",
      "1600k",
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      "-ac",
      "1",
      "-movflags",
      "+faststart",
      "-progress",
      "pipe:1",
      "-nostats",
      outputPath,
    ],
    (line) => {
      const seconds = progressSeconds(line);
      if (seconds == null || durationSeconds <= 0) return;
      const percent = Math.max(0, Math.min(99, Math.round((seconds / durationSeconds) * 100)));
      const now = Date.now();
      if (percent === lastPercent) return;
      if (now - lastEmit < 1500 && percent < 99) return;
      lastEmit = now;
      lastPercent = percent;
      onPercent?.(percent);
    },
  );
}

export async function cutSegment(sourcePath: string, window: SegmentWindow, outputPath: string) {
  const length = Math.max(1, window.endSeconds - window.startSeconds);
  await runFfmpeg([
    "-y",
    "-ss",
    String(window.startSeconds),
    "-i",
    sourcePath,
    "-t",
    String(length),
    "-c",
    "copy",
    "-avoid_negative_ts",
    "make_zero",
    "-movflags",
    "+faststart",
    outputPath,
  ]);

  const stat = await fs.stat(outputPath);
  if (stat.size < 1024) {
    throw new Error(`Trecho ${window.index + 1} ficou vazio depois do corte.`);
  }
  if (stat.size > MAX_SEGMENT_BYTES * 1.15) {
    throw new Error(
      `Trecho ${window.index + 1} ficou com ${formatBytes(stat.size)}, acima do limite de 50 MB.`,
    );
  }
  return stat.size;
}

export async function inspectMedia(filePath: string) {
  const [durationSeconds, stat] = await Promise.all([probeDurationSeconds(filePath), fs.stat(filePath)]);
  return { durationSeconds, bytes: stat.size };
}

export function proxyOutputPath(workDir: string) {
  return path.join(workDir, "proxy.mp4");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundSeconds(value: number) {
  return Math.round(value * 10) / 10;
}
