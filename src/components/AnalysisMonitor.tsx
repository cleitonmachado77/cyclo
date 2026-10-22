"use client";

import { useEffect, useState } from "react";
import { formatClock, formatDurationLabel } from "@/lib/clock";
import type { MonitorStage } from "@/types/pipeline";

export function startMonitor(message: string): AnalysisMonitorState {
  return {
    phase: "queued",
    percent: 1,
    message,
    log: [`00:00 · ${message}`],
    stages: [{ id: "queue", label: "Preparar esteira", status: "active" }],
    elapsedSeconds: 0,
    etaSeconds: null,
    receivedAt: Date.now(),
  };
}

export function applyAnalysisProgress(
  payload: Record<string, unknown>,
  prev: AnalysisMonitorState | null,
): AnalysisMonitorState {
  const message = String(payload.message || "Analisando...");
  const detail = payload.detail ? String(payload.detail) : undefined;
  const elapsed = Number(payload.elapsedSeconds || prev?.elapsedSeconds || 0);
  const entry = `${formatClock(elapsed)} · ${detail ? `${message}: ${detail}` : message}`;
  const log = [...(prev?.log || []), entry].slice(-80);
  const stages = Array.isArray(payload.stages) ? (payload.stages as MonitorStage[]) : prev?.stages || [];

  return {
    phase: String(payload.phase || prev?.phase || "analyzing"),
    percent: Number(payload.percent ?? prev?.percent ?? 0),
    message,
    detail,
    log,
    stages,
    elapsedSeconds: elapsed,
    etaSeconds: payload.etaSeconds == null ? (prev?.etaSeconds ?? null) : Number(payload.etaSeconds),
    startedAt: typeof payload.startedAt === "number" ? payload.startedAt : prev?.startedAt,
    receivedAt: Date.now(),
    videoIndex: asNumber(payload.videoIndex, prev?.videoIndex),
    videoCount: asNumber(payload.videoCount, prev?.videoCount),
    segmentIndex: asNumber(payload.segmentIndex, prev?.segmentIndex),
    segmentCount: asNumber(payload.segmentCount, prev?.segmentCount),
    fileName: payload.fileName ? String(payload.fileName) : prev?.fileName,
    jobId: payload.jobId ? String(payload.jobId) : prev?.jobId,
  };
}

function asNumber(value: unknown, fallback?: number) {
  return typeof value === "number" ? value : fallback;
}

export type AnalysisMonitorState = {
  phase: string;
  percent: number;
  message: string;
  detail?: string;
  log: string[];
  stages: MonitorStage[];
  elapsedSeconds: number;
  etaSeconds: number | null;
  startedAt?: number;
  receivedAt: number;
  videoIndex?: number;
  videoCount?: number;
  segmentIndex?: number;
  segmentCount?: number;
  fileName?: string;
  jobId?: string;
};

type AnalysisMonitorProps = {
  progress: AnalysisMonitorState;
  controlling?: boolean;
  paused?: boolean;
  busy?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
};

export function AnalysisMonitor({
  progress,
  controlling = false,
  paused = false,
  busy = false,
  onPause,
  onResume,
  onStop,
}: AnalysisMonitorProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = progress.startedAt
    ? Math.max(0, Math.round((now - progress.startedAt) / 1000))
    : progress.elapsedSeconds;
  const sinceEvent = Math.max(0, Math.round((now - progress.receivedAt) / 1000));
  const eta =
    progress.phase === "done" || paused
      ? progress.phase === "done"
        ? 0
        : progress.etaSeconds
      : progress.etaSeconds == null
        ? null
        : Math.max(0, progress.etaSeconds - sinceEvent);

  return (
    <section className={`panel analysis-live ${paused ? "is-paused" : ""}`}>
      <div className="analysis-live-head">
        <h2 className="panel-title">Visor da análise{paused ? " · pausada" : ""}</h2>
        <div className="analysis-live-actions">
          {controlling ? (
            <>
              {paused ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy}
                  onClick={onResume}
                >
                  Continuar
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy}
                  onClick={onPause}
                >
                  Pausar
                </button>
              )}
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={busy}
                onClick={onStop}
              >
                Encerrar
              </button>
            </>
          ) : null}
          <span className="progress-label">{progress.percent}%</span>
        </div>
      </div>

      <div className="monitor-clocks">
        <div className="monitor-clock">
          <span>Tempo decorrido</span>
          <strong>{formatClock(elapsed)}</strong>
        </div>
        <div className="monitor-clock">
          <span>Até a conclusão</span>
          <strong>{formatDurationLabel(eta)}</strong>
        </div>
        <div className="monitor-clock">
          <span>Posição</span>
          <strong>
            {progress.videoCount ? `${progress.videoIndex || 0}/${progress.videoCount}` : "—"}
          </strong>
        </div>
      </div>

      <p className="panel-copy">{progress.message}</p>
      <p className="analysis-detail">
        {progress.fileName ? `${progress.fileName}` : "Aguardando vídeo"}
        {progress.segmentCount
          ? ` · trecho ${progress.segmentIndex || 0} de ${progress.segmentCount}`
          : ""}
        {progress.detail ? ` · ${progress.detail}` : ""}
      </p>

      <div
        className="progress-track progress-track-wide"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
      >
        <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
      </div>

      <ol className="monitor-stages">
        {progress.stages.map((stage) => (
          <li key={stage.id} className={`monitor-stage is-${stage.status}`}>
            <span className="monitor-dot" />
            <span>
              <strong>{stage.label}</strong>
              {stage.status === "skipped" ? <em> não necessário</em> : null}
              {stage.detail ? <small>{stage.detail}</small> : null}
            </span>
          </li>
        ))}
      </ol>

      <ul className="analysis-log">
        {progress.log.map((item, index) => (
          <li key={`${index}-${item.slice(0, 32)}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
