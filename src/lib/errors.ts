/** Converte erros técnicos de API em mensagens curtas para o usuário. */
export function toUserMessage(error: unknown, fallback = "Não foi possível concluir agora. Tente novamente em instantes.") {
  const raw = normalizeErrorText(error);
  const lower = raw.toLowerCase();

  if (
    lower.includes("503") ||
    lower.includes("unavailable") ||
    lower.includes("high demand") ||
    lower.includes("sobrecarregado") ||
    lower.includes("try again later")
  ) {
    return "O serviço de IA está ocupado no momento. Tente novamente em alguns instantes.";
  }

  if (lower.includes("429") || lower.includes("resource_exhausted") || lower.includes("rate limit")) {
    return "Limite temporário de uso atingido. Aguarde um pouco e tente de novo.";
  }

  if (lower.includes("401") || lower.includes("403") || lower.includes("api key") || lower.includes("unauthorized")) {
    return "Falha de autenticação com o provedor de IA. Verifique as chaves de API.";
  }

  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("deadline")) {
    return "A análise demorou mais do que o esperado. Tente novamente.";
  }

  if (lower.includes("ffmpeg")) {
    return "Não foi possível preparar o vídeo para análise.";
  }

  if (lower.includes("openai") && lower.includes("gemini")) {
    return "Os provedores de IA estão indisponíveis no momento. Tente novamente em breve.";
  }

  // Evita despejar JSON / stack / payloads técnicos na UI
  if (looksTechnical(raw)) {
    return fallback;
  }

  if (raw.length > 160) {
    return fallback;
  }

  return raw || fallback;
}

function normalizeErrorText(error: unknown) {
  if (error instanceof Error) return error.message || String(error);
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function looksTechnical(text: string) {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.includes('"error"') ||
    trimmed.includes('"status"') ||
    trimmed.includes("statusCode") ||
    trimmed.includes("UNAVAILABLE") ||
    trimmed.includes("Service Unavailable") ||
    /at\s+\S+\s+\(/.test(trimmed)
  );
}
