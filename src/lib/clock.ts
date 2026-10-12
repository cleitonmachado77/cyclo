export function parseClock(value: string): number {
  const text = value.trim();
  const match = text.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) {
    const asNumber = Number(text);
    return Number.isFinite(asNumber) ? Math.max(0, asNumber) : 0;
  }
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatClock(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

export function formatDurationLabel(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return "Calculando…";
  if (totalSeconds <= 0) return "00:00";
  return formatClock(totalSeconds);
}
