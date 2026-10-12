import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { GoogleGenAI, MediaProcessing, type Part } from "@google/genai";
import { buildAnalysisSystemPrompt } from "@/lib/analysis-prompt";
import { toUserMessage } from "@/lib/errors";
import { analyzeActivityVideosWithOpenAI } from "@/lib/openai-analyze";
import type { Activity, AnalysisResult, VideoAnalysis } from "@/types/activity";
import { downloadVideoToTemp } from "@/lib/store";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const FALLBACK_MODELS = (
  process.env.GEMINI_FALLBACK_MODELS ||
  "gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash"
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function modelCandidates() {
  return [...new Set([MODEL, ...FALLBACK_MODELS])];
}

function rawErrorText(error: unknown) {
  if (error instanceof Error) return error.message || String(error);
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isRetryableGeminiError(error: unknown) {
  const text = rawErrorText(error).toLowerCase();
  return (
    text.includes("503") ||
    text.includes("unavailable") ||
    text.includes("high demand") ||
    text.includes("resource_exhausted") ||
    text.includes("429") ||
    text.includes("try again later")
  );
}

function friendlyGeminiError(error: unknown) {
  return toUserMessage(
    error,
    "Não foi possível analisar com o Gemini agora. Tente novamente em instantes.",
  );
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export type AnalysisProgressEvent = {
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

type ProgressCallback = (event: AnalysisProgressEvent) => void;

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não configurada no ambiente.");
  }
  return new GoogleGenAI({ apiKey });
}

async function waitUntilActive(
  ai: GoogleGenAI,
  name: string,
  onTick?: (attempt: number) => void,
  maxAttempts = 60,
): Promise<{ uri?: string; mimeType?: string; state?: string }> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const file = await ai.files.get({ name });
    const state = String(file.state ?? "");
    if (state === "ACTIVE" || state.endsWith("ACTIVE")) {
      return { uri: file.uri, mimeType: file.mimeType, state };
    }
    if (state.includes("FAILED")) {
      throw new Error(`Falha ao processar vídeo no Gemini: ${name}`);
    }
    onTick?.(attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Tempo esgotado aguardando processamento do vídeo no Gemini.");
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || text.trim();
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("A resposta do modelo não contém JSON válido.");
  }
  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
}

function buildSystemPrompt(activity: Activity) {
  return buildAnalysisSystemPrompt(activity);
}

function mapAnalysisResult(rawText: string, activity: Activity): AnalysisResult {
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
    model: MODEL,
    summary: parsed.summary || "Análise concluída.",
    videos,
    rawText,
  };
}

