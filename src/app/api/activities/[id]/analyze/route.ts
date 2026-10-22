import {
  launchAnalysisJob,
  getActiveJob,
  getJob,
  pauseAnalysisJob,
  resumeAnalysisJob,
  type AnalysisJob,
} from "@/lib/analysis-job";
import { cancelActivityAnalysis, runAnalysisPipeline } from "@/lib/pipeline";
import { getActivity } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 3600;

type Params = { params: Promise<{ id: string }> };

function encodeSse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const requestedJob = request.headers.get("x-analysis-job");

  if (requestedJob) {
    const job = getJob(id, requestedJob);
    if (!job) {
      return Response.json(
        { error: "A análise em andamento foi interrompida. Inicie de novo." },
        { status: 409 },
      );
    }
    return streamJob(job);
  }

  const active = getActiveJob(id);
  if (active) return streamJob(active);

  const activity = await getActivity(id);
  if (!activity) {
    return Response.json({ error: "Atividade não encontrada." }, { status: 404 });
  }
  if (!activity.videos.length) {
    return Response.json({ error: "Adicione ao menos um vídeo antes de analisar." }, { status: 400 });
  }
  if (!activity.prompt.trim()) {
    return Response.json({ error: "Informe o prompt com os movimentos a reconhecer." }, { status: 400 });
  }

  const maxVideos = Number(request.headers.get("x-max-videos") || 0);
  const scopedActivity =
    Number.isFinite(maxVideos) && maxVideos > 0
      ? { ...activity, videos: activity.videos.slice(0, maxVideos) }
      : activity;

  const job = launchAnalysisJob(id, async (onProgress, signal) => {
    const result = await runAnalysisPipeline(scopedActivity, {
      source: "manual",
      signal,
      onProgress: (event) => onProgress({ ...event }),
    });
    return { activity: result.activity, run: result.run };
  });

  return streamJob(job);
}

/** Pausa ou retoma a análise em andamento (cooperativo: vale no próximo trecho/vídeo). */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const activity = await getActivity(id);
  if (!activity) {
    return Response.json({ error: "Atividade não encontrada." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  const action = body?.action;
  const active = getActiveJob(id);

  if (!active) {
    return Response.json({ error: "Nenhuma análise em andamento." }, { status: 409 });
  }

  if (action === "pause") {
    const ok = pauseAnalysisJob(id);
    return Response.json({ ok, paused: true });
  }
  if (action === "resume") {
    const ok = resumeAnalysisJob(id);
    return Response.json({ ok, paused: false });
  }

  return Response.json({ error: "Use action: pause ou resume." }, { status: 400 });
}

/** Interrompe a análise em andamento (job em memória + runs no banco). */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const activity = await getActivity(id);
  if (!activity) {
    return Response.json({ error: "Atividade não encontrada." }, { status: 404 });
  }

  const result = await cancelActivityAnalysis(id, "Análise cancelada.");
  return Response.json({ ok: true, ...result });
}

function streamJob(job: AnalysisJob) {
  let unsubscribe = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeSse(event, data)));
      };

      ping = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          closed = true;
        }
      }, 15000);

      unsubscribe = job.subscribe((event) => {
        const name = event.type === "progress" ? "progress" : event.type;
        send(name, { ...event.data, jobId: job.id });
        if (event.type !== "progress") {
          closed = true;
          if (ping) clearInterval(ping);
          unsubscribe();
          try {
            controller.close();
          } catch {
            closed = true;
          }
        }
      });
    },
    cancel() {
      unsubscribe();
      if (ping) clearInterval(ping);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
