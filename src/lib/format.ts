export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatSeconds(value: number) {
  if (!Number.isFinite(value)) return "—";
  const total = Math.round(Math.max(0, value) * 100) / 100;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  if (minutes === 0) return `${seconds.toFixed(2)}s`;
  return `${minutes}m ${seconds.toFixed(2)}s`;
}
