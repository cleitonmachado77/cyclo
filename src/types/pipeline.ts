import type { AnalysisResult, MovementTiming, VideoAnalysis } from "@/types/activity";

export type PipelineSource = "manual" | "camera" | "api";

export type RunStatus = "queued" | "running" | "done" | "error" | "partial";
export type ItemStatus = "queued" | "processing" | "done" | "error" | "skipped";

export type SegmentGap = {
  startTime: string;
  endTime: string;
  reason: string;
};

export type AnalysisItemResult = {
  videoId: string;
  fileName: string;
  summary?: string;
  movements: MovementTiming[];
  totalDurationSeconds: number;
  observations?: string;
  model?: string;
  rawText?: string;
  gaps?: SegmentGap[];
  segmentCount?: number;
};

export type ConsolidatedMovement = {
  name: string;
  sampleCount: number;
  avgDurationSeconds: number;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  samples: Array<{
    videoId: string;
    fileName: string;
    durationSeconds: number;
    startTime: string;
    endTime: string;
  }>;
};

export type ConsolidatedReport = {
  generatedAt: string;
  summary: string;
  videoCount: number;
  successCount: number;
  errorCount: number;
  models: string[];
  movements: ConsolidatedMovement[];
  videos: VideoAnalysis[];
  itemErrors?: Array<{ videoId: string; fileName: string; error: string }>;
};

export type AnalysisRun = {
  id: string;
  activityId: string;
  status: RunStatus;
  source: PipelineSource;
  prompt: string;
  consolidatedReport: ConsolidatedReport | null;
  errorMessage?: string | null;
  retentionHours: number;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  items: AnalysisItem[];
};

export type AnalysisItem = {
  id: string;
  runId: string;
  videoId: string;
  fileName?: string;
  sortOrder: number;
  status: ItemStatus;
  result: AnalysisItemResult | null;
  errorMessage?: string | null;
  model?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};

export type MonitorStageStatus = "pending" | "active" | "done" | "error" | "skipped";

export type MonitorStage = {
  id: string;
  label: string;
  status: MonitorStageStatus;
  detail?: string;
};

export type PipelineProgressEvent = {
  phase:
    | "queued"
    | "item_start"
    | "item_progress"
    | "item_done"
    | "item_error"
    | "consolidating"
    | "done"
    | "error";
  percent: number;
  message: string;
  detail?: string;
  runId?: string;
  itemId?: string;
  videoId?: string;
  fileName?: string;
  videoIndex?: number;
  videoCount?: number;
  itemPercent?: number;
  stages?: MonitorStage[];
  elapsedSeconds?: number;
  etaSeconds?: number | null;
  startedAt?: number;
  segmentIndex?: number;
  segmentCount?: number;
};

/** Converte AnalysisResult legado (multi) em relatório consolidado simples */
export function analysisResultToLegacy(report: ConsolidatedReport, model: string): AnalysisResult {
  return {
    analyzedAt: report.generatedAt,
    model: model || report.models[0] || "pipeline",
    summary: report.summary,
    videos: report.videos,
  };
}
