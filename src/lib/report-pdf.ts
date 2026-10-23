import { existsSync } from "fs";
import PDFDocument from "pdfkit";
import { renderChart, type ChartImage } from "@/lib/report-chart";
import { tintColor } from "@/lib/report-layout";
import { qualitativeIsEmpty } from "@/lib/report-qualitative";
import { STAGE_SECTION } from "@/lib/report-stages";
import { STUDY_SECTION, elementLine, readingLine, stationHeading } from "@/lib/report-study";
import type { ReportView } from "@/lib/report-view";

const FONT = existsSync("C:/Windows/Fonts/arial.ttf") ? "C:/Windows/Fonts/arial.ttf" : "Helvetica";
const FONT_BOLD = existsSync("C:/Windows/Fonts/arialbd.ttf") ? "C:/Windows/Fonts/arialbd.ttf" : "Helvetica-Bold";

export async function renderReportPdf(view: ReportView) {
  const charts = (
    await Promise.all(view.charts.map(async (chart) => ({ caption: chart.caption, image: await renderChart(chart) })))
  ).filter((chart): chart is { caption: string; image: ChartImage } => Boolean(chart.image));
  const doc = new PDFDocument({
    size: "A4",
    margin: 46,
    bufferPages: true,
    info: { Title: `Relatório ${view.activity}`, Author: "Cyclo.ia" },
  });
  const done = collect(doc);

  writeCover(doc, view);
  if (view.includeKpis) writeKpis(doc, view);
  if (view.stations.length) writeStations(doc, view);
  for (const chart of charts) writeChart(doc, chart.image, chart.caption);
  if (view.includeDetail && view.videos.length) {
    ensure(doc, 36);
    doc.moveDown(0.8);
    sectionTitle(doc, STAGE_SECTION, view.accent);
    for (const video of view.videos) writeVideo(doc, video, view.accent);
  }
  if (view.failures.length) writeFailures(doc, view);
  writePageNumbers(doc);

  doc.end();
  return done;
}

function writeCover(doc: PDFKit.PDFDocument, view: ReportView) {
  doc.fillColor(view.accent).font(FONT_BOLD).fontSize(20).text("Cyclo.ia");
  doc.fillColor("#0f172a").fontSize(16).text("Relatório de cronometragem", { paragraphGap: 8 });
  doc.fillColor("#334155").font(FONT).fontSize(11);
  doc.text(`Atividade: ${view.activity}`);
  doc.text(`Gerado em: ${view.generatedAt}`);
  doc.text(`Status: ${view.status}`);
  doc.text(`Modelo: ${view.models}`);
  doc.text(view.coverage);
  doc.moveDown(0.6);
  sectionTitle(doc, "Resumo", view.accent);
  doc.font(FONT).fontSize(11).fillColor("#1f2933").text(view.summary, { lineGap: 2 });
  if (view.warning) {
    doc.moveDown(0.4);
    doc.fillColor("#9a3412").text(`Aviso: ${view.warning}`);
  }
  writeQualitative(doc, view);
}

function writeQualitative(doc: PDFKit.PDFDocument, view: ReportView) {
  if (qualitativeIsEmpty(view.qualitative)) return;
  doc.moveDown(0.6);
  sectionTitle(doc, "Observações qualitativas sobre ergonomia, fluidez e oportunidades de melhoria.", view.accent);
  writeQualitativeGroup(doc, "Ergonomia", view.qualitative.ergonomics);
  writeQualitativeGroup(doc, "Fluidez", view.qualitative.flow);
  writeQualitativeGroup(doc, "Oportunidades de melhoria", view.qualitative.improvements);
}

function writeQualitativeGroup(doc: PDFKit.PDFDocument, title: string, items: string[]) {
  if (!items.length) return;
  ensure(doc, 64);
  doc.moveDown(0.35);
  doc.fillColor("#0f172a").font(FONT_BOLD).fontSize(11).text(title);
  doc.moveDown(0.2);
  doc.fillColor("#334155").font(FONT).fontSize(10);
  doc.list(items, {
    listType: "bullet",
    bulletRadius: 1.5,
    textIndent: 14,
    bulletIndent: 8,
    lineGap: 1,
    paragraphGap: 5,
  });
}

function writeKpis(doc: PDFKit.PDFDocument, view: ReportView) {
  if (!view.kpis.length) return;
  const columns = 3;
  const rows = Math.ceil(view.kpis.length / columns);
  const gap = 8;
  const boxHeight = 50;
  const rowStride = boxHeight + gap;
  doc.moveDown(0.8);
  ensure(doc, 36 + rows * rowStride);
  sectionTitle(doc, "Indicadores", view.accent);
  const boxWidth = (contentWidth(doc) - gap * (columns - 1)) / columns;
  const top = doc.y;
  view.kpis.forEach((kpi, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = doc.page.margins.left + column * (boxWidth + gap);
    const y = top + row * rowStride;
    doc.save();
    doc.roundedRect(x, y, boxWidth, boxHeight, 6).fill(tintColor(view.accent));
    doc.restore();
    doc.fillColor("#64748b").font(FONT).fontSize(8);
    paint(doc, kpi.label, x + 8, y + 8, boxWidth - 16);
    doc.fillColor("#0f172a").font(FONT_BOLD).fontSize(13);
    paint(doc, kpi.value, x + 8, y + 24, boxWidth - 16);
  });
  doc.x = doc.page.margins.left;
  doc.y = top + rows * rowStride;
}

