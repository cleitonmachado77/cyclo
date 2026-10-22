import { GoogleGenAI, MediaProcessing } from "@google/genai";
import { buildAnalysisSystemPrompt } from "@/lib/analysis-prompt";
import { formatClock } from "@/lib/clock";
import {
  errorText,
  isQuotaError,
  isRetryable,
  isStreamTruncationError,
  isTimeoutError,
  retryDelayMs,
} from "@/lib/gemini-retry";
import type { Activity, MovementTiming } from "@/types/activity";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

/** Tentativas de generate por modelo (sem re-upload a cada retry). */
const MAX_GENERATE_ATTEMPTS = Number(process.env.GEMINI_GENERATE_ATTEMPTS || 5);
/** Timeout HTTP do SDK por chamada. */
const HTTP_TIMEOUT_MS = Number(process.env.GEMINI_HTTP_TIMEOUT_MS || 10 * 60 * 1000);
/**
 * AGENTIC + thinking corta o stream SSE com frequência (Incomplete JSON segment).
 * Mantém desligado por padrão; ative com GEMINI_SEGMENT_AGENTIC=1 se necessário.
 */
const USE_AGENTIC = process.env.GEMINI_SEGMENT_AGENTIC === "1";

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
  signal?: AbortSignal;
  onProgress?: (message: string, detail?: string) => void;
};

type ReadyFile = { uri?: string; mimeType?: string };

export async function analyzeVideoSegment(request: SegmentRequest): Promise<SegmentAnalysis> {
  const ai = client();
  let lastError: unknown;
  const models = [...new Set([MODEL, ...FALLBACK_MODELS])];

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];
    throwIfAborted(request.signal);
    let uploadedName = "";

    try {
      request.onProgress?.(
        "Enviando trecho ao Gemini",
        `parte ${request.index + 1} de ${request.count}${modelIndex > 0 ? ` · ${model}` : ""}`,
      );
      const uploaded = await ai.files.upload({
        file: request.filePath,
        config: {
          mimeType: request.mimeType || "video/mp4",
          displayName: `${request.activity.videos[0]?.originalName || "video"} parte ${request.index + 1}`,
        },
      });
      throwIfAborted(request.signal);
      if (!uploaded.name) throw new Error("Upload do trecho para o Gemini falhou.");
      uploadedName = uploaded.name;

      const ready = await waitUntilActive(ai, uploaded.name, request.signal, (tick) => {
        request.onProgress?.("Processando trecho no Gemini", `leitura ${tick}`);
      });

      for (let attempt = 1; attempt <= MAX_GENERATE_ATTEMPTS; attempt += 1) {
        throwIfAborted(request.signal);
        try {
          request.onProgress?.(
            attempt > 1 ? `Nova tentativa com ${model}` : `Analisando trecho com ${model}`,
            `parte ${request.index + 1} de ${request.count}`,
          );
          const rawText = await generateSegment(ai, model, ready, request);
          return mapSegment(rawText, model);
        } catch (error) {
          lastError = error;
          if (isAbortError(error) || request.signal?.aborted) throw error;
          console.warn("[gemini-segment]", model, "attempt", attempt, errorText(error));
          const lastChance = attempt === MAX_GENERATE_ATTEMPTS && modelIndex === models.length - 1;
          if (!isRetryable(error) || lastChance) throw error;
          if (attempt === MAX_GENERATE_ATTEMPTS) break;

          const delay = retryDelayMs(error, attempt);
          request.onProgress?.(
            isQuotaError(error)
              ? "Cota do Gemini atingida. Aguardando para continuar"
              : isTimeoutError(error)
                ? "Timeout do Gemini. Aguardando para tentar de novo"
                : "Falha temporária. Aguardando para continuar",
            `nova tentativa em ${Math.ceil(delay / 1000)}s · ${errorText(error).slice(0, 80)}`,
          );
          await sleep(delay, request.signal);
        }
      }

      if (modelIndex < models.length - 1 && lastError) {
        const delay = isQuotaError(lastError)
          ? retryDelayMs(lastError, MAX_GENERATE_ATTEMPTS)
          : Math.min(15_000, retryDelayMs(lastError, MAX_GENERATE_ATTEMPTS));
        request.onProgress?.(
          "Trocando para modelo alternativo",
          `aguardando ${Math.ceil(delay / 1000)}s`,
        );
        await sleep(delay, request.signal);
      }
    } catch (error) {
      lastError = error;
      if (isAbortError(error) || request.signal?.aborted) throw error;
      if (!isRetryable(error) || modelIndex === models.length - 1) throw error;
      const delay = retryDelayMs(error, modelIndex + 1);
      request.onProgress?.(
        isQuotaError(error)
          ? "Cota do Gemini atingida. Trocando de modelo em breve"
          : "Falha temporária. Trocando de modelo em breve",
        `aguardando ${Math.ceil(delay / 1000)}s`,
      );
      await sleep(delay, request.signal);
    } finally {
      if (uploadedName) await ai.files.delete({ name: uploadedName }).catch(() => undefined);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Falha ao analisar o trecho.");
}

