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

  private seq = 0;

  emit(event: AnalysisJobEvent) {
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

export function launchAnalysisJob(
  activityId: string,
  run: (onProgress: (event: Record<string, unknown>) => void) => Promise<Record<string, unknown>>,
) {
  const active = getActiveJob(activityId);
  if (active) return active;

  const job = new AnalysisJob();
  jobs.set(activityId, job);

  void (async () => {
    try {
      const result = await run((event) => job.emit({ type: "progress", data: event }));
      job.emit({ type: "done", data: result });
    } catch (error) {
      job.emit({
        type: "error",
        data: {
          error: toUserMessage(error, "Não foi possível concluir a análise agora. Tente novamente em instantes."),
        },
      });
    }
  })();

  return job;
}

export type { AnalysisJob };
