import { formatClock, parseClock } from "@/lib/clock";
import type { MovementTiming } from "@/types/activity";

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
};

type TimedMovement = MovementTiming & {
  absStart: number;
  absEnd: number;
};

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
      const sameName = [...kept].reverse().find((item) => sameMovement(item.name, placed.name));
      const continuesAcrossCut =
        slice.index > 0 &&
        start <= boundary + 1 &&
        sameName &&
        sameName.absEnd >= boundary - 1 &&
        sameName.absStart <= placed.absEnd;
      if (sameName && continuesAcrossCut) {
        sameName.absEnd = Math.max(sameName.absEnd, placed.absEnd);
        sameName.durationSeconds = Math.max(0, sameName.absEnd - sameName.absStart);
        sameName.endTime = formatClock(sameName.absEnd);
        sameName.status = mergeStatus(sameName.status, placed.status);
        if (placed.notes && !sameName.notes?.includes(placed.notes)) {
          sameName.notes = [sameName.notes, placed.notes].filter(Boolean).join(" · ");
        }
        continue;
      }

      kept.push({
        ...placed,
        absStart: start,
        durationSeconds: Math.max(0, placed.absEnd - start),
        startTime: formatClock(start),
        endTime: formatClock(placed.absEnd),
      });
    }
  }

  kept.sort((a, b) => a.absStart - b.absStart);
  return {
    movements: kept.map(({ absStart: _start, absEnd: _end, ...movement }) => movement),
    gaps,
    models: [...new Set(models)],
  };
}

function placeMovement(movement: MovementTiming, slice: SegmentSlice, span: number) {
  let relStart = parseClock(movement.startTime);
  let relEnd = parseClock(movement.endTime);
  if (relEnd < relStart) relEnd = relStart + Math.max(0, movement.durationSeconds || 0);

  if (span > 0 && relStart > span + 2 && relStart + 1 >= slice.startSeconds) {
    relStart -= slice.startSeconds;
    relEnd -= slice.startSeconds;
  }

  relStart = clamp(relStart, 0, span || relStart);
  relEnd = clamp(Math.max(relEnd, relStart), 0, span || relEnd);
  const duration = relEnd - relStart;
  if (duration <= 0 && !(movement.durationSeconds > 0)) return null;

  const absStart = slice.startSeconds + relStart;
  const absEnd = slice.startSeconds + (duration > 0 ? relEnd : relStart + movement.durationSeconds);
  return {
    ...movement,
    absStart,
    absEnd,
    durationSeconds: Math.max(0, absEnd - absStart),
  };
}

function sameMovement(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function mergeStatus(current: MovementTiming["status"], next: MovementTiming["status"]) {
  if (current === "complete" || next === "complete") return "complete";
  return next || current;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(max) || max <= min) return Math.max(min, value);
  return Math.min(max, Math.max(min, value));
}