function client() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada no ambiente.");
  return new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: HTTP_TIMEOUT_MS },
  });
}

async function generateSegment(
  ai: GoogleGenAI,
  model: string,
  ready: ReadyFile,
  request: SegmentRequest,
) {
  try {
    return await generateViaStream(ai, model, ready, request);
  } catch (error) {
    if (isAbortError(error) || request.signal?.aborted) throw error;
    if (!isStreamTruncationError(error)) throw error;

    console.warn("[gemini-segment] stream truncado; fallback unary", {
      model,
      segment: `${request.index + 1}/${request.count}`,
      error: errorText(error),
    });
    request.onProgress?.(
      "Stream interrompido. Tentando sem streaming",
      `parte ${request.index + 1} de ${request.count}`,
    );
    return await generateViaUnary(ai, model, ready, request);
  }
}

function buildContents(ready: ReadyFile, request: SegmentRequest) {
  return {
    role: "user" as const,
    parts: [
      {
        fileData: {
          fileUri: ready.uri!,
          mimeType: ready.mimeType || request.mimeType || "video/mp4",
        },
        ...(USE_AGENTIC ? { mediaProcessing: MediaProcessing.AGENTIC } : {}),
      },
      { text: segmentPrompt(request) },
    ],
  };
}

function buildConfig() {
  return USE_AGENTIC ? { thinkingConfig: { includeThoughts: true } } : undefined;
}

async function generateViaStream(
  ai: GoogleGenAI,
  model: string,
  ready: ReadyFile,
  request: SegmentRequest,
) {
  const stream = await ai.models.generateContentStream({
    model,
    contents: buildContents(ready, request),
    config: buildConfig(),
  });

  let rawText = "";
  let lastDetail = 0;

  for await (const chunk of stream) {
    throwIfAborted(request.signal);
    const parts = chunk.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      const asRecord = part as {
        thought?: boolean;
        text?: string;
        toolCall?: unknown;
        toolResponse?: unknown;
        functionCall?: unknown;
      };
      if (asRecord.toolCall || asRecord.toolResponse || asRecord.functionCall) continue;
      if (asRecord.thought && asRecord.text) {
        if (Date.now() - lastDetail > 2500) {
          lastDetail = Date.now();
          request.onProgress?.("Lendo o trecho", asRecord.text.slice(0, 180));
        }
        continue;
      }
      if (asRecord.text) rawText += asRecord.text;
    }
  }

  if (!rawText.trim()) throw new Error("O Gemini não retornou a cronometragem deste trecho.");
  return rawText.trim();
}

async function generateViaUnary(
  ai: GoogleGenAI,
  model: string,
  ready: ReadyFile,
  request: SegmentRequest,
) {
  throwIfAborted(request.signal);
  const response = await ai.models.generateContent({
    model,
    contents: buildContents(ready, request),
    config: buildConfig(),
  });

  throwIfAborted(request.signal);

  let rawText = "";
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const asRecord = part as { thought?: boolean; text?: string };
    if (asRecord.thought || !asRecord.text) continue;
    rawText += asRecord.text;
  }

  // Fallback seguro: response.text só se ainda não houver texto útil.
  if (!rawText.trim() && typeof response.text === "string") {
    rawText = response.text;
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

async function waitUntilActive(
  ai: GoogleGenAI,
  name: string,
  signal: AbortSignal | undefined,
  onTick?: (attempt: number) => void,
) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    throwIfAborted(signal);
    const file = await ai.files.get({ name });
    const state = String(file.state ?? "");
    if (state === "ACTIVE" || state.endsWith("ACTIVE")) {
      return { uri: file.uri, mimeType: file.mimeType };
    }
    if (state.includes("FAILED")) throw new Error("O Gemini não conseguiu ler este trecho.");
    onTick?.(attempt + 1);
    await sleep(2000, signal);
  }
  throw new Error("Tempo esgotado aguardando o trecho ficar pronto no Gemini.");
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || text.trim();
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) throw new Error("A resposta do modelo não contém JSON válido.");
  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const reason = typeof signal.reason === "string" ? signal.reason : "Análise cancelada.";
  throw new DOMException(reason, "AbortError");
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Análise cancelada.", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Análise cancelada.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
