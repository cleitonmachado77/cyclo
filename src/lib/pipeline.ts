import type { Activity, VideoAnalysis, VideoFile } from "@/types/activity";
import type {
  AnalysisItem,
  AnalysisItemResult,
  AnalysisRun,
  ConsolidatedMovement,
  ConsolidatedReport,
  PipelineProgressEvent,
  PipelineSource,
} from "@/types/pipeline";
import { analysisResultToLegacy } from "@/types/pipeline";
import { AnalysisEta } from "@/lib/analysis-eta";
import { analyzeStoredVideo } from "@/lib/analyze-video";
import { cancelAnalysisJob, waitIfAnalysisPaused } from "@/lib/analysis-job";
import { toUserMessage } from "@/lib/errors";
import { getActivity, updateActivity } from "@/lib/store";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { buildStationStudies, elementTypeOf, mergeStations, stationOf } from "@/lib/time-study";
import { formatSeconds } from "@/lib/format";

const DEFAULT_RETENTION_HOURS = Number(process.env.VIDEO_RETENTION_HOURS || 72);

type ProgressCallback = (event: PipelineProgressEvent) => void;

function mapItem(row: Record<string, unknown>, fileName?: string): AnalysisItem {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    videoId: String(row.video_id),
    fileName,
    sortOrder: Number(row.sort_order || 0),
    status: row.status as AnalysisItem["status"],
    result: (row.result as AnalysisItemResult) || null,
    errorMessage: (row.error_message as string) || null,
    model: (row.model as string) || null,
    startedAt: (row.started_at as string) || null,
    finishedAt: (row.finished_at as string) || null,
  };
}

export async function getLatestRun(activityId: string): Promise<AnalysisRun | null> {
  const supabase = getSupabaseAdmin();
  const { data: run, error } = await supabase
    .from("analysis_runs")
    .select("*")
    .eq("activity_id", activityId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!run) return null;

  const { data: items, error: itemsError } = await supabase
    .from("analysis_items")
    .select("*")
    .eq("run_id", run.id)
    .order("sort_order", { ascending: true });

  if (itemsError) throw new Error(itemsError.message);

  return {
    id: run.id,
    activityId: run.activity_id,
    status: run.status,
    source: run.source,
    prompt: run.prompt,
    consolidatedReport: run.consolidated_report,
    errorMessage: run.error_message,
    retentionHours: run.retention_hours,
    createdAt: run.created_at,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    items: (items || []).map((item) => mapItem(item)),
  };
}

