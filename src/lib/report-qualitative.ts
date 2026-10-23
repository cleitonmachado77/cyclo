import { UNASSIGNED_STATION, elementTypeOf, stationOf } from "@/lib/time-study";
import type { ElementType, MovementTiming } from "@/types/activity";

export type QualitativeVideo = {
  fileName: string;
  observations?: string;
  movements: MovementTiming[];
};

export type QualitativeSection = {
  ergonomics: string[];
  flow: string[];
  improvements: string[];
};

type Clip = {
  fileName: string;
  station: string;
  start: string;
  end: string;
  seconds: number;
  notes: string;
};

export function buildQualitative(videos: QualitativeVideo[]): QualitativeSection {
  const waits = clipsOfType(videos, "espera");
  const foreign = clipsOfType(videos, "estranho");
  const cycles = clipsOfType(videos, "ciclo");
  const reaches = clipsMatching(videos, /alcan[cç]|grasp|extremidad/i);
  const bends = clipsMatching(videos, /inclina-se|inclinou|flex[aã]o/i);
  const turns = clipsMatching(videos, /rota[cç]|levant/i);
  const still = clipsMatching(videos, /espera est[aá]tica|unavoidable/i);
  const seated = clipsMatching(videos, /\bsenta\b|sentado|sentada/i);
  const rampWaits = waits.filter((clip) => /rampa|calha|desliz/i.test(clip.notes));
  const align = clipsMatching(videos, /alinh|organiz|esquadr/i)
    .filter((clip) => !["espera", "estranho"].includes(clip.type))
    .sort((a, b) => b.seconds - a.seconds);

  const ergonomics = [
    reaches.length
      ? `A pega dos painéis é feita na pilha, com alcance até as extremidades. ${cite(reaches.find((clip) => /extremidad/i.test(clip.notes)) || reaches[0])}`
      : "",
    bends.length ? `Há flexão até a pilha ao lado: ${cite(bends[0])}` : "",
    turns.length ? `O painel grande é levantado e girado no posto: ${cite(turns[0])}` : "",
    still.length ? `Depois de assentar a peça, o operador fica parado em espera estática: ${cite(still[0])}` : "",
    seated.length ? `Na parada longa, o operador senta na bancada em vez de permanecer no ciclo: ${cite(seated[0])}` : "",
  ].filter(Boolean);

  const flow = [
    ...cycleRanges(cycles),
    rampWaits.length ? `O posto espera o painel chegar pela rampa ou calha: ${cite(rampWaits[0])}` : "",
    ...waits
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 3)
      .map((clip) => `Espera medida: ${cite(clip)}`),
    ...foreign
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 2)
      .map((clip) => `Elemento estranho à operação: ${cite(clip)}`),
  ].filter(Boolean);

  const improvements = [
    rampWaits.length
      ? "Balancear o abastecimento da rampa com o ritmo do posto, para cortar a espera antes da pega."
      : "",
    still.length
      ? "A esteira segura o operador depois do assentamento. Vale aproximar o passo da linha da pega seguinte, em vez de mantê-lo parado."
      : "",
    [...waits, ...foreign].some((clip) => clip.seconds >= 60)
      ? "Separar interrupção de ciclo. As paradas longas, de conversa ou documento, não devem entrar na média do ciclo útil."
      : "",
    align[0] && align[0].seconds >= 8
      ? `O alinhamento chega a ${seconds(align[0].seconds)} em ${where(align[0])} (${align[0].start}–${align[0].end}). Um critério único de esquadro evita repetir o ajuste.`
      : "",
    reaches.length || bends.length
      ? "Aproximar a pilha da altura da calha e da mesa de roletes. A pega nas extremidades e a inclinação até a pilha ao lado se repetem."
      : "",
  ].filter(Boolean);

  return { ergonomics, flow, improvements };
}

export function qualitativeIsEmpty(section: QualitativeSection) {
  return !section.ergonomics.length && !section.flow.length && !section.improvements.length;
}

function cycleRanges(cycles: Array<Clip & { type: ElementType }>) {
  const stations = [...new Set(cycles.map((clip) => clip.station))];
  return stations.map((station) => {
    const own = cycles.filter((clip) => clip.station === station && clip.seconds > 0);
    const label = station === UNASSIGNED_STATION ? "Quando a linha anda" : `No ${station}`;
    return own.length ? `${label}, o ciclo completo fica em torno de ${range(own)} (${own.length} ciclo(s)).` : "";
  });
}

function clipsOfType(videos: QualitativeVideo[], type: ElementType) {
  return videos.flatMap((video) =>
    video.movements
      .filter((movement) => elementTypeOf(movement) === type && movement.durationSeconds > 0)
      .map((movement) => toClip(video.fileName, movement)),
  );
}

function clipsMatching(videos: QualitativeVideo[], pattern: RegExp) {
  return videos.flatMap((video) =>
    video.movements
      .filter((movement) => pattern.test(`${movement.name} ${movement.notes || ""}`) && movement.durationSeconds > 0)
      .map((movement) => toClip(video.fileName, movement)),
  );
}

function toClip(fileName: string, movement: MovementTiming) {
  return {
    fileName,
    station: stationOf(movement),
    type: elementTypeOf(movement),
    start: movement.startTime,
    end: movement.endTime,
    seconds: movement.durationSeconds,
    notes: movement.notes || "",
  };
}

function where(clip: Clip) {
  return clip.station === UNASSIGNED_STATION ? clip.fileName : `${clip.fileName}, ${clip.station}`;
}

function cite(clip: Clip) {
  const notes = clip.notes.replace(/\.+\s*$/, "");
  return `${where(clip)}, ${clip.start}–${clip.end}, ${seconds(clip.seconds)}. ${notes}.`;
}

function range(clips: Clip[]) {
  const values = clips.map((clip) => clip.seconds);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (Math.abs(max - min) < 1.5) return seconds(max);
  return `${seconds(min)} a ${seconds(max)}`;
}

function seconds(value: number) {
  return `${value.toFixed(2).replace(".", ",")}s`;
}
