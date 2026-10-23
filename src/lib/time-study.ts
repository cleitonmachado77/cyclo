import { parseClock } from "@/lib/clock";
import type { ElementType, MovementTiming, StationInfo, VideoAnalysis } from "@/types/activity";

export const UNASSIGNED_STATION = "Sem posto";
/** z para 95% de confiança e erro admissível de 5%. */
export const CONFIDENCE_Z = 1.96;
export const ADMISSIBLE_ERROR = 0.05;

const ELEMENT_TYPES: ElementType[] = ["repetitivo", "casual", "estranho", "espera", "maquina", "ciclo", "sem_visao"];

export const ELEMENT_TYPE_LABEL: Record<ElementType, string> = {
  repetitivo: "Repetitivo",
  casual: "Casual",
  estranho: "Estranho à operação",
  espera: "Espera",
  maquina: "Máquina",
  ciclo: "Ciclo",
  sem_visao: "Sem visão do posto",
};

export type ElementStudy = {
  station: string;
  name: string;
  elementType: ElementType;
  occurrences: number;
  occurrencesInCycles: number;
  cyclesWithOccurrence: number;
  /** Uma leitura por ciclo do posto, 0 quando o elemento não ocorre. */
  readings: number[];
  mean: number;
  stdDev: number;
  meanPerOccurrence: number;
  /** Erro relativo da amostra a 95%; null quando não dá para calcular. */
  relativeError: number | null;
  requiredSamples: number | null;
  /** O elemento ocorre 1 vez a cada N ciclos. */
  cyclesPerOccurrence: number | null;
  totalSeconds: number;
};

export type StationStudy = {
  station: string;
  description: string;
  operators: string[];
  cycleLabels: string[];
  cycleCount: number;
  partialCycles: number;
  elements: ElementStudy[];
  workCycleSeconds: number;
  machineCycleSeconds: number;
  observedCycle: { mean: number; stdDev: number; count: number } | null;
  foreign: { occurrences: number; totalSeconds: number; meanPerOccurrence: number; meanPerCycle: number };
  waits: { occurrences: number; totalSeconds: number; meanPerCycle: number };
  observedSeconds: number;
  noVisionSeconds: number;
  idleShare: number;
  foreignShare: number;
};

type Placed = MovementTiming & {
  videoId: string;
  videoOrder: number;
  station: string;
  elementType: ElementType;
  absStart: number;
  absEnd: number;
};

export function stationOf(movement: MovementTiming) {
  return normalizeStation(movement.station);
}

export function elementTypeOf(movement: MovementTiming): ElementType {
  if (movement.elementType && ELEMENT_TYPES.includes(movement.elementType)) return movement.elementType;
  const name = movement.name.trim().toLowerCase();
  if (name === "ciclo completo") return "ciclo";
  if (name === "esteira de processo") return "maquina";
  if (/ocios|espera|aguard/.test(name)) return "espera";
  if (/acionamento|m[aá]quina/.test(name)) return "maquina";
  return "repetitivo";
}

export function isRollup(movement: MovementTiming) {
  const name = movement.name.trim().toLowerCase();
  return elementTypeOf(movement) === "ciclo" || name === "esteira de processo";
}

export function isLeaf(movement: MovementTiming) {
  return !isRollup(movement) && elementTypeOf(movement) !== "sem_visao";
}

export function normalizeStation(value?: string | null) {
  const text = (value || "").trim();
  if (!text) return UNASSIGNED_STATION;
  const numbered = text.match(/^(?:posto|p|station|esta[cç][aã]o)\s*0*(\d+)\b/i);
  if (numbered) return `Posto ${numbered[1]}`;
  return text;
}

/**
 * Numera os ciclos por posto a partir dos intervalos "Ciclo completo", na ordem do vídeo.
 * Cada elemento folha recebe o ciclo que contém o seu ponto médio; fora de qualquer ciclo fica null.
 * Postos sem intervalos de ciclo mantêm a numeração do modelo (ou a lida em notes).
 */
