import ExcelJS from "exceljs";
import { parseClock } from "@/lib/clock";
import type { ReportView } from "@/lib/report-view";
import {
  ELEMENT_TYPE_LABEL,
  UNASSIGNED_STATION,
  assignCycles,
  buildStationStudies,
  elementTypeOf,
  stationOf,
  type StationStudy,
} from "@/lib/time-study";
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

  const studies = buildStationStudies(report.videos);
  addResumoSheet(workbook, view, report);
  addPostosSheet(workbook, studies, view);
  addElementosSheet(workbook, studies);
  addLeiturasSheet(workbook, studies);
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

function addPostosSheet(workbook: ExcelJS.Workbook, studies: StationStudy[], view: ReportView) {
  const sheet = workbook.addWorksheet("Postos", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Posto", key: "posto", width: 14 },
    { header: "Descrição", key: "descricao", width: 48 },
    { header: "Operadores", key: "operadores", width: 28 },
    { header: "Ciclos completos (n)", key: "ciclos", width: 14 },
    { header: "Ciclos parciais", key: "parciais", width: 12 },
    { header: "Ciclo de trabalho médio (s)", key: "trabalho", width: 16 },
    { header: "Ciclo de máquina médio (s)", key: "maquina", width: 16 },
    { header: "Ciclo observado médio (s)", key: "observado", width: 16 },
    { header: "Ciclo observado desvio (s)", key: "observadoDp", width: 16 },
    { header: "Estranhos (ocorrências)", key: "estranhosN", width: 14 },
    { header: "Estranhos total (s)", key: "estranhosT", width: 14 },
    { header: "Estranhos média por ocorrência (s)", key: "estranhosM", width: 18 },
    { header: "Estranhos por ciclo (s)", key: "estranhosC", width: 14 },
    { header: "Esperas (ocorrências)", key: "esperasN", width: 14 },
    { header: "Esperas total (s)", key: "esperasT", width: 14 },
    { header: "Esperas por ciclo (s)", key: "esperasC", width: 14 },
    { header: "% em espera", key: "esperasP", width: 12 },
    { header: "Tempo observado (s)", key: "observadoT", width: 14 },
    { header: "Sem visão (s)", key: "semVisao", width: 12 },
  ];
  styleHeader(sheet);
  for (const study of studies) {
    sheet.addRow({
      posto: study.station,
      descricao: study.description,
      operadores: study.operators.join(", "),
      ciclos: study.cycleCount,
      parciais: study.partialCycles,
      trabalho: round2(study.workCycleSeconds),
      maquina: round2(study.machineCycleSeconds),
      observado: study.observedCycle ? round2(study.observedCycle.mean) : "",
      observadoDp: study.observedCycle ? round2(study.observedCycle.stdDev) : "",
      estranhosN: study.foreign.occurrences,
      estranhosT: round2(study.foreign.totalSeconds),
      estranhosM: round2(study.foreign.meanPerOccurrence),
      estranhosC: round2(study.foreign.meanPerCycle),
      esperasN: study.waits.occurrences,
      esperasT: round2(study.waits.totalSeconds),
      esperasC: round2(study.waits.meanPerCycle),
      esperasP: round2(study.idleShare * 100),
      observadoT: round2(study.observedSeconds),
      semVisao: round2(study.noVisionSeconds),
    });
  }
  sheet.addRow({});
  sheet.addRow({ posto: "Método", descricao: view.studyMethod });
  numberColumns(sheet, ["trabalho", "maquina", "observado", "observadoDp", "estranhosT", "estranhosM", "estranhosC", "esperasT", "esperasC", "esperasP", "observadoT", "semVisao"]);
}

function addElementosSheet(workbook: ExcelJS.Workbook, studies: StationStudy[]) {
  const sheet = workbook.addWorksheet("Elementos por posto", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Posto", key: "posto", width: 14 },
    { header: "Elemento", key: "elemento", width: 36 },
    { header: "Tipo", key: "tipo", width: 20 },
    { header: "Ciclos (n)", key: "n", width: 10 },
    { header: "Ocorrências", key: "ocorrencias", width: 12 },
    { header: "Ocorrências em ciclos", key: "emCiclos", width: 14 },
    { header: "Média com zeros (s)", key: "media", width: 14 },
    { header: "Desvio padrão (s)", key: "desvio", width: 14 },
    { header: "Erro da amostra 95% (%)", key: "erro", width: 14 },
    { header: "n necessário (erro 5%)", key: "necessario", width: 14 },
    { header: "Amostra suficiente", key: "suficiente", width: 12 },
    { header: "Média por ocorrência (s)", key: "porOcorrencia", width: 16 },
    { header: "1 ocorrência a cada N ciclos", key: "frequencia", width: 16 },
    { header: "Total (s)", key: "total", width: 12 },
  ];
  styleHeader(sheet);
  for (const study of studies) {
    for (const element of study.elements) {
      sheet.addRow({
        posto: study.station,
        elemento: element.name,
        tipo: ELEMENT_TYPE_LABEL[element.elementType],
        n: study.cycleCount,
        ocorrencias: element.occurrences,
        emCiclos: element.occurrencesInCycles,
        media: round2(element.mean),
        desvio: round2(element.stdDev),
        erro: element.relativeError == null ? "" : round2(element.relativeError * 100),
        necessario: element.requiredSamples ?? "",
        suficiente:
          element.requiredSamples == null || !study.cycleCount ? "" : study.cycleCount >= element.requiredSamples ? "Sim" : "Não",
        porOcorrencia: round2(element.meanPerOccurrence),
        frequencia: element.cyclesPerOccurrence == null ? "" : round2(element.cyclesPerOccurrence),
        total: round2(element.totalSeconds),
      });
    }
  }
  numberColumns(sheet, ["media", "desvio", "erro", "porOcorrencia", "frequencia", "total"]);
}