function writeStations(doc: PDFKit.PDFDocument, view: ReportView) {
  doc.moveDown(0.8);
  ensure(doc, 80);
  sectionTitle(doc, STUDY_SECTION, view.accent);
  doc.font(FONT).fontSize(9).fillColor("#64748b").text(view.studyMethod, { lineGap: 1 });
  for (const station of view.stations) {
    ensure(doc, 90);
    doc.moveDown(0.6);
    doc.fillColor("#0f172a").font(FONT_BOLD).fontSize(12).text(stationHeading(station));
    doc.moveDown(0.2);
    doc.font(FONT).fontSize(10).fillColor("#334155");
    for (const item of station.indicators) doc.text(`${item.label}: ${item.value}`, { lineGap: 1 });
    for (const warning of station.warnings) doc.fillColor("#9a3412").text(`Atenção: ${warning}`, { lineGap: 1 });
    writeGroup(doc, "Elementos", station.elements.map(elementLine));
    writeGroup(doc, "Elementos casuais", station.casuals);
    if (station.readings.labels.length) {
      writeGroup(
        doc,
        "Leituras por ciclo (s; 0 = não ocorreu)",
        station.readings.rows.map((row) => readingLine(station.readings.labels, row)),
      );
    }
  }
}

function writeGroup(doc: PDFKit.PDFDocument, title: string, items: string[]) {
  if (!items.length) return;
  ensure(doc, 48);
  doc.moveDown(0.3);
  doc.fillColor("#0f172a").font(FONT_BOLD).fontSize(10).text(title);
  doc.fillColor("#334155").font(FONT).fontSize(9);
  doc.list(items, { listType: "bullet", bulletRadius: 1.5, textIndent: 14, bulletIndent: 8, lineGap: 1, paragraphGap: 3 });
}

function writeChart(doc: PDFKit.PDFDocument, chart: ChartImage | null, caption: string) {
  if (!chart) return;
  const width = contentWidth(doc);
  const height = (width * chart.height) / chart.width;
  doc.moveDown(0.7);
  ensure(doc, height + 24);
  doc.image(chart.png, doc.page.margins.left, doc.y, { width });
  doc.y += height + 6;
  doc.x = doc.page.margins.left;
  doc.fillColor("#64748b").font(FONT).fontSize(9).text(caption);
}

function writeVideo(doc: PDFKit.PDFDocument, video: ReportView["videos"][number], accent: string) {
  ensure(doc, 72);
  doc.moveDown(0.55);
  sectionTitle(doc, video.stageTitle, accent);
  if (video.observations) doc.font(FONT).fontSize(10).fillColor("#334155").text(video.observations, { lineGap: 1 });
  if (!video.rows.length) {
    doc.moveDown(0.3);
    doc.font(FONT).fontSize(10).fillColor("#334155").text("Nenhum movimento medido.");
    return;
  }
  doc.moveDown(0.3);
  for (const row of video.rows) writeMovement(doc, row);
}

function writeMovement(doc: PDFKit.PDFDocument, row: ReportView["videos"][number]["rows"][number]) {
  ensure(doc, 32);
  doc.fillColor("#1f2933").font(FONT).fontSize(10).text(`${row.measure}. ${row.line}`, { lineGap: 1 });
  doc.moveDown(0.2);
}

function writeFailures(doc: PDFKit.PDFDocument, view: ReportView) {
  ensure(doc, 60);
  doc.moveDown(0.6);
  sectionTitle(doc, "Vídeos com falha", "#9a3412");
  doc.font(FONT).fontSize(10).fillColor("#9a3412");
  for (const failure of view.failures) doc.text(`${failure.fileName}: ${failure.error}`);
}

function sectionTitle(doc: PDFKit.PDFDocument, text: string, color: string) {
  doc.fillColor(color).font(FONT_BOLD).fontSize(13).text(text);
  doc.moveDown(0.25);
}

function ensure(doc: PDFKit.PDFDocument, height: number) {
  const limit = doc.page.height - doc.page.margins.bottom;
  if (doc.y + height <= limit) return;
  doc.addPage();
}

function contentWidth(doc: PDFKit.PDFDocument) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function paint(doc: PDFKit.PDFDocument, text: string, x: number, y: number, width: number) {
  const saved = { x: doc.x, y: doc.y };
  doc.text(text, x, y, { width, height: 16, ellipsis: true });
  doc.x = saved.x;
  doc.y = saved.y;
}

function writePageNumbers(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const label = `${index - range.start + 1} / ${range.count}`;
    doc.font(FONT).fontSize(8).fillColor("#94a3b8").text(label, doc.page.margins.left, doc.page.height - 28, {
      width: contentWidth(doc),
      align: "center",
      height: 12,
      lineBreak: false,
    });
  }
}

function collect(doc: PDFKit.PDFDocument) {
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  return new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}