export function buildConsolidatedReport(
  activity: Activity,
  results: Array<{ video: VideoFile; result?: AnalysisItemResult; error?: string }>,
): ConsolidatedReport {
  const successes = results.filter((item) => item.result);
  const errors = results.filter((item) => item.error);

  const movementMap = new Map<string, ConsolidatedMovement>();

  for (const entry of successes) {
    const result = entry.result!;
    for (const movement of result.movements) {
      if (movement.status === "not_found") continue;
      if (!movement.durationSeconds || movement.durationSeconds <= 0) continue;
      if (elementTypeOf(movement) === "sem_visao") continue;

      const station = stationOf(movement);
      const key = `${station}|${movement.name.trim().toLowerCase()}`;
      const current = movementMap.get(key) || {
        name: movement.name,
        station,
        sampleCount: 0,
        avgDurationSeconds: 0,
        minDurationSeconds: Number.POSITIVE_INFINITY,
        maxDurationSeconds: 0,
        samples: [],
      };

      current.sampleCount += 1;
      current.minDurationSeconds = Math.min(current.minDurationSeconds, movement.durationSeconds);
      current.maxDurationSeconds = Math.max(current.maxDurationSeconds, movement.durationSeconds);
      current.samples.push({
        videoId: entry.video.id,
        fileName: entry.video.originalName,
        durationSeconds: movement.durationSeconds,
        startTime: movement.startTime,
        endTime: movement.endTime,
      });
      current.avgDurationSeconds =
        current.samples.reduce((sum, sample) => sum + sample.durationSeconds, 0) /
        current.samples.length;
      movementMap.set(key, current);
    }
  }

  const movements = [...movementMap.values()].map((item) => ({
    ...item,
    minDurationSeconds:
      item.minDurationSeconds === Number.POSITIVE_INFINITY ? 0 : item.minDurationSeconds,
  }));

  const videos: VideoAnalysis[] = successes.map((entry) => ({
    videoId: entry.result!.videoId,
    fileName: entry.result!.fileName,
    movements: entry.result!.movements,
    totalDurationSeconds: entry.result!.totalDurationSeconds,
    observations: entry.result!.observations,
    stations: entry.result!.stations,
  }));
  const studies = buildStationStudies(videos);

  const models = [
    ...new Set(successes.map((entry) => entry.result?.model).filter(Boolean) as string[]),
  ];

  const timedVideos = videos.filter((video) => video.totalDurationSeconds > 0).length;
  const zeroVideos = videos.length - timedVideos;

  const summaryParts = [
    `Processados ${successes.length} de ${results.length} vídeo(s).`,
  ];
  if (timedVideos) {
    summaryParts.push(`${timedVideos} com tempos medidos.`);
  }
  if (zeroVideos) {
    summaryParts.push(
      `${zeroVideos} sem ciclo/trabalho cronometrado (critério de conclusão não observado ou só anotações).`,
    );
  }
  if (studies.length) {
    summaryParts.push(
      `${studies.length} posto(s) separados. ${studies
        .map((study) =>
          [
            `${study.station}: ${study.cycleCount} ciclo(s) completo(s)`,
            study.cycleCount ? `ciclo de trabalho médio ${formatSeconds(study.workCycleSeconds)}` : "",
            study.waits.totalSeconds ? `esperas ${formatSeconds(study.waits.totalSeconds)}` : "",
            study.foreign.totalSeconds ? `estranhos ${formatSeconds(study.foreign.totalSeconds)}` : "",
          ]
            .filter(Boolean)
            .join(", "),
        )
        .join("; ")}.`,
    );
  }
  const gapCount = successes.reduce((sum, entry) => sum + (entry.result?.gaps?.length || 0), 0);
  if (gapCount) {
    summaryParts.push(`${gapCount} trecho(s) ficaram de fora, sem tempo inventado.`);
  }
  if (errors.length) {
    summaryParts.push(`${errors.length} vídeo(s) com falha.`);
  }
  return {
    generatedAt: new Date().toISOString(),
    summary: summaryParts.join(" "),
    videoCount: results.length,
    successCount: successes.length,
    errorCount: errors.length,
    models,
    movements,
    videos,
    itemErrors: errors.map((entry) => ({
      videoId: entry.video.id,
      fileName: entry.video.originalName,
      error: entry.error || "Erro",
    })),
  };
}

/** Cancela job em memória e marca runs/itens em andamento no banco. */
export async function cancelActivityAnalysis(activityId: string, reason = "Análise cancelada.") {
  cancelAnalysisJob(activityId, reason);

  const supabase = getSupabaseAdmin();
  const { data: runs } = await supabase
    .from("analysis_runs")
    .select("id")
    .eq("activity_id", activityId)
    .in("status", ["queued", "running"]);

  const runIds = (runs || []).map((run) => String(run.id));
  if (runIds.length) {
    await supabase
      .from("analysis_runs")
      .update({
        status: "error",
        error_message: reason,
        finished_at: new Date().toISOString(),
      })
      .in("id", runIds);

    await supabase
      .from("analysis_items")
      .update({
        status: "skipped",
        error_message: reason,
        finished_at: new Date().toISOString(),
      })
      .in("run_id", runIds)
      .in("status", ["queued", "processing"]);
  }

  const activity = await getActivity(activityId);
  if (activity) {
    await updateActivity(activityId, {
      status: activity.videos.length && activity.prompt.trim() ? "ready" : "draft",
      errorMessage: reason,
    });
  }

  return { cancelled: true, runIds };
}

