/** Helpers de retry/cota do Gemini — puro para testes e uso no pipeline. */

export function errorText(error: unknown) {
  if (error instanceof Error) return error.message || String(error);
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function isTimeoutError(error: unknown) {
  const text = errorText(error).toLowerCase();
  return (
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("deadline") ||
    text.includes("deadline_exceeded") ||
    text.includes("tempo esgotado")
  );
}

export function isQuotaError(error: unknown) {
  const text = errorText(error).toLowerCase();
  return (
    text.includes("429") ||
    text.includes("resource_exhausted") ||
    text.includes("rate limit") ||
    text.includes("quota") ||
    text.includes("high demand")
  );
}

/** Stream SSE do SDK fechou com buffer incompleto (comum com AGENTIC/thinking). */
export function isStreamTruncationError(error: unknown) {
  const text = errorText(error).toLowerCase();
  return (
    text.includes("incomplete json segment") ||
    text.includes("incomplete json") ||
    text.includes("response body is empty")
  );
}

export function isRetryable(error: unknown) {
  const text = errorText(error).toLowerCase();
  return (
    isTimeoutError(error) ||
    isQuotaError(error) ||
    isStreamTruncationError(error) ||
    text.includes("503") ||
    text.includes("unavailable") ||
    text.includes("try again") ||
    text.includes("não contém json") ||
    text.includes("json válido") ||
    text.includes("unexpected token") ||
    text.includes("não retornou a cronometragem")
  );
}

/** Extrai Retry-After / retryDelay da mensagem da API (segundos → ms). */
export function parseRetryAfterMs(error: unknown): number | null {
  const text = errorText(error);
  const patterns = [
    /retry(?:Delay)?["']?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/i,
    /retry in (\d+(?:\.\d+)?)\s*s/i,
    /Please retry in (\d+(?:\.\d+)?)s/i,
    /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Math.ceil(Number(match[1]) * 1000);
  }
  return null;
}

/**
 * Backoff para retry.
 * Cota: espera mais (padrão 45s → 90s → …, máx 10 min) para não martelar a API.
 */
export function retryDelayMs(error: unknown, attempt: number) {
  const parsed = parseRetryAfterMs(error);
  if (parsed != null) return parsed + 500;
  if (isQuotaError(error)) return Math.min(10 * 60 * 1000, 45_000 * 2 ** Math.max(0, attempt - 1));
  if (isTimeoutError(error)) return Math.min(60_000, 8_000 * Math.max(1, attempt));
  // Falhas genéricas (JSON/vazio/503): backoff curto para não travar a esteira
  return Math.min(60_000, 8_000 * 2 ** Math.max(0, attempt - 1));
}

/** Estimativa de quantas janelas um vídeo gera (útil para UI/testes). */
export function estimateSegmentCount(durationSeconds: number, segmentSeconds: number, overlapSeconds: number) {
  const duration = Math.max(durationSeconds, 1);
  const window = Math.max(45, segmentSeconds);
  const overlap = Math.min(overlapSeconds, Math.floor(window / 5));
  const step = Math.max(20, window - overlap);
  let start = 0;
  let count = 0;
  while (start < duration - 0.4 && count < 400) {
    const end = Math.min(duration, start + window);
    count += 1;
    if (end >= duration - 0.4) break;
    start += step;
  }
  return Math.max(1, count);
}