export function assignCycles(movements: MovementTiming[]): MovementTiming[] {
  const byStation = new Map<string, number[]>();
  movements.forEach((movement, index) => {
    const station = stationOf(movement);
    byStation.set(station, [...(byStation.get(station) || []), index]);
  });

  const result = movements.map((movement) => ({
    ...movement,
    station: stationOf(movement),
    elementType: elementTypeOf(movement),
    cycle: movement.cycle ?? cycleFromNotes(movement.notes),
  }));

  for (const indexes of byStation.values()) {
    const rollups = indexes
      .filter((index) => result[index].elementType === "ciclo" && result[index].status !== "not_found")
      .sort((a, b) => parseClock(result[a].startTime) - parseClock(result[b].startTime));
    if (!rollups.length) continue;

    const spans = rollups.map((index, order) => {
      result[index].cycle = order + 1;
      return { cycle: order + 1, start: parseClock(result[index].startTime), end: parseClock(result[index].endTime) };
    });

    for (const index of indexes) {
      const movement = result[index];
      if (movement.elementType === "ciclo") continue;
      const middle = (parseClock(movement.startTime) + parseClock(movement.endTime)) / 2;
      const span = spans.find((item) => middle >= item.start && middle <= item.end);
      movement.cycle = span ? span.cycle : null;
    }
  }

  return result;
}

export function mergeStations(lists: Array<StationInfo[] | undefined>): StationInfo[] {
  const merged = new Map<string, StationInfo>();
  for (const list of lists) {
    for (const station of list || []) {
      const id = normalizeStation(station.id);
      if (!merged.has(id) && station.description?.trim()) {
        merged.set(id, { id, description: station.description.trim() });
      }
    }
  }
  return [...merged.values()].sort(compareStations);
}

export function buildStationStudies(videos: VideoAnalysis[]): StationStudy[] {
  const catalog = mergeStations(videos.map((video) => video.stations));
  const placed: Placed[] = videos.flatMap((video, videoOrder) =>
    assignCycles(video.movements)
      .filter((movement) => movement.status !== "not_found" && movement.durationSeconds > 0)
      .map((movement) => ({
        ...movement,
        videoId: video.videoId,
        videoOrder,
        station: stationOf(movement),
        elementType: elementTypeOf(movement),
        absStart: parseClock(movement.startTime),
        absEnd: parseClock(movement.endTime),
      })),
  );

  const stations = [...new Set(placed.map((movement) => movement.station))].sort(compareStation);
  return stations.map((station) =>
    studyStation(
      station,
      catalog.find((item) => item.id === station)?.description || "",
      placed.filter((movement) => movement.station === station),
    ),
  );
}

function studyStation(station: string, description: string, movements: Placed[]): StationStudy {
  const rollups = movements.filter((movement) => movement.elementType === "ciclo");
  const leaves = movements.filter((movement) => isLeaf(movement));
  const noVisionSeconds = sum(movements.filter((movement) => movement.elementType === "sem_visao").map((m) => m.durationSeconds));

  const cycleKeys = studiedCycles(rollups, leaves);
  const cycleIndex = new Map(cycleKeys.map((key, index) => [key, index]));
  const partialCycles = rollups.filter((movement) => movement.status === "partial").length;

  const groups = new Map<string, Placed[]>();
  for (const movement of leaves) {
    const key = movement.name.trim().toLowerCase();
    groups.set(key, [...(groups.get(key) || []), movement]);
  }

  const elements = [...groups.values()]
    .sort((a, b) => compareTimeline(ordered(a)[0], ordered(b)[0]))
    .map((group) => studyElement(station, group, cycleKeys.length, cycleIndex));

  const meanOf = (types: ElementType[]) =>
    sum(elements.filter((element) => types.includes(element.elementType)).map((element) => element.mean));
  const foreignElements = leaves.filter((movement) => movement.elementType === "estranho");
  const waitElements = leaves.filter((movement) => movement.elementType === "espera");
  const observedSeconds = sum(leaves.map((movement) => movement.durationSeconds));
  const completeRollups = rollups.filter((movement) => movement.status !== "partial").map((movement) => movement.durationSeconds);

  return {
    station,
    description,
    operators: [...new Set(movements.map((movement) => movement.operator?.trim()).filter(Boolean) as string[])],
    cycleLabels: cycleLabels(cycleKeys),
    cycleCount: cycleKeys.length,
    partialCycles,
    elements,
    workCycleSeconds: meanOf(["repetitivo", "casual"]),
    machineCycleSeconds: meanOf(["maquina"]),
    observedCycle: completeRollups.length
      ? { mean: mean(completeRollups), stdDev: stdDev(completeRollups), count: completeRollups.length }
      : null,
    foreign: {
      occurrences: foreignElements.length,
      totalSeconds: sum(foreignElements.map((movement) => movement.durationSeconds)),
      meanPerOccurrence: foreignElements.length ? mean(foreignElements.map((movement) => movement.durationSeconds)) : 0,
      meanPerCycle: meanOf(["estranho"]),
    },
    waits: {
      occurrences: waitElements.length,
      totalSeconds: sum(waitElements.map((movement) => movement.durationSeconds)),
      meanPerCycle: meanOf(["espera"]),
    },
    observedSeconds,
    noVisionSeconds,
    idleShare: observedSeconds ? sum(waitElements.map((movement) => movement.durationSeconds)) / observedSeconds : 0,
    foreignShare: observedSeconds ? sum(foreignElements.map((movement) => movement.durationSeconds)) / observedSeconds : 0,
  };
}

