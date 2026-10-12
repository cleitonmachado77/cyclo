import {
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { renderChart, type ChartImage } from "@/lib/report-chart";
import { tintColor } from "@/lib/report-layout";
import { qualitativeIsEmpty } from "@/lib/report-qualitative";
import type { ReportChart, ReportView } from "@/lib/report-view";

export async function renderReportDocx(view: ReportView) {
  const accent = view.accent.replace("#", "");
  const charts = (
    await Promise.all(view.charts.map(async (chart) => ({ chart, image: await renderChart(chart) })))
  ).filter((item): item is { chart: ReportChart; image: ChartImage } => Boolean(item.image));
  const children = [
    heading("Cyclo.ia", HeadingLevel.TITLE, accent),
    heading("Relatório de cronometragem", HeadingLevel.HEADING_1, accent),
    text(`Atividade: ${view.activity}`),
    text(`Gerado em: ${view.generatedAt}`),
    text(`Status: ${view.status}`),
    text(`Modelo: ${view.models}`),
    text(view.coverage),
    heading("Resumo", HeadingLevel.HEADING_2, accent),
    text(view.summary),
    ...qualitativeBlock(view, accent),
    ...(view.warning ? [text(`Aviso: ${view.warning}`, "9A3412")] : []),
    ...(view.includeKpis ? [heading("Indicadores", HeadingLevel.HEADING_2, accent), kpiTable(view, accent)] : []),
    ...charts.flatMap((item) => chartBlock(item.image, item.chart.title, item.chart.caption, accent)),
    ...(view.includeDetail ? view.videos.flatMap((video) => videoBlock(video, accent)) : []),
    ...failureBlock(view),
  ];

  const document = new Document({
    title: `Relatório ${view.activity}`,
    creator: "Cyclo.ia",
    sections: [{ children }],
  });
  return Packer.toBuffer(document);
}

function qualitativeBlock(view: ReportView, accent: string) {
  if (qualitativeIsEmpty(view.qualitative)) return [];
  return [
    heading("Observações qualitativas sobre ergonomia, fluidez e oportunidades de melhoria.", HeadingLevel.HEADING_2, accent),
    ...qualitativeGroup("Ergonomia", view.qualitative.ergonomics),
    ...qualitativeGroup("Fluidez", view.qualitative.flow),
    ...qualitativeGroup("Oportunidades de melhoria", view.qualitative.improvements),
  ];
}

function qualitativeGroup(title: string, items: string[]) {
  if (!items.length) return [];
  return [text(title, "0F172A"), ...items.map((item) => text(`• ${item}`))];
}

function videoBlock(video: ReportView["videos"][number], accent: string) {
  const blocks = [
    heading(video.fileName, HeadingLevel.HEADING_2, accent),
    text(`Tempo dos elementos: ${video.total}`),
    ...(video.observations ? [text(video.observations)] : []),
  ];
  if (!video.rows.length) return [...blocks, text("Nenhum movimento medido.")];
  return [...blocks, movementTable(video.rows, accent)];
}

function failureBlock(view: ReportView) {
  if (!view.failures.length) return [];
  return [
    heading("Vídeos com falha", HeadingLevel.HEADING_2, "9A3412"),
    ...view.failures.map((failure) => text(`${failure.fileName}: ${failure.error}`, "9A3412")),
  ];
}

function chartBlock(chart: ChartImage | null, title: string, caption: string, accent: string) {
  if (!chart) return [];
  const displayWidth = 620;
  const displayHeight = Math.round((displayWidth * chart.height) / chart.width);
  return [
    heading(title, HeadingLevel.HEADING_2, accent),
    new Paragraph({
      children: [
        new ImageRun({
          type: "png",
          data: chart.png,
          transformation: { width: displayWidth, height: displayHeight },
          altText: { title, description: caption, name: title },
        }),
      ],
    }),
    text(caption, "64748B"),
  ];
}

function kpiTable(view: ReportView, accent: string) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: view.kpis.slice(0, 3).map((kpi) => kpiCell(kpi.label, kpi.value, accent)),
      }),
      new TableRow({
        children: view.kpis.slice(3).map((kpi) => kpiCell(kpi.label, kpi.value, accent)),
      }),
    ],
  });
}

function movementTable(rows: ReportView["videos"][number]["rows"], accent: string) {
  const widths = [1800, 1400, 1100, 1100, 1200, 3400];
  const header = ["Movimento", "Status", "Início", "Fim", "Duração", "Notas"];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: header.map((label, index) => cell(label, widths[index], true, accent)),
      }),
      ...rows.map(
        (row) =>
          new TableRow({
            children: [row.name, row.status, row.start, row.end, row.duration, row.notes].map((value, index) =>
              cell(value, widths[index], false, accent),
            ),
          }),
      ),
    ],
  });
}

function kpiCell(label: string, value: string, accent: string) {
  return new TableCell({
    width: { size: 3000, type: WidthType.DXA },
    shading: { fill: tintColor(`#${accent}`).replace("#", "") },
    children: [
      new Paragraph({ children: [run(label, { size: 16, color: "64748B" })] }),
      new Paragraph({ children: [run(value, { bold: true, size: 24 })] }),
    ],
  });
}

function cell(value: string, width: number, header: boolean, accent: string) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: header ? { fill: accent } : undefined,
    children: [new Paragraph({ children: [run(value || "—", { bold: header, color: header ? "FFFFFF" : "1F2933", size: 16 })] })],
  });
}

function heading(value: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel], accent: string) {
  return new Paragraph({
    heading: level,
    spacing: { before: 280, after: 80 },
    children: [run(value, { bold: true, color: level === HeadingLevel.HEADING_1 ? "0F172A" : accent })],
  });
}

function text(value: string, color = "334155") {
  return new Paragraph({
    spacing: { after: 80 },
    children: [run(value, { color, size: 21 })],
  });
}

function run(value: string, options: { bold?: boolean; color?: string; size?: number }) {
  return new TextRun({
    text: value,
    bold: options.bold,
    color: options.color,
    size: options.size,
    font: "Calibri",
  });
}
