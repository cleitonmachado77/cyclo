import { formatSeconds } from "@/lib/format";
import { buildQualitative, type QualitativeSection } from "@/lib/report-qualitative";
import { measureText, stageHeading } from "@/lib/report-stages";
import { formatReportDate, reportFileBase, reportStatusLabel } from "@/lib/report-txt";
import type { MovementTiming } from "@/types/activity";
import type { ConsolidatedReport, RunStatus } from "@/types/pipeline";

export type ChartPoint = {
  label: string;
  value: number;
};

export type ReportChart = {
  title: string;
  caption: string;
  kind: "bar" | "column";
  color: string;
  points: ChartPoint[];
};

export type ReportView = {
  fileBase: string;
  activity: string;
  generatedAt: string;
  status: string;
  models: string;
  coverage: string;
  summary: string;
  warning: string | null;
  qualitative: QualitativeSection;
  prompt: string;
  accent: string;
  includeKpis: boolean;
  includeDetail: boolean;
  charts: ReportChart[];
  kpis: Array<{ label: string; value: string }>;
  averages: ChartPoint[];
  averageDetails: string[];
  cycles: ChartPoint[];
  cycleNote: string | null;
  videos: Array<{
    stageTitle: string;
    fileName: string;
    total: string;
    observations: string;
    rows: Array<{
      measure: number;
      line: string;
      name: string;
      status: string;
      start: string;
      end: string;
      duration: string;
      notes: string;
    }>;
  }>;
  failures: Array<{ fileName: string; error: string }>;
};

const CYCLE_NAME = "ciclo completo";
const MAX_CYCLES = 60;

export function buildReportView(input: {
  title: string;
  status: RunStatus;
  errorMessage?: string | null;
  prompt?: string | null;
  report: ConsolidatedReport;
}): ReportView {
  const { report } = input;
  const cycle = findMovement(report, CYCLE_NAME);
  const idle = findMovement(report, "tempo ocioso");
  const idleTotal = (idle?.samples || []).reduce((sum, sample) => sum + sample.durationSeconds, 0);
  const cycleSamples = cycle?.samples || [];
  const shown = cycleSamples.slice(0, MAX_CYCLES);

  return {
    fileBase: reportFileBase(input.title, report.generatedAt),
    activity: input.title,
    generatedAt: formatReportDate(report.generatedAt),
    status: reportStatusLabel(input.status),
    models: report.models.join(", ") || "—",
    coverage: `${report.successCount} de ${report.videoCount} vídeos analisados`,
    summary: report.summary || "Sem resumo.",
    warning: input.errorMessage || null,
    qualitative: buildQualitative(report.videos),
    prompt: input.prompt || "",
    accent: "#0f766e",
    includeKpis: true,
    includeDetail: true,
    charts: [],
    kpis: [
      { label: "Ciclos completos", value: String(cycle?.sampleCount || 0) },
      { label: "Média do ciclo", value: cycle ? formatSeconds(cycle.avgDurationSeconds) : "—" },
      { label: "Ciclo mínimo", value: cycle ? formatSeconds(cycle.minDurationSeconds) : "—" },
      { label: "Ciclo máximo", value: cycle ? formatSeconds(cycle.maxDurationSeconds) : "—" },
      { label: "Tempo ocioso", value: idle ? formatSeconds(idleTotal) : "—" },
      { label: "Ocorrências ociosas", value: idle ? String(idle.sampleCount) : "0" },
    ],
    averages: report.movements.map((movement) => ({
      label: movement.name,
      value: round(movement.avgDurationSeconds),
    })),
    averageDetails: report.movements.map(
      (movement) =>
        `n=${movement.sampleCount} · mín ${formatSeconds(movement.minDurationSeconds)} · máx ${formatSeconds(movement.maxDurationSeconds)}`,
    ),
    cycles: shown.map((sample, index) => ({
      label: String(index + 1),
      value: round(sample.durationSeconds),
    })),
    cycleNote:
      cycleSamples.length > shown.length
        ? `Gráfico com os primeiros ${shown.length} de ${cycleSamples.length} ciclos completos.`
        : null,
    videos: report.videos.map((video, stage) => ({
      stageTitle: stageHeading(stage + 1, video.fileName, video.totalDurationSeconds),
      fileName: video.fileName,
      total: formatSeconds(video.totalDurationSeconds),
      observations: video.observations || "",
      rows: video.movements.map((movement, index) => ({
        measure: index + 1,
        line: measureText(movement),
        name: movement.name,
        status: movementStatus(movement.status),
        start: movement.startTime,
        end: movement.endTime,
        duration: formatSeconds(movement.durationSeconds),
        notes: movement.notes || "",
      })),
    })),
    failures: (report.itemErrors || []).map((item) => ({
      fileName: item.fileName,
      error: item.error,
    })),
  };
}

function findMovement(report: ConsolidatedReport, name: string) {
  return report.movements.find((movement) => movement.name.trim().toLowerCase() === name);
}

function movementStatus(status?: MovementTiming["status"]) {
  if (status === "complete") return "Completo";
  if (status === "partial") return "Parcial";
  if (status === "not_found") return "Não encontrado";
  return "—";
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