/** Ciclos completos entram no estudo; sem intervalos de ciclo, valem os números atribuídos aos elementos. */
function studiedCycles(rollups: Placed[], leaves: Placed[]) {
  const keys = rollups.length
    ? ordered(rollups.filter((movement) => movement.status !== "partial" && movement.cycle != null)).map(cycleKey)
    : ordered(leaves.filter((movement) => movement.cycle != null)).map(cycleKey);
  return [...new Set(keys)];
}

function studyElement(station: string, group: Placed[], cycles: number, cycleIndex: Map<string, number>): ElementStudy {
  const readings = new Array<number>(cycles).fill(0);
  let occurrencesInCycles = 0;
  for (const movement of group) {
    if (movement.cycle == null) continue;
    const index = cycleIndex.get(cycleKey(movement));
    if (index == null) continue;
    readings[index] += movement.durationSeconds;
    occurrencesInCycles += 1;
  }

  const durations = group.map((movement) => movement.durationSeconds);
  const cyclesWithOccurrence = readings.filter((value) => value > 0).length;
  const average = cycles ? mean(readings) : mean(durations);
  const deviation = cycles ? stdDev(readings) : stdDev(durations);
  const samples = cycles || durations.length;

  return {
    station,
    name: group[0].name,
    elementType: dominantType(group),
    occurrences: group.length,
    occurrencesInCycles,
    cyclesWithOccurrence,
    readings: readings.map(round2),
    mean: average,
    stdDev: deviation,
    meanPerOccurrence: mean(durations),
    relativeError: samples > 1 && average > 0 ? (CONFIDENCE_Z * deviation) / (Math.sqrt(samples) * average) : null,
    requiredSamples:
      samples > 1 && average > 0 ? Math.max(1, Math.ceil(((CONFIDENCE_Z * deviation) / (ADMISSIBLE_ERROR * average)) ** 2)) : null,
    cyclesPerOccurrence: cycles && cyclesWithOccurrence ? cycles / cyclesWithOccurrence : null,
    totalSeconds: sum(durations),
  };
}

function dominantType(group: Placed[]): ElementType {
  const counts = new Map<ElementType, number>();
  for (const movement of group) counts.set(movement.elementType, (counts.get(movement.elementType) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function ordered(items: Placed[]) {
  return [...items].sort(compareTimeline);
}

function compareTimeline(a: Placed, b: Placed) {
  return a.videoOrder - b.videoOrder || a.absStart - b.absStart;
}

function cycleKey(movement: Placed) {
  return `${movement.videoOrder + 1}#${movement.cycle}`;
}

function cycleLabels(keys: string[]) {
  const parts = keys.map((key) => key.split("#"));
  const manyStages = new Set(parts.map(([stage]) => stage)).size > 1;
  return parts.map(([stage, cycle]) => (manyStages ? `E${stage}·C${cycle}` : `C${cycle}`));
}

function cycleFromNotes(notes?: string) {
  const match = notes?.match(/\bciclo\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function compareStations(a: StationInfo, b: StationInfo) {
  return compareStation(a.id, b.id);
}

function compareStation(a: string, b: string) {
  const left = a.match(/^Posto (\d+)$/);
  const right = b.match(/^Posto (\d+)$/);
  if (left && right) return Number(left[1]) - Number(right[1]);
  if (left) return -1;
  if (right) return 1;
  if (a === UNASSIGNED_STATION) return 1;
  if (b === UNASSIGNED_STATION) return -1;
  return a.localeCompare(b);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: number[]) {
  return values.length ? sum(values) / values.length : 0;
}

function stdDev(values: number[]) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(sum(values.map((value) => (value - average) ** 2)) / (values.length - 1));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