export async function runAnalysisPipeline(
  activity: Activity,
  options?: {
    source?: PipelineSource;
    retentionHours?: number;
    signal?: AbortSignal;
    onProgress?: ProgressCallback;
  },
): Promise<{ activity: Activity; run: AnalysisRun }> {
  if (!activity.videos.length) {
    throw new Error("Adicione ao menos um vídeo antes de analisar.");
  }
  if (!activity.prompt.trim()) {
    throw new Error("Informe o prompt com os movimentos a reconhecer.");
  }

  const startedAt = Date.now();
  const emit = (event: PipelineProgressEvent) =>
    options?.onProgress?.({
      ...event,
      startedAt,
      elapsedSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
    });
  const supabase = getSupabaseAdmin();
  const retentionHours = options?.retentionHours ?? DEFAULT_RETENTION_HOURS;
  const source = options?.source ?? "manual";

  const { data: runRow, error: runError } = await supabase
    .from("analysis_runs")
    .insert({
      activity_id: activity.id,
      status: "running",
      source,
      prompt: activity.prompt,
      retention_hours: retentionHours,
      started_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (runError || !runRow) {
    throw new Error(runError?.message || "Falha ao criar lote de análise.");
  }

  const itemRows = activity.videos.map((video, index) => ({
    run_id: runRow.id,
    video_id: video.id,
    sort_order: index,
    status: "queued",
  }));

  const { data: createdItems, error: itemsError } = await supabase
    .from("analysis_items")
    .insert(itemRows)
    .select("*");

  if (itemsError || !createdItems) {
    throw new Error(itemsError?.message || "Falha ao enfileirar vídeos.");
  }

  // Define expiração dos vídeos desta esteira
  const expiresAt = new Date(Date.now() + retentionHours * 60 * 60 * 1000).toISOString();
  await supabase
    .from("activity_videos")
    .update({ expires_at: expiresAt, source })
    .in(
      "id",
      activity.videos.map((video) => video.id),
    );

  await updateActivity(activity.id, { status: "analyzing", errorMessage: null });

  emit({
    phase: "queued",
    percent: 2,
    message: `Esteira iniciada com ${activity.videos.length} vídeo(s)`,
    runId: runRow.id,
    videoCount: activity.videos.length,
  });

  const collected: Array<{ video: VideoFile; result?: AnalysisItemResult; error?: string }> = [];
  let knownStations = mergeStations([]);
  const eta = new AnalysisEta();
  const sortedItems = [...createdItems].sort(
    (a, b) => Number(a.sort_order) - Number(b.sort_order),
  );

  for (let index = 0; index < sortedItems.length; index += 1) {
    throwIfAborted(options?.signal);
    await waitIfAnalysisPaused(activity.id, options?.signal);
    throwIfAborted(options?.signal);
    const item = sortedItems[index];
    const video = activity.videos.find((entry) => entry.id === item.video_id);
    if (!video) continue;

    const basePercent = Math.round((index / sortedItems.length) * 85) + 5;

    await supabase
      .from("analysis_items")
      .update({
        status: "processing",
        started_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", item.id);

    emit({
      phase: "item_start",
      percent: basePercent,
      message: `Analisando vídeo ${index + 1}/${sortedItems.length}`,
      detail: video.originalName,
      runId: runRow.id,
      itemId: item.id,
      videoId: video.id,
      fileName: video.originalName,
      videoIndex: index + 1,
      videoCount: sortedItems.length,
      itemPercent: 0,
    });

    try {
      const itemResult = await analyzeStoredVideo({
        activity,
        video,
        eta,
        videosAfter: sortedItems.length - index - 1,
        knownStations,
        signal: options?.signal,
        onCheckpoint: async (partial) => {
          await supabase
            .from("analysis_items")
            .update({ result: partial, model: partial.model || null })
            .eq("id", item.id);
        },
        onProgress: (progress) => {
          emit({
            phase: "item_progress",
            percent: basePercent + Math.round((progress.percent / 100) * (85 / sortedItems.length)),
            message: progress.message,
            detail: progress.detail || video.originalName,
            runId: runRow.id,
            itemId: item.id,
            videoId: video.id,
            fileName: video.originalName,
            videoIndex: index + 1,
            videoCount: sortedItems.length,
            itemPercent: progress.percent,
            stages: progress.stages,
            etaSeconds: progress.etaSeconds,
            segmentIndex: progress.segmentIndex,
            segmentCount: progress.segmentCount,
          });
        },
      });

      await supabase
        .from("analysis_items")
        .update({
          status: "done",
          result: itemResult,
          model: itemResult.model,
          finished_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", item.id);

      collected.push({ video, result: itemResult });
      knownStations = mergeStations([knownStations, itemResult.stations]);

      emit({
        phase: "item_done",
        percent: Math.round(((index + 1) / sortedItems.length) * 85) + 5,
        message: `Vídeo ${index + 1}/${sortedItems.length} concluído`,
        detail: video.originalName,
        runId: runRow.id,
        itemId: item.id,
        videoId: video.id,
        fileName: video.originalName,
        videoIndex: index + 1,
        videoCount: sortedItems.length,
        itemPercent: 100,
      });
    } catch (error) {
      if (isAbortError(error) || options?.signal?.aborted) {
        await markRunCancelled(supabase, runRow.id, activity.id);
        throw error instanceof Error ? error : new DOMException("Análise cancelada.", "AbortError");
      }

      const message = toUserMessage(
        error,
        "Não foi possível analisar este vídeo agora.",
      );

      await supabase
        .from("analysis_items")
        .update({
          status: "error",
          error_message: message,
          finished_at: new Date().toISOString(),
        })
        .eq("id", item.id);

      collected.push({ video, error: message });

      emit({
        phase: "item_error",
        percent: Math.round(((index + 1) / sortedItems.length) * 85) + 5,
        message: `Falha no vídeo ${index + 1}/${sortedItems.length}`,
        detail: `${video.originalName}: ${message}`,
        runId: runRow.id,
        itemId: item.id,
        videoId: video.id,
        fileName: video.originalName,
        videoIndex: index + 1,
        videoCount: sortedItems.length,
      });
    }
  }

  throwIfAborted(options?.signal);

  emit({
    phase: "consolidating",
    percent: 96,
    message: "Gerando relatório consolidado...",
    detail: "Unindo a sequência e calculando os tempos",
    runId: runRow.id,
    stages: [
      { id: "videos", label: "Vídeos em trechos", status: "done" },
      { id: "report", label: "Consolidar relatório", status: "active" },
    ],
    etaSeconds: 0,
  });

  const report = buildConsolidatedReport(activity, collected);
  const successCount = collected.filter((item) => item.result).length;
  const hasGaps = collected.some((item) => item.result?.gaps?.length);
  const finalStatus =
    successCount === 0 ? "error" : successCount < collected.length || hasGaps ? "partial" : "done";
  const partialMessage = hasGaps
    ? "Relatório com lacunas: alguns trechos não puderam ser medidos."
    : "Relatório parcial: alguns vídeos falharam.";

  const { data: finishedRun, error: finishError } = await supabase
    .from("analysis_runs")
    .update({
      status: finalStatus,
      consolidated_report: report,
      error_message:
        finalStatus === "error"
          ? "Nenhum vídeo pôde ser analisado."
          : finalStatus === "partial"
            ? partialMessage
            : null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runRow.id)
    .select("*")
    .single();

  if (finishError) throw new Error(finishError.message);

  const legacy = analysisResultToLegacy(report, report.models[0] || "pipeline");
  const updatedActivity = await updateActivity(activity.id, {
    status: finalStatus === "error" ? "error" : "done",
    analysis: legacy,
    errorMessage:
      finalStatus === "error"
        ? "Nenhum vídeo pôde ser analisado."
        : finalStatus === "partial"
          ? partialMessage
          : null,
  });

  const { data: items } = await supabase
    .from("analysis_items")
    .select("*")
    .eq("run_id", runRow.id)
    .order("sort_order", { ascending: true });

  const run: AnalysisRun = {
    id: finishedRun.id,
    activityId: finishedRun.activity_id,
    status: finishedRun.status,
    source: finishedRun.source,
    prompt: finishedRun.prompt,
    consolidatedReport: finishedRun.consolidated_report,
    errorMessage: finishedRun.error_message,
    retentionHours: finishedRun.retention_hours,
    createdAt: finishedRun.created_at,
    startedAt: finishedRun.started_at,
    finishedAt: finishedRun.finished_at,
    items: (items || []).map((item) => {
      const video = activity.videos.find((entry) => entry.id === item.video_id);
      return mapItem(item, video?.originalName);
    }),
  };

  emit({
    phase: "done",
    percent: 100,
    message: "Esteira concluída",
    detail: report.summary,
    runId: run.id,
  });

  const fresh = (await getActivity(activity.id)) || updatedActivity;
  if (!fresh) throw new Error("Atividade não encontrada após análise.");

  return { activity: fresh, run };
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

async function markRunCancelled(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  runId: string,
  activityId: string,
  reason = "Análise cancelada.",
) {
  await supabase
    .from("analysis_runs")
    .update({
      status: "error",
      error_message: reason,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .in("status", ["queued", "running"]);

  await supabase
    .from("analysis_items")
    .update({
      status: "skipped",
      error_message: reason,
      finished_at: new Date().toISOString(),
    })
    .eq("run_id", runId)
    .in("status", ["queued", "processing"]);

  const activity = await getActivity(activityId);
  if (activity) {
    await updateActivity(activityId, {
      status: activity.videos.length && activity.prompt.trim() ? "ready" : "draft",
      errorMessage: reason,
    });
  }
}
