import ExcelJS from "exceljs";
import type { ReportView } from "@/lib/report-view";
import type { ConsolidatedReport } from "@/types/pipeline";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF0F766E" },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
};

/** Gera XLSX com dados brutos da análise já consolidada (sem reanalisar). */
export async function renderReportXlsx(view: ReportView, report: ConsolidatedReport) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Cyclo.ia";
  workbook.created = new Date(report.generatedAt);

  addResumoSheet(workbook, view, report);
  addDadosBrutosSheet(workbook, report);
  addConsolidadosSheet(workbook, report);
  addAmostrasSheet(workbook, report);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function addResumoSheet(workbook: ExcelJS.Workbook, view: ReportView, report: ConsolidatedReport) {
  const sheet = workbook.addWorksheet("Resumo", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Campo", key: "campo", width: 28 },
    { header: "Valor", key: "valor", width: 72 },
  ];
  styleHeader(sheet);

  const rows: Array<[string, string | number]> = [
    ["Atividade", view.activity],
    ["Gerado em", view.generatedAt],
    ["Status", view.status],
    ["Modelo(s)", view.models],
    ["Cobertura", view.coverage],
    ["Vídeos (total)", report.videoCount],
    ["Vídeos OK", report.successCount],
    ["Vídeos com falha", report.errorCount],
    ["Resumo", view.summary],
  ];
  for (const kpi of view.kpis) {
    rows.push([kpi.label, kpi.value]);
  }
  if (view.warning) rows.push(["Aviso", view.warning]);

  for (const [campo, valor] of rows) {
    sheet.addRow({ campo, valor });
  }
}

function addDadosBrutosSheet(workbook: ExcelJS.Workbook, report: ConsolidatedReport) {
  const sheet = workbook.addWorksheet("Dados brutos", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Etapa", key: "etapa", width: 10 },
    { header: "Arquivo", key: "arquivo", width: 36 },
    { header: "Video ID", key: "videoId", width: 38 },
    { header: "Tempo total vídeo (s)", key: "totalVideo", width: 20 },
    { header: "Medida #", key: "medida", width: 10 },
    { header: "Movimento", key: "movimento", width: 32 },
    { header: "Status", key: "status", width: 14 },
    { header: "Início", key: "inicio", width: 12 },
    { header: "Fim", key: "fim", width: 12 },
    { header: "Duração (s)", key: "duracao", width: 14 },
    { header: "Notas", key: "notas", width: 40 },
    { header: "Observações do vídeo", key: "observacoes", width: 40 },
  ];
  styleHeader(sheet);

  report.videos.forEach((video, stageIndex) => {
    const etapa = stageIndex + 1;
    if (!video.movements.length) {
      sheet.addRow({
        etapa,
        arquivo: video.fileName,
        videoId: video.videoId,
        totalVideo: round1(video.totalDurationSeconds),
        medida: "",
        movimento: "",
        status: "",
        inicio: "",
        fim: "",
        duracao: "",
        notas: "",
        observacoes: video.observations || "",
      });
      return;
    }
    video.movements.forEach((movement, index) => {
      sheet.addRow({
        etapa,
        arquivo: video.fileName,
        videoId: video.videoId,
        totalVideo: round1(video.totalDurationSeconds),
        medida: index + 1,
        movimento: movement.name,
        status: movementStatus(movement.status),
        inicio: movement.startTime,
        fim: movement.endTime,
        duracao: round1(movement.durationSeconds),
        notas: movement.notes || "",
        observacoes: video.observations || "",
      });
    });
  });

  sheet.getColumn("totalVideo").numFmt = "0.0";
  sheet.getColumn("duracao").numFmt = "0.0";
}

function addConsolidadosSheet(workbook: ExcelJS.Workbook, report: ConsolidatedReport) {
  const sheet = workbook.addWorksheet("Consolidados", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Movimento", key: "movimento", width: 32 },
    { header: "Amostras (n)", key: "n", width: 12 },
    { header: "Média (s)", key: "media", width: 12 },
    { header: "Mínimo (s)", key: "min", width: 12 },
    { header: "Máximo (s)", key: "max", width: 12 },
  ];
  styleHeader(sheet);

  for (const movement of report.movements) {
    sheet.addRow({
      movimento: movement.name,
      n: movement.sampleCount,
      media: round1(movement.avgDurationSeconds),
      min: round1(movement.minDurationSeconds),
      max: round1(movement.maxDurationSeconds),
    });
  }

  sheet.getColumn("media").numFmt = "0.0";
  sheet.getColumn("min").numFmt = "0.0";
  sheet.getColumn("max").numFmt = "0.0";
}

function addAmostrasSheet(workbook: ExcelJS.Workbook, report: ConsolidatedReport) {
  const sheet = workbook.addWorksheet("Amostras", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Movimento", key: "movimento", width: 32 },
    { header: "Arquivo", key: "arquivo", width: 36 },
    { header: "Video ID", key: "videoId", width: 38 },
    { header: "Início", key: "inicio", width: 12 },
    { header: "Fim", key: "fim", width: 12 },
    { header: "Duração (s)", key: "duracao", width: 14 },
  ];
  styleHeader(sheet);

  for (const movement of report.movements) {
    for (const sample of movement.samples) {
      sheet.addRow({
        movimento: movement.name,
        arquivo: sample.fileName,
        videoId: sample.videoId,
        inicio: sample.startTime,
        fim: sample.endTime,
        duracao: round1(sample.durationSeconds),
      });
    }
  }

  sheet.getColumn("duracao").numFmt = "0.0";
}

function styleHeader(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  row.height = 22;
}

function movementStatus(status?: "complete" | "partial" | "not_found") {
  if (status === "complete") return "Completo";
  if (status === "partial") return "Parcial";
  if (status === "not_found") return "Não encontrado";
  return "";
}

function round1(value: number) {
  if (!Number.isFinite(value)) return "";
  return Math.round(value * 10) / 10;
}
