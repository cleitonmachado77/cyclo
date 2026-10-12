import { reportDownloadName } from "@/lib/report-txt";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { ConsolidatedReport, RunStatus } from "@/types/pipeline";

export type ActivityReportSummary = {
  id: string;
  status: RunStatus;
  createdAt: string;
  finishedAt: string | null;
  summary: string;
  models: string[];
  fileName: string;
};

export async function listActivityReports(activityId: string, title: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("analysis_runs")
    .select("id, status, created_at, finished_at, consolidated_report")
    .eq("activity_id", activityId)
    .not("consolidated_report", "is", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (data || []).flatMap((row) => {
    const report = asReport(row.consolidated_report);
    if (!report) return [];
    const summary: ActivityReportSummary = {
      id: String(row.id),
      status: row.status as RunStatus,
      createdAt: String(row.created_at),
      finishedAt: row.finished_at ? String(row.finished_at) : null,
      summary: report.summary,
      models: report.models,
      fileName: reportDownloadName(title, report.generatedAt),
    };
    return [summary];
  });
}

export async function readActivityReport(activityId: string, runId: string, title: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("analysis_runs")
    .select("id, status, error_message, prompt, consolidated_report")
    .eq("activity_id", activityId)
    .eq("id", runId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const report = data ? asReport(data.consolidated_report) : null;
  if (!data || !report) return null;

  return {
    title,
    status: data.status as RunStatus,
    errorMessage: (data.error_message as string | null) || null,
    prompt: typeof data.prompt === "string" ? data.prompt : "",
    report,
  };
}

function asReport(value: unknown): ConsolidatedReport | null {
  if (!value || typeof value !== "object") return null;
  const report = value as ConsolidatedReport;
  if (typeof report.generatedAt !== "string" || !Array.isArray(report.videos)) return null;
  return report;
}
