import { toUserMessage } from "@/lib/errors";

export type AnalysisJobEvent = {
  type: "progress" | "done" | "error";
  data: Record<string, unknown>;
};

type Listener = (event: AnalysisJobEvent) => void;

class AnalysisJob {
  readonly id = crypto.randomUUID();
  finished = false;
  private history: AnalysisJobEvent[] = [];
  private listeners = new Set<Listener>();
  private controller = new AbortController();
  private seq = 0;
  private paused = false;
  private pauseWaiters: Array<() => void> = [];

  get signal() {
    return this.controller.signal;
  }

  get isPaused() {
    return this.paused && !this.finished;
  }

  emit(event: AnalysisJobEvent) {
    if (this.finished) return;
    this.seq += 1;
    const stamped: AnalysisJobEvent = {
      type: event.type,
      data: { ...event.data, seq: this.seq },
    };
    this.history.push(stamped);
    if (this.history.length > 800) this.history.splice(0, this.history.length - 800);
    if (stamped.type !== "progress") this.finished = true;
    for (const listener of this.listeners) listener(stamped);
  }

  pause() {
    if (this.finished || this.paused) return false;
    this.paused = true;
    this.emit({
      type: "progress",
      data: {
        phase: "paused",
        message: "Análise pausada",
        detail: "A pausa vale no próximo trecho ou vídeo. Encerrar aborta agora.",
      },
    });
    return true;
  }

  resume() {
    if (this.finished || !this.paused) return false;
    this.paused = false;
    const waiters = this.pauseWaiters.splice(0);
    for (const resolve of waiters) resolve();
    this.emit({
      type: "progress",
      data: {
        phase: "analyzing",
        message: "Análise retomada",
        detail: "Continuando a esteira",
      },
    });
    return true;
  }

  /** Bloqueia até resume/cancel. Usar entre trechos/vídeos. */
  waitWhilePaused(signal?: AbortSignal) {
    if (!this.paused || this.finished) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
        const index = this.pauseWaiters.indexOf(onResume);
        if (index >= 0) this.pauseWaiters.splice(index, 1);
      };
      const onResume = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        const reason = typeof signal?.reason === "string" ? signal.reason : "Análise cancelada.";
        reject(new DOMException(reason, "AbortError"));
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pauseWaiters.push(onResume);
    });
  }

  cancel(reason = "Análise cancelada.") {
    if (this.finished) return false;
    this.paused = false;
    this.controller.abort(reason);
    // Waiters com signal já rejeitam no abort; limpa leftovers sem signal.
    const waiters = this.pauseWaiters.splice(0);
    for (const resolve of waiters) resolve();
    this.emit({ type: "error", data: { error: reason } });
    return true;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    const past = [...this.history];
    queueMicrotask(() => {
      if (!this.listeners.has(listener)) return;
      for (const event of past) listener(event);
    });
    return () => this.listeners.delete(listener);
  }
}

const jobs = new Map<string, AnalysisJob>();

export function getActiveJob(activityId: string) {
  const job = jobs.get(activityId);
  if (!job || job.finished) return null;
  return job;
}

export function getJob(activityId: string, jobId: string) {
  const job = jobs.get(activityId);
  if (!job || job.id !== jobId) return null;
  return job;
}

export function cancelAnalysisJob(activityId: string, reason = "Análise cancelada.") {
  const job = getActiveJob(activityId);
  if (!job) return false;
  return job.cancel(reason);
}

export function pauseAnalysisJob(activityId: string) {
  const job = getActiveJob(activityId);
  if (!job) return false;
  return job.pause();
}

export function resumeAnalysisJob(activityId: string) {
  const job = getActiveJob(activityId);
  if (!job) return false;
  return job.resume();
}

/** Espera se o job da atividade estiver pausado (entre trechos/vídeos). */
export async function waitIfAnalysisPaused(activityId: string, signal?: AbortSignal) {
  const job = getActiveJob(activityId);
  if (!job) return;
  await job.waitWhilePaused(signal);
}

export function launchAnalysisJob(
  activityId: string,
  run: (
    onProgress: (event: Record<string, unknown>) => void,
    signal: AbortSignal,
  ) => Promise<Record<string, unknown>>,
) {
  const active = getActiveJob(activityId);
  if (active) return active;

  const job = new AnalysisJob();
  jobs.set(activityId, job);

  void (async () => {
    try {
      const result = await run((event) => job.emit({ type: "progress", data: event }), job.signal);
      if (!job.finished) job.emit({ type: "done", data: result });
    } catch (error) {
      if (job.finished) return;
      const aborted =
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && error.name === "AbortError") ||
        job.signal.aborted;
      job.emit({
        type: "error",
        data: {
          error: aborted
            ? "Análise cancelada."
            : toUserMessage(error, "Não foi possível concluir a análise agora. Tente novamente em instantes."),
        },
      });
    }
  })();

  return job;
}

export type { AnalysisJob };
