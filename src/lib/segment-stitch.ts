import { formatClock, formatPreciseClock, parseClock } from "@/lib/clock";
import { mergeStations, stationOf } from "@/lib/time-study";
import type { MovementTiming, StationInfo } from "@/types/activity";

export type SegmentGap = {
  startTime: string;
  endTime: string;
  reason: string;
};

export type SegmentSlice = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  overlapSeconds: number;
  error?: string;
  movements: MovementTiming[];
  summary?: string;
  observations?: string;
  model?: string;
  stations?: StationInfo[];
};

type TimedMovement = MovementTiming & {
  absStart: number;
  absEnd: number;
};

const CLOCK_IN_TEXT = /\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,2}))?\b/g;

export function stitchSegments(slices: SegmentSlice[]) {
  const kept: TimedMovement[] = [];
  const gaps: SegmentGap[] = [];
  const models: string[] = [];

  for (const slice of slices) {
    if (slice.model) models.push(slice.model);
    if (slice.error) {
      gaps.push({
        startTime: formatClock(slice.startSeconds),
        endTime: formatClock(slice.endSeconds),
        reason: slice.error,
      });
      continue;
    }

    const boundary = slice.index === 0 ? slice.startSeconds : slice.startSeconds + slice.overlapSeconds;
    const span = Math.max(0, slice.endSeconds - slice.startSeconds);

    for (const movement of slice.movements) {
      if (movement.status === "not_found") continue;
      const placed = placeMovement(movement, slice, span);
      if (!placed || placed.absEnd <= boundary + 0.4) continue;

      const start = Math.max(placed.absStart, boundary);
      const sameName = [...kept].reverse().find((item) => sameMovement(item, placed));
      const continuesAcrossCut =
        slice.index > 0 &&
        start <= boundary + 1 &&
        sameName &&
        sameName.absEnd >= boundary - 1 &&
        sameName.absStart <= placed.absEnd;
      if (sameName && continuesAcrossCut) {
        sameName.absEnd = Math.max(sameName.absEnd, placed.absEnd);
        sameName.durationSeconds = round2(Math.max(0, sameName.absEnd - sameName.absStart));
        sameName.endTime = formatPreciseClock(sameName.absEnd);
        sameName.status = mergeStatus(sameName.status, placed.status);
        if (placed.notes && !sameName.notes?.includes(placed.notes)) {
          sameName.notes = [sameName.notes, placed.notes].filter(Boolean).join(" · ");
        }
        continue;
      }

      kept.push({
        ...placed,
        absStart: start,
        durationSeconds: round2(Math.max(0, placed.absEnd - start)),
        startTime: formatPreciseClock(start),
        endTime: formatPreciseClock(placed.absEnd),
      });
    }
  }

  kept.sort((a, b) => a.absStart - b.absStart);
  return {
    movements: kept.map(({ absStart: _start, absEnd: _end, ...movement }) => movement),
    gaps,
    models: [...new Set(models)],
    stations: mergeStations(slices.map((slice) => slice.stations)),
  };
}

/** Horários citados em notes vêm no relógio do trecho; passa para o relógio do vídeo. */
export function shiftClocksInText(text: string, offsetSeconds: number, spanSeconds: number) {
  if (!offsetSeconds) return text;
  return text.replace(CLOCK_IN_TEXT, (match, hours, minutes, seconds, fraction) => {
    const value =
      Number(hours || 0) * 3600 + Number(minutes) * 60 + Number(seconds) + (fraction ? Number(`0.${fraction}`) : 0);
    if (value > spanSeconds + 2) return match;
    return fraction ? formatPreciseClock(value + offsetSeconds) : formatClock(value + offsetSeconds);
  });
}

function placeMovement(movement: MovementTiming, slice: SegmentSlice, span: number) {
  let relStart = parseClock(movement.startTime);
  let relEnd = parseClock(movement.endTime);
  if (relEnd < relStart) relEnd = relStart + Math.max(0, movement.durationSeconds || 0);

  let absoluteClock = false;
  if (span > 0 && relStart > span + 2 && relStart + 1 >= slice.startSeconds) {
    relStart -= slice.startSeconds;
    relEnd -= slice.startSeconds;
    absoluteClock = true;
  }

  relStart = clamp(relStart, 0, span || relStart);
  relEnd = clamp(Math.max(relEnd, relStart), 0, span || relEnd);
  const duration = relEnd - relStart;
  if (duration <= 0 && !(movement.durationSeconds > 0)) return null;

  const absStart = slice.startSeconds + relStart;
  const absEnd = slice.startSeconds + (duration > 0 ? relEnd : relStart + movement.durationSeconds);
  return {
    ...movement,
    station: stationOf(movement),
    notes: movement.notes && !absoluteClock ? shiftClocksInText(movement.notes, slice.startSeconds, span) : movement.notes,
    absStart,
    absEnd,
    durationSeconds: Math.max(0, absEnd - absStart),
  };
}

function sameMovement(left: MovementTiming, right: MovementTiming) {
  return (
    left.name.trim().toLowerCase() === right.name.trim().toLowerCase() && stationOf(left) === stationOf(right)
  );
}

function mergeStatus(current: MovementTiming["status"], next: MovementTiming["status"]) {
  if (current === "complete" || next === "complete") return "complete";
  return next || current;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(max) || max <= min) return Math.max(min, value);
  return Math.min(max, Math.max(min, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