function addLeiturasSheet(workbook: ExcelJS.Workbook, studies: StationStudy[]) {
  const sheet = workbook.addWorksheet("Leituras por ciclo", { views: [{ state: "frozen", ySplit: 1, xSplit: 3 }] });
  const maxCycles = Math.max(0, ...studies.map((study) => study.cycleCount));
  sheet.columns = [
    { header: "Posto", key: "posto", width: 14 },
    { header: "Elemento", key: "elemento", width: 36 },
    { header: "Tipo", key: "tipo", width: 20 },
    ...Array.from({ length: maxCycles }, (_, index) => ({ header: `Ciclo ${index + 1}`, key: `c${index}`, width: 10 })),
  ];
  styleHeader(sheet);
  for (const study of studies) {
    if (!study.cycleCount) continue;
    sheet.addRow({
      posto: study.station,
      elemento: "Ciclo (rótulo)",
      tipo: "",
      ...Object.fromEntries(study.cycleLabels.map((label, index) => [`c${index}`, label])),
    }).font = { italic: true, color: { argb: "FF64748B" } };
    for (const element of study.elements) {
      sheet.addRow({
        posto: study.station,
        elemento: element.name,
        tipo: ELEMENT_TYPE_LABEL[element.elementType],
        ...Object.fromEntries(element.readings.map((value, index) => [`c${index}`, value])),
      });
    }
  }
  for (let index = 0; index < maxCycles; index += 1) sheet.getColumn(`c${index}`).numFmt = "0.00";
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
    { header: "Posto", key: "posto", width: 14 },
    { header: "Operador", key: "operador", width: 24 },
    { header: "Elemento", key: "movimento", width: 32 },
    { header: "Tipo", key: "tipo", width: 18 },
    { header: "Ciclo", key: "ciclo", width: 8 },
    { header: "Status", key: "status", width: 14 },
    { header: "Início", key: "inicio", width: 12 },
    { header: "Fim", key: "fim", width: 12 },
    { header: "Início (s)", key: "inicioS", width: 12 },
    { header: "Fim (s)", key: "fimS", width: 12 },
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
        totalVideo: round2(video.totalDurationSeconds),
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
    assignCycles(video.movements).forEach((movement, index) => {
      sheet.addRow({
        etapa,
        arquivo: video.fileName,
        videoId: video.videoId,
        totalVideo: round2(video.totalDurationSeconds),
        medida: index + 1,
        posto: stationOf(movement),
        operador: movement.operator || "",
        movimento: movement.name,
        tipo: ELEMENT_TYPE_LABEL[elementTypeOf(movement)],
        ciclo: movement.cycle ?? "",
        status: movementStatus(movement.status),
        inicio: movement.startTime,
        fim: movement.endTime,
        inicioS: round2(parseClock(movement.startTime)),
        fimS: round2(parseClock(movement.endTime)),
        duracao: round2(movement.durationSeconds),
        notas: movement.notes || "",
        observacoes: index === 0 ? video.observations || "" : "",
      });
    });
  });

  numberColumns(sheet, ["totalVideo", "inicioS", "fimS", "duracao"]);
}

function addConsolidadosSheet(workbook: ExcelJS.Workbook, report: ConsolidatedReport) {
  const sheet = workbook.addWorksheet("Consolidados", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Posto", key: "posto", width: 14 },
    { header: "Elemento", key: "movimento", width: 32 },
    { header: "Ocorrências (n)", key: "n", width: 12 },
    { header: "Média por ocorrência (s)", key: "media", width: 14 },
    { header: "Mínimo (s)", key: "min", width: 12 },
    { header: "Máximo (s)", key: "max", width: 12 },
  ];
  styleHeader(sheet);

  for (const movement of report.movements) {
    sheet.addRow({
      posto: movement.station || UNASSIGNED_STATION,
      movimento: movement.name,
      n: movement.sampleCount,
      media: round2(movement.avgDurationSeconds),
      min: round2(movement.minDurationSeconds),
      max: round2(movement.maxDurationSeconds),
    });
  }

  numberColumns(sheet, ["media", "min", "max"]);
}

function addAmostrasSheet(workbook: ExcelJS.Workbook, report: ConsolidatedReport) {
  const sheet = workbook.addWorksheet("Amostras", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Posto", key: "posto", width: 14 },
    { header: "Elemento", key: "movimento", width: 32 },
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
        posto: movement.station || UNASSIGNED_STATION,
        movimento: movement.name,
        arquivo: sample.fileName,
        videoId: sample.videoId,
        inicio: sample.startTime,
        fim: sample.endTime,
        duracao: round2(sample.durationSeconds),
      });
    }
  }

  numberColumns(sheet, ["duracao"]);
}

function numberColumns(sheet: ExcelJS.Worksheet, keys: string[]) {
  for (const key of keys) sheet.getColumn(key).numFmt = "0.00";
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

function round2(value: number) {
  if (!Number.isFinite(value)) return "";
  return Math.round(value * 100) / 100;
}
