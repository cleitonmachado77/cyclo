import { spawn } from "child_process";
import { closeSync, openSync, readSync, statSync } from "fs";
import ffmpegPath from "ffmpeg-static";

export function ffmpegBinary() {
  if (!ffmpegPath) {
    throw new Error("ffmpeg indisponível neste ambiente.");
  }
  return ffmpegPath;
}

export function runFfmpeg(args: string[], onStdout?: (line: string) => void) {
  const binary = ffmpegBinary();
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      if (!onStdout) return;
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) onStdout(line.trim());
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 12_000) stderr = stderr.slice(-12_000);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg falhou (${code}): ${stderr.slice(-500)}`));
    });
  });
}

export async function probeDurationSeconds(filePath: string) {
  const binary = ffmpegBinary();
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(binary, ["-hide_banner", "-i", filePath], { windowsHide: true });
    let stderr = "";
    const append = (chunk: Buffer | string) => {
      stderr += String(chunk);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => reject(error));
    child.on("close", () => resolve(stderr));
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "ffmpeg não iniciou";
    throw new Error(`Não foi possível ler a duração do vídeo (${message.slice(0, 80)}).`);
  });

  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) {
    const head = fileHead(filePath);
    const reason = head.includes("ftyp") ? "ffmpeg não leu o arquivo" : "arquivo baixado inválido";
    throw new Error(`Não foi possível ler a duração do vídeo (${reason}).`);
  }

  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function fileHead(filePath: string) {
  const size = statSync(filePath).size;
  const buf = Buffer.alloc(12);
  const fd = openSync(filePath, "r");
  try {
    readSync(fd, buf, 0, 12, 0);
  } finally {
    closeSync(fd);
  }
  return `${size}:${buf.toString("latin1").replace(/[^\x20-\x7e]/g, "")}`;
}

export function progressSeconds(line: string) {
  const microseconds = line.match(/^out_time_ms=(\d+)/) || line.match(/^out_time_us=(\d+)/);
  if (microseconds) return Number(microseconds[1]) / 1_000_000;
  const stamped = line.match(/^out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!stamped) return null;
  return Number(stamped[1]) * 3600 + Number(stamped[2]) * 60 + Number(stamped[3]);
}
