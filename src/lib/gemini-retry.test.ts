import { describe, expect, it } from "vitest";
import {
  estimateSegmentCount,
  isQuotaError,
  isRetryable,
  isStreamTruncationError,
  isTimeoutError,
  parseRetryAfterMs,
  retryDelayMs,
} from "@/lib/gemini-retry";
import { planSegmentWindows, TARGET_SEGMENT_SECONDS } from "@/lib/video-segments";

describe("gemini-retry", () => {
  it("detecta cota / 429 / resource_exhausted", () => {
    expect(isQuotaError(new Error("429 Resource exhausted"))).toBe(true);
    expect(isQuotaError({ error: { status: "RESOURCE_EXHAUSTED" } })).toBe(true);
    expect(isQuotaError(new Error("You exceeded your current quota"))).toBe(true);
    expect(isQuotaError(new Error("timeout"))).toBe(false);
  });

  it("detecta timeout / deadline", () => {
    expect(isTimeoutError(new Error("DEADLINE_EXCEEDED"))).toBe(true);
    expect(isTimeoutError(new Error("request timed out"))).toBe(true);
    expect(isTimeoutError(new Error("Tempo esgotado aguardando o trecho"))).toBe(true);
    expect(isTimeoutError(new Error("429"))).toBe(false);
  });

  it("marca cota e timeout como retryable", () => {
    expect(isRetryable(new Error("429"))).toBe(true);
    expect(isRetryable(new Error("DEADLINE_EXCEEDED"))).toBe(true);
    expect(isRetryable(new Error("invalid api key"))).toBe(false);
  });

  it("respeita retryDelay da API", () => {
    expect(parseRetryAfterMs('Please retry in 32.5s.')).toBe(32500);
    expect(parseRetryAfterMs('{"retryDelay":"45s"}')).toBe(45000);
    expect(retryDelayMs('Please retry in 20s.', 1)).toBe(20500);
  });

  it("usa backoff longo para cota sem retryDelay", () => {
    expect(retryDelayMs(new Error("429 RESOURCE_EXHAUSTED"), 1)).toBe(45_000);
    expect(retryDelayMs(new Error("429 RESOURCE_EXHAUSTED"), 2)).toBe(90_000);
    expect(retryDelayMs(new Error("429 RESOURCE_EXHAUSTED"), 3)).toBe(180_000);
  });

  it("usa backoff curto para falha genérica / JSON", () => {
    expect(retryDelayMs(new Error("A resposta do modelo não contém JSON válido."), 1)).toBe(8_000);
    expect(retryDelayMs(new Error("A resposta do modelo não contém JSON válido."), 2)).toBe(16_000);
    expect(isRetryable(new Error("A resposta do modelo não contém JSON válido."))).toBe(true);
    expect(isRetryable(new Error("Incomplete JSON segment at the end"))).toBe(true);
    expect(isRetryable(new Error('{"foo":1}'))).toBe(false);
  });

  it("detecta truncamento de stream SSE do SDK", () => {
    expect(isStreamTruncationError(new Error("Incomplete JSON segment at the end"))).toBe(true);
    expect(isStreamTruncationError(new Error("Response body is empty"))).toBe(true);
    expect(isStreamTruncationError(new Error("A resposta do modelo não contém JSON válido."))).toBe(false);
  });

  it("estima bem menos trechos com 5 min do que com 3 min", () => {
    const duration = 40 * 60;
    const with3 = estimateSegmentCount(duration, 3 * 60, 8);
    const with5 = estimateSegmentCount(duration, 5 * 60, 8);
    const with8 = estimateSegmentCount(duration, 8 * 60, 10);
    expect(with5).toBeLessThan(with3);
    expect(with5).toBeGreaterThanOrEqual(with8);
    expect(with5).toBeLessThanOrEqual(10);
  });
});

describe("planSegmentWindows", () => {
  it("usa TARGET_SEGMENT_SECONDS de 5 minutos", () => {
    expect(TARGET_SEGMENT_SECONDS).toBe(5 * 60);
  });

  it("não multiplica demais as janelas em vídeo de 40 min", () => {
    const windows = planSegmentWindows(40 * 60, 40 * 1024 * 1024);
    expect(windows.length).toBeGreaterThanOrEqual(7);
    expect(windows.length).toBeLessThanOrEqual(10);
    expect(windows[0].overlapSeconds).toBe(0);
    expect(windows[1].overlapSeconds).toBeGreaterThan(0);
  });

  it("respeita teto de 50 MB por trecho", () => {
    // ~2 MB/s → janela limitada por tamanho (~25s)
    const windows = planSegmentWindows(120, 240 * 1024 * 1024);
    const longest = Math.max(...windows.map((w) => w.endSeconds - w.startSeconds));
    expect(longest).toBeLessThanOrEqual(TARGET_SEGMENT_SECONDS);
    expect(windows.length).toBeGreaterThan(1);
  });
});
