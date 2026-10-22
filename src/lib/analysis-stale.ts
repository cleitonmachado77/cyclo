import { getActiveJob } from "@/lib/analysis-job";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { Activity, ActivityStatus } from "@/types/activity";

/**
 * Jobs vivem só em memória. Após restart/crash o DB pode ficar em "analyzing"
 * sem esteira real — normaliza para ready/done/draft e fecha runs abertos.
 */
export async function reconcileStaleAnalyzing(activity: Activity): Promise<Activity> {
  if (activity.status !== "analyzing") return activity;
  if (getActiveJob(activity.id)) return activity;

  const nextStatus: ActivityStatus = activity.analysis
    ? "done"
    : activity.videos.length && activity.prompt.trim()
      ? "ready"
      : "draft";

  const supabase = getSupabaseAdmin();
  const reason = "Análise interrompida (servidor reiniciou ou a esteira não está mais ativa).";

  const { data: runs } = await supabase
    .from("analysis_runs")
    .select("id")
    .eq("activity_id", activity.id)
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

  const { error } = await supabase
    .from("activities")
    .update({
      gemini_status: nextStatus,
      gemini_error: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", activity.id)
    .eq("gemini_status", "analyzing");

  if (error) throw new Error(error.message);

  return {
    ...activity,
    status: nextStatus,
    errorMessage: reason,
    updatedAt: new Date().toISOString(),
  };
}

export async function reconcileStaleAnalyzingMany(activities: Activity[]): Promise<Activity[]> {
  return Promise.all(activities.map((activity) => reconcileStaleAnalyzing(activity)));
}
