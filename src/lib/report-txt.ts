import { formatSeconds } from "@/lib/format";
import { buildQualitative, qualitativeIsEmpty } from "@/lib/report-qualitative";
import { STAGE_SECTION, measureText, stageHeading } from "@/lib/report-stages";
import type { ConsolidatedReport, RunStatus } from "@/types/pipeline";

const STATUS_LABEL: Record<RunStatus, string> = {
  queued: "Na fila",
  running: "Em andamento",
  done: "Concluído",
  partial: "Parcial",
  error: "Com falha",
};

export function reportFileBase(title: string, generatedAt: string) {
  const slug =
    title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "atividade";
  return `relatorio-${slug}-${fileStamp(generatedAt)}`;
}

export function reportDownloadName(title: string, generatedAt: string) {
  return `${reportFileBase(title, generatedAt)}.txt`;
}

export function reportStatusLabel(status: RunStatus) {
  return STATUS_LABEL[status] || status;
}

export function renderReportTxt(input: {
  title: string;
  status: RunStatus;
  errorMessage?: string | null;
  report: ConsolidatedReport;
}) {
  const { report } = input;
  const blocks = [
    "Cyclo.ia — Relatório de cronometragem",
    `Atividade: ${input.title}`,
    `Gerado em: ${formatReportDate(report.generatedAt)}`,
    `Status: ${STATUS_LABEL[input.status] || input.status}`,
    `Modelo: ${report.models.join(", ") || "—"}`,
    `Vídeos: ${report.successCount} de ${report.videoCount} analisados`,
    "",
    "Resumo",
    report.summary || "Sem resumo.",
  ];

  if (input.errorMessage) {
    blocks.push("", "Aviso", input.errorMessage);
  }

  const qualitative = buildQualitative(report.videos);
  if (!qualitativeIsEmpty(qualitative)) {
    blocks.push("", "Observações qualitativas sobre ergonomia, fluidez e oportunidades de melhoria.");
    blocks.push(...qualitativeLines("Ergonomia", qualitative.ergonomics));
    blocks.push(...qualitativeLines("Fluidez", qualitative.flow));
    blocks.push(...qualitativeLines("Oportunidades de melhoria", qualitative.improvements));
  }

  if (report.movements.length) {
    blocks.push("", "Tempos consolidados");
    for (const movement of report.movements) {
      blocks.push(
        `- ${movement.name}: média ${formatSeconds(movement.avgDurationSeconds)} (n=${movement.sampleCount}, mín ${formatSeconds(movement.minDurationSeconds)}, máx ${formatSeconds(movement.maxDurationSeconds)})`,
      );
    }
  }

  if (report.videos.length) {
    blocks.push("", STAGE_SECTION);
    report.videos.forEach((video, stage) => {
      blocks.push("", stageHeading(stage + 1, video.fileName, video.totalDurationSeconds));
      if (video.observations) blocks.push(`Observações: ${video.observations}`);
      if (!video.movements.length) {
        blocks.push("Nenhum movimento medido.");
        return;
      }
      video.movements.forEach((movement, index) => {
        blocks.push(`${index + 1}. ${measureText(movement)}`);
      });
    });
  }

  if (report.itemErrors?.length) {
    blocks.push("", "Vídeos com falha");
    for (const item of report.itemErrors) {
      blocks.push(`- ${item.fileName}: ${item.error}`);
    }
  }

  blocks.push("");
  return blocks.join("\n");
}

function qualitativeLines(title: string, items: string[]) {
  if (!items.length) return [];
  return ["", title, ...items.map((item) => `- ${item}`)];
}

export function formatReportDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function fileStamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sem-data";
  const parts = new Intl.DateTimeFormat("pt-BR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "00";
  return `${read("year")}${read("month")}${read("day")}-${read("hour")}${read("minute")}`;
}
