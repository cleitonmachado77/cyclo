import { formatSeconds } from "@/lib/format";
import {
  ADMISSIBLE_ERROR,
  CONFIDENCE_Z,
  ELEMENT_TYPE_LABEL,
  type ElementStudy,
  type StationStudy,
} from "@/lib/time-study";

export const STUDY_SECTION = "Estudo de tempos por posto";

export const STUDY_METHOD = `Leitura contínua em centésimos de segundo. Média e desvio padrão de cada elemento usam uma leitura por ciclo completo do posto, com 0 quando o elemento não ocorre. Erro da amostra = z·s/(√n·x̄), com z = ${String(CONFIDENCE_Z).replace(".", ",")} (95% de confiança); n necessário = (z·s/(${ADMISSIBLE_ERROR * 100}%·x̄))². Ciclo de trabalho = soma das médias dos elementos repetitivos e casuais; ciclo de máquina = soma das médias dos elementos máquina.`;

export type StationElementRow = {
  name: string;
  type: string;
  occurrences: string;
  frequency: string;
  mean: string;
  stdDev: string;
  perOccurrence: string;
  error: string;
  required: string;
};

export type StationView = {
  title: string;
  description: string;
  operators: string;
  indicators: Array<{ label: string; value: string }>;
  elements: StationElementRow[];
  casuals: string[];
  readings: { labels: string[]; rows: Array<{ name: string; values: string[] }> };
  warnings: string[];
};

export function buildStationViews(studies: StationStudy[]): StationView[] {
  return studies.map((study) => ({
    title: study.station,
    description: study.description,
    operators: study.operators.join(", "),
    indicators: indicators(study),
    elements: study.elements.map(elementRow),
    casuals: study.elements
      .filter((element) => element.elementType === "casual")
      .map(
        (element) =>
          `${element.name}: ${element.occurrencesInCycles} ocorrência(s) em ${study.cycleCount} ciclo(s), ${
            element.cyclesPerOccurrence ? `1 a cada ${decimal(element.cyclesPerOccurrence, 1)} ciclos` : "fora dos ciclos"
          }; tempo médio por ocorrência ${formatSeconds(element.meanPerOccurrence)}; tempo por ciclo ${formatSeconds(
            element.cyclesPerOccurrence ? element.meanPerOccurrence / element.cyclesPerOccurrence : 0,
          )}.`,
      ),
    readings: {
      labels: study.cycleLabels,
      rows: study.elements.map((element) => ({
        name: `${element.name} (${ELEMENT_TYPE_LABEL[element.elementType].toLowerCase()})`,
        values: element.readings.map((value) => decimal(value, 2)),
      })),
    },
    warnings: warnings(study),
  }));
}

export function stationHeading(view: StationView) {
  return view.description ? `${view.title} — ${view.description}` : view.title;
}

export function elementLine(row: StationElementRow) {
  return `${row.name} (${row.type}): média ${row.mean}, desvio ${row.stdDev}, erro ${row.error}, n necessário ${row.required}, ${row.occurrences} ocorrência(s), ${row.frequency}, ${row.perOccurrence} por ocorrência.`;
}

export function readingLine(labels: string[], row: { name: string; values: string[] }) {
  return `${row.name}: ${row.values.map((value, index) => `${labels[index]} ${value}`).join(" | ")}`;
}

function indicators(study: StationStudy) {
  const items = [
    { label: "Ciclos completos medidos", value: `${study.cycleCount}${study.partialCycles ? ` (+${study.partialCycles} parcial)` : ""}` },
    { label: "Tempo médio do ciclo de trabalho", value: study.cycleCount ? formatSeconds(study.workCycleSeconds) : "—" },
    { label: "Tempo médio do ciclo de máquina", value: study.machineCycleSeconds ? formatSeconds(study.machineCycleSeconds) : "—" },
    {
      label: "Ciclo observado (Ciclo completo)",
      value: study.observedCycle
        ? `${formatSeconds(study.observedCycle.mean)} ± ${formatSeconds(study.observedCycle.stdDev)} (n=${study.observedCycle.count})`
        : "—",
    },
    {
      label: "Elementos estranhos",
      value: study.foreign.occurrences
        ? `${study.foreign.occurrences} ocorrência(s), total ${formatSeconds(study.foreign.totalSeconds)}, média ${formatSeconds(study.foreign.meanPerOccurrence)} por ocorrência, ${formatSeconds(study.foreign.meanPerCycle)} por ciclo`
        : "nenhum",
    },
    {
      label: "Esperas",
      value: study.waits.occurrences
        ? `${study.waits.occurrences} ocorrência(s), total ${formatSeconds(study.waits.totalSeconds)} (${percent(study.idleShare)} do tempo observado), ${formatSeconds(study.waits.meanPerCycle)} por ciclo`
        : "nenhuma",
    },
    { label: "Tempo observado no posto", value: formatSeconds(study.observedSeconds) },
  ];
  if (study.noVisionSeconds) items.push({ label: "Sem visão do posto (fora do estudo)", value: formatSeconds(study.noVisionSeconds) });
  if (study.operators.length) items.push({ label: "Operadores", value: study.operators.join(", ") });
  return items;
}

function elementRow(element: ElementStudy): StationElementRow {
  return {
    name: element.name,
    type: ELEMENT_TYPE_LABEL[element.elementType].toLowerCase(),
    occurrences: String(element.occurrences),
    frequency: element.cyclesPerOccurrence
      ? element.cyclesPerOccurrence <= 1.0001
        ? "em todo ciclo"
        : `1 a cada ${decimal(element.cyclesPerOccurrence, 1)} ciclos`
      : "fora dos ciclos",
    mean: formatSeconds(element.mean),
    stdDev: formatSeconds(element.stdDev),
    perOccurrence: formatSeconds(element.meanPerOccurrence),
    error: element.relativeError == null ? "—" : percent(element.relativeError),
    required: element.requiredSamples == null ? "—" : String(element.requiredSamples),
  };
}

function warnings(study: StationStudy) {
  const notes: string[] = [];
  if (!study.cycleCount) {
    notes.push("Nenhum ciclo completo fechado neste posto; as médias usam as ocorrências, sem leituras por ciclo.");
  }
  const short = study.elements.filter(
    (element) =>
      (element.elementType === "repetitivo" || element.elementType === "casual") &&
      element.requiredSamples != null &&
      element.requiredSamples > study.cycleCount,
  );
  if (study.cycleCount && short.length) {
    notes.push(
      `Amostra insuficiente para erro de 5% em: ${short
        .map((element) => `${element.name} (n=${study.cycleCount}, precisa de ${element.requiredSamples})`)
        .join("; ")}.`,
    );
  }
  return notes;
}

function decimal(value: number, digits: number) {
  return value.toFixed(digits).replace(".", ",");
}

function percent(value: number) {
  return `${(value * 100).toFixed(1).replace(".", ",")}%`;
}
