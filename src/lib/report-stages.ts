import { formatSeconds } from "@/lib/format";
import { ELEMENT_TYPE_LABEL, UNASSIGNED_STATION, elementTypeOf, stationOf } from "@/lib/time-study";
import type { MovementTiming } from "@/types/activity";

export const STAGE_SECTION = "Dados brutos por etapa de filmagem";

export function stageHeading(stage: number, fileName: string, totalSeconds: number) {
  return `Etapa ${stage} — ${fileName} — tempo total ${formatSeconds(totalSeconds)}`;
}

export function measureText(movement: MovementTiming) {
  const station = stationOf(movement);
  const prefix = station === UNASSIGNED_STATION ? "" : `[${station}] `;
  const type = ELEMENT_TYPE_LABEL[elementTypeOf(movement)].toLowerCase();
  const cycle = movement.cycle ? `, ciclo ${movement.cycle}` : "";
  const operator = movement.operator ? `, ${movement.operator}` : "";
  const base = `${prefix}${movement.name} (${type}${cycle}${operator}), ${movement.startTime}–${movement.endTime}, ${formatSeconds(movement.durationSeconds)}, ${movementStatus(movement.status)}`;
  const notes = movement.notes?.trim().replace(/\.+$/, "");
  return notes ? `${base}. ${notes}.` : `${base}.`;
}

function movementStatus(status?: MovementTiming["status"]) {
  if (status === "complete") return "Completo";
  if (status === "partial") return "Parcial";
  if (status === "not_found") return "Não encontrado";
  return "—";
}
