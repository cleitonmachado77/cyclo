import { formatSeconds } from "@/lib/format";
import { buildQualitative, type QualitativeSection } from "@/lib/report-qualitative";
import { measureText, stageHeading } from "@/lib/report-stages";
import { STUDY_METHOD, buildStationViews, type StationView } from "@/lib/report-study";
import { formatReportDate, reportFileBase, reportStatusLabel } from "@/lib/report-txt";
import { UNASSIGNED_STATION, buildStationStudies, elementTypeOf } from "@/lib/time-study";
import type { MovementTiming } from "@/types/activity";
import type { ConsolidatedMovement, ConsolidatedReport, RunStatus } from "@/types/pipeline";

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

export type StationCycles = {
  station: string;
  points: ChartPoint[];
  note: string | null;
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
  stationCycles: StationCycles[];
  stations: StationView[];
  studyMethod: string;
  videos: Array<{
    stageTitle: string;
    fileName: string;
    total: string;
    observations: string;
    rows: Array<{
      measure: number;
      line: string;
      name: string;
      station: string;
      elementType: string;
      cycle: string;
      operator: string;
      status: string;
      start: string;
      end: string;
      duration: string;
      notes: string;
    }>;
  }>;
  failures: Array<{ fileName: string; error: string }>;
};

const MAX_CYCLES = 60;

export function buildReportView(input: {
  title: string;
  status: RunStatus;
  errorMessage?: string | null;
  prompt?: string | null;
  report: ConsolidatedReport;
}): ReportView {
  const { report } = input;
  const studies = buildStationStudies(report.videos);
  const leaves = report.movements.filter((movement) => !isRollupName(movement));
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const observed = sum(studies.map((study) => study.observedSeconds));
  const waits = sum(studies.map((study) => study.waits.totalSeconds));
  const foreign = sum(studies.map((study) => study.foreign.totalSeconds));
  const noVision = sum(studies.map((study) => study.noVisionSeconds));

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
      { label: "Postos separados", value: String(studies.filter((study) => study.station !== UNASSIGNED_STATION).length) },
      { label: "Ciclos completos", value: String(sum(studies.map((study) => study.cycleCount))) },
      { label: "Tempo observado", value: formatSeconds(observed) },
      { label: "Esperas", value: `${formatSeconds(waits)} (${share(waits, observed)})` },
      { label: "Elementos estranhos", value: `${formatSeconds(foreign)} (${share(foreign, observed)})` },
      { label: "Sem visão do posto", value: formatSeconds(noVision) },
    ],
    averages: leaves.map((movement) => ({
      label: chartLabel(movement),
      value: round(movement.avgDurationSeconds),
    })),
    averageDetails: leaves.map(
      (movement) =>
        `n=${movement.sampleCount} · mín ${formatSeconds(movement.minDurationSeconds)} · máx ${formatSeconds(movement.maxDurationSeconds)}`,
    ),
    stationCycles: stationCycles(report),
    stations: buildStationViews(studies),
    studyMethod: STUDY_METHOD,
    videos: report.videos.map((video, stage) => ({
      stageTitle: stageHeading(stage + 1, video.fileName, video.totalDurationSeconds),
      fileName: video.fileName,
      total: formatSeconds(video.totalDurationSeconds),
      observations: video.observations || "",
      rows: video.movements.map((movement, index) => ({
        measure: index + 1,
        line: measureText(movement),
        name: movement.name,
        station: movement.station || UNASSIGNED_STATION,
        elementType: elementTypeOf(movement),
        cycle: movement.cycle ? String(movement.cycle) : "",
        operator: movement.operator || "",
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

export function chartLabel(movement: Pick<ConsolidatedMovement, "name" | "station">) {
  if (!movement.station || movement.station === UNASSIGNED_STATION) return movement.name;
  return `${movement.station.replace(/^Posto\s+/i, "P")} · ${movement.name}`;
}

function stationCycles(report: ConsolidatedReport): StationCycles[] {
  return report.movements
    .filter((movement) => movement.name.trim().toLowerCase() === "ciclo completo" && movement.samples.length >= 2)
    .map((movement) => {
      const shown = movement.samples.slice(0, MAX_CYCLES);
      return {
        station: movement.station || UNASSIGNED_STATION,
        points: shown.map((sample, index) => ({ label: String(index + 1), value: round(sample.durationSeconds) })),
        note:
          movement.samples.length > shown.length
            ? `Gráfico com os primeiros ${shown.length} de ${movement.samples.length} ciclos.`
            : null,
      };
    });
}

function isRollupName(movement: ConsolidatedMovement) {
  const key = movement.name.trim().toLowerCase();
  return key === "ciclo completo" || key === "esteira de processo";
}

function movementStatus(status?: MovementTiming["status"]) {
  if (status === "complete") return "Completo";
  if (status === "partial") return "Parcial";
  if (status === "not_found") return "Não encontrado";
  return "—";
}

function share(part: number, total: number) {
  if (!total) return "0,0%";
  return `${((part / total) * 100).toFixed(1).replace(".", ",")}%`;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