export async function analyzeActivityVideos(
  activity: Activity,
  onProgress?: ProgressCallback,
): Promise<AnalysisResult> {
  if (!activity.videos.length) {
    throw new Error("Envie ao menos um vídeo antes de analisar.");
  }
  if (!activity.prompt.trim()) {
    throw new Error("Defina o prompt com os movimentos a medir.");
  }

  const emit = (event: AnalysisProgressEvent) => onProgress?.(event);
  const ai = getClient();
  const uploadedNames: string[] = [];
  const tempFiles: string[] = [];
  const totalVideos = activity.videos.length;

  try {
    emit({
      phase: "starting",
      percent: 2,
      message: "Iniciando análise com Gemini Agentic...",
    });

    const videoParts: Part[] = [];

    for (let index = 0; index < activity.videos.length; index += 1) {
      const video = activity.videos[index];
      const base = Math.round((index / totalVideos) * 45);

      emit({
        phase: "downloading",
        percent: base + 3,
        message: `Baixando vídeo ${index + 1}/${totalVideos}`,
        detail: video.originalName,
      });

      const tempPath = path.join(
        os.tmpdir(),
        `cyclo-${video.id}${path.extname(video.storedName) || ".mp4"}`,
      );
      await downloadVideoToTemp(video, tempPath);
      tempFiles.push(tempPath);

      emit({
        phase: "uploading_gemini",
        percent: base + 10,
        message: `Enviando para o Gemini ${index + 1}/${totalVideos}`,
        detail: video.originalName,
      });

      const uploaded = await ai.files.upload({
        file: tempPath,
        config: {
          mimeType: video.mimeType || "video/mp4",
          displayName: video.originalName,
        },
      });

      if (!uploaded.name) {
        throw new Error(`Upload Gemini falhou para ${video.originalName}`);
      }

      uploadedNames.push(uploaded.name);

      emit({
        phase: "processing_gemini",
        percent: base + 18,
        message: `Processando arquivo no Gemini ${index + 1}/${totalVideos}`,
        detail: video.originalName,
      });

      const ready = await waitUntilActive(ai, uploaded.name, (attempt) => {
        emit({
          phase: "processing_gemini",
          percent: Math.min(base + 28, base + 18 + attempt),
          message: `Aguardando vídeo ativo no Gemini (${attempt})`,
          detail: video.originalName,
        });
      });

      videoParts.push({
        fileData: {
          fileUri: ready.uri!,
          mimeType: ready.mimeType || video.mimeType || "video/mp4",
        },
        mediaProcessing: MediaProcessing.AGENTIC,
      });
    }

    emit({
      phase: "analyzing",
      percent: 55,
      message: "Gemini Agentic navegando o vídeo...",
      detail: "Explorando timeline, frames e movimentos",
    });

    let rawText = "";
    let usedModel = MODEL;
    let lastError: unknown;

    const candidates = modelCandidates();
    outer: for (let modelIndex = 0; modelIndex < candidates.length; modelIndex += 1) {
      const model = candidates[modelIndex];
      usedModel = model;

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          emit({
            phase: "analyzing",
            percent: 55,
            message:
              attempt > 1
                ? `Tentativa ${attempt}/3 com ${model}...`
                : `Analisando com ${model}...`,
            detail:
              modelIndex > 0
                ? "Modelo anterior indisponível; usando fallback"
                : "Explorando timeline, frames e movimentos",
          });

          let thoughtCount = 0;
          let toolCount = 0;
          rawText = "";

          const stream = await ai.models.generateContentStream({
            model,
            contents: {
              role: "user",
              parts: [...videoParts, { text: buildSystemPrompt(activity) }],
            },
            config: {
              thinkingConfig: {
                includeThoughts: true,
              },
            },
          });

          for await (const chunk of stream) {
            const parts = chunk.candidates?.[0]?.content?.parts ?? [];

            for (const part of parts) {
              if (part.thought && part.text) {
                thoughtCount += 1;
                emit({
                  phase: "analyzing",
                  percent: Math.min(88, 55 + thoughtCount * 2 + toolCount),
                  message: "Raciocínio do Gemini",
                  detail: part.text.slice(0, 220),
                });
              }

              const toolCall = (part as { toolCall?: { toolType?: string } }).toolCall;
              if (toolCall?.toolType === "MEDIA_PROCESSING" || toolCall) {
                toolCount += 1;
                emit({
                  phase: "analyzing",
                  percent: Math.min(90, 58 + thoughtCount + toolCount * 3),
                  message: "Inspeção agentic do vídeo",
                  detail: "Carregando segmento / frames / áudio",
                });
              }

              if (!part.thought && part.text) {
                rawText += part.text;
                emit({
                  phase: "analyzing",
                  percent: Math.min(94, 70 + Math.floor(rawText.length / 80)),
                  message: "Montando resposta da cronometragem...",
                  detail: `${rawText.length} caracteres recebidos`,
                });
              }
            }

            if (!rawText && chunk.text) {
              rawText += chunk.text;
            }
          }

          break outer;
        } catch (error) {
          lastError = error;
          if (!isRetryableGeminiError(error)) {
            throw new Error(friendlyGeminiError(error));
          }

          const waitMs = attempt * 4000;
          emit({
          phase: "analyzing",
          percent: 52,
          message: "Serviço ocupado. Tentando novamente...",
          detail: `Tentativa ${attempt}/3`,
        });
          await sleep(waitMs);
        }
      }
    }

    if (!rawText.trim()) {
      if (process.env.OPENAI_API_KEY) {
        emit({
          phase: "analyzing",
          percent: 54,
          message: "Alternando para OpenAI...",
          detail: "O Gemini está temporariamente indisponível",
        });
        return await analyzeActivityVideosWithOpenAI(activity, {
          localPaths: tempFiles,
          onProgress: emit,
        });
      }
      throw new Error(friendlyGeminiError(lastError));
    }

    rawText = rawText.trim();

    emit({
      phase: "parsing",
      percent: 96,
      message: "Interpretando tempos medidos...",
      detail: usedModel,
    });

    const result = mapAnalysisResult(rawText, activity);
    result.model = usedModel;

    emit({
      phase: "done",
      percent: 100,
      message: "Análise concluída",
      detail: result.summary.slice(0, 180),
    });

    return result;
  } catch (error) {
    if (process.env.OPENAI_API_KEY) {
      emit({
        phase: "analyzing",
        percent: 54,
        message: "Alternando para OpenAI...",
        detail: "O Gemini está temporariamente indisponível",
      });
      try {
        return await analyzeActivityVideosWithOpenAI(activity, {
          localPaths: tempFiles.length === activity.videos.length ? tempFiles : undefined,
          onProgress: emit,
        });
      } catch (openaiError) {
        throw new Error(
          toUserMessage(
            openaiError,
            "Os provedores de IA estão indisponíveis no momento. Tente novamente em breve.",
          ),
        );
      }
    }
    throw new Error(friendlyGeminiError(error));
  } finally {
    for (const name of uploadedNames) {
      await ai.files.delete({ name }).catch(() => undefined);
    }
    for (const filePath of tempFiles) {
      await fs.unlink(filePath).catch(() => undefined);
    }
  }
}
