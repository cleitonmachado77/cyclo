import { GoogleGenAI, MediaProcessing } from "@google/genai";
import { buildAnalysisSystemPrompt } from "@/lib/analysis-prompt";
import { formatClock } from "@/lib/clock";
import type { Activity, MovementTiming } from "@/types/activity";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const MAX_ATTEMPTS = 10;

export type SegmentAnalysis = {
  movements: MovementTiming[];
  summary: string;
  observations?: string;
  model: string;
};

type SegmentRequest = {
  activity: Activity;
  filePath: string;
  mimeType: string;
  index: number;
  count: number;
  startSeconds: number;
  endSeconds: number;
  overlapSeconds: number;
  handoff?: string;
  onProgress?: (message: string, detail?: string) => void;
};

export async function analyzeVideoSegment(request: SegmentRequest): Promise<SegmentAnalysis> {
  const ai = client();
  let lastError: unknown;
  const models = [...new Set([MODEL, ...FALLBACK_MODELS])];

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let uploadedName = "";
      try {
        request.onProgress?.(
          attempt > 1 ? `Nova tentativa com ${model}` : "Enviando trecho ao Gemini",
          `parte ${request.index + 1} de ${request.count}`,
        );
        const uploaded = await ai.files.upload({
          file: request.filePath,
          config: {
            mimeType: request.mimeType || "video/mp4",
            displayName: `${request.activity.videos[0]?.originalName || "video"} parte ${request.index + 1}`,
          },
        });
        if (!uploaded.name) throw new Error("Upload do trecho para o Gemini falhou.");
        uploadedName = uploaded.name;

        const ready = await waitUntilActive(ai, uploaded.name, (tick) => {
          request.onProgress?.("Processando trecho no Gemini", `leitura ${tick}`);
        });

        request.onProgress?.(`Analisando trecho com ${model}`, `parte ${request.index + 1} de ${request.count}`);
        const rawText = await generateSegment(ai, model, ready, request);
        return mapSegment(rawText, model);
      } catch (error) {
        lastError = error;
        const lastChance = attempt === MAX_ATTEMPTS && modelIndex === models.length - 1;
        if (!isRetryable(error) || lastChance) throw error;
        if (attempt === MAX_ATTEMPTS) break;
        const delay = retryDelayMs(error, attempt);
        request.onProgress?.(
          "Cota do Gemini atingida. Aguardando para continuar",
          `nova tentativa em ${Math.ceil(delay / 1000)}s`,
        );
        await sleep(delay);
      } finally {
        if (uploadedName) await ai.files.delete({ name: uploadedName }).catch(() => undefined);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Falha ao analisar o trecho.");
}

function client() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada no ambiente.");
  return new GoogleGenAI({ apiKey });
}

async function generateSegment(
  ai: GoogleGenAI,
  model: string,
  ready: { uri?: string; mimeType?: string },
  request: SegmentRequest,
) {
  const stream = await ai.models.generateContentStream({
    model,
    contents: {
      role: "user",
      parts: [
        {
          fileData: {
            fileUri: ready.uri!,
            mimeType: ready.mimeType || request.mimeType || "video/mp4",
          },
          mediaProcessing: MediaProcessing.AGENTIC,
        },
        { text: segmentPrompt(request) },
      ],
    },
    config: { thinkingConfig: { includeThoughts: true } },
  });

  let rawText = "";
  let lastDetail = 0;
  for await (const chunk of stream) {
    const parts = chunk.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.thought && part.text && Date.now() - lastDetail > 2500) {
        lastDetail = Date.now();
        request.onProgress?.("Lendo o trecho", part.text.slice(0, 180));
      }
      if (!part.thought && part.text) rawText += part.text;
    }
    if (!rawText && chunk.text) rawText += chunk.text;
  }

  if (!rawText.trim()) throw new Error("O Gemini não retornou a cronometragem deste trecho.");
  return rawText.trim();
}

function segmentPrompt(request: SegmentRequest) {
  const video = request.activity.videos[0];
  const handoff = request.handoff
    ? `No corte anterior, o último movimento observado foi: ${request.handoff}.`
    : "Este é o primeiro trecho do vídeo.";
  const overlap =
    request.overlapSeconds > 0
      ? `Os primeiros ${request.overlapSeconds} segundos repetem o fim do trecho anterior. Continue a sequência, sem recontar o que já terminou nessa sobreposição.`
      : "Não há sobreposição com um trecho anterior.";

  return buildAnalysisSystemPrompt(
    request.activity,
    `Este arquivo é a parte ${request.index + 1} de ${request.count} do vídeo "${video?.originalName || "vídeo"}".
Intervalo no vídeo original: ${formatClock(request.startSeconds)} até ${formatClock(request.endSeconds)}.
Meça os tempos RELATIVOS a este trecho: 00:00 é o início deste arquivo, não o início do vídeo original.
${overlap}
${handoff}
videoId obrigatório: "${video?.id || ""}".`,
  );
}

function mapSegment(rawText: string, model: string): SegmentAnalysis {
  const parsed = extractJson(rawText) as {
    summary?: string;
    videos?: Array<{ movements?: MovementTiming[]; observations?: string; totalDurationSeconds?: number }>;
  };
  const source = parsed.videos?.[0];
  const movements = Array.isArray(source?.movements)
    ? source.movements.map((movement) => ({
        name: movement.name || "Movimento",
        status: movement.status,
        startTime: movement.startTime || "00:00",
        endTime: movement.endTime || "00:00",
        durationSeconds: Number(movement.durationSeconds) || 0,
        notes: movement.notes,
      }))
    : [];

  return {
    movements,
    summary: parsed.summary || "Trecho analisado.",
    observations: source?.observations,
    model,
  };
}

async function waitUntilActive(ai: GoogleGenAI, name: string, onTick?: (attempt: number) => void) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const file = await ai.files.get({ name });
    const state = String(file.state ?? "");
    if (state === "ACTIVE" || state.endsWith("ACTIVE")) {
      return { uri: file.uri, mimeType: file.mimeType };
    }
    if (state.includes("FAILED")) throw new Error("O Gemini não conseguiu ler este trecho.");
    onTick?.(attempt + 1);
    await sleep(2000);
  }
  throw new Error("Tempo esgotado aguardando o trecho ficar pronto no Gemini.");
}

function isRetryable(error: unknown) {
  const text = errorText(error).toLowerCase();
  return (
    text.includes("429") ||
    text.includes("503") ||
    text.includes("unavailable") ||
    text.includes("resource_exhausted") ||
    text.includes("high demand") ||
    text.includes("try again") ||
    text.includes("json")
  );
}

function retryDelayMs(error: unknown, attempt: number) {
  const text = errorText(error);
  const match = text.match(/retry(?:Delay)?["']?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/i) || text.match(/retry in (\d+)/i);
  if (match) return Math.ceil(Number(match[1]) * 1000) + 500;
  return Math.min(8 * 60 * 1000, 20_000 * 2 ** (attempt - 1));
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message || String(error);
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || text.trim();
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) throw new Error("A resposta do modelo não contém JSON válido.");
  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
