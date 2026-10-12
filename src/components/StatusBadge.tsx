import type { ActivityStatus } from "@/types/activity";

const LABELS: Record<ActivityStatus, string> = {
  draft: "Rascunho",
  ready: "Pronta",
  analyzing: "Analisando",
  done: "Concluída",
  error: "Erro",
};

const STYLES: Record<ActivityStatus, string> = {
  draft: "badge badge-draft",
  ready: "badge badge-ready",
  analyzing: "badge badge-analyzing",
  done: "badge badge-done",
  error: "badge badge-error",
};

export function StatusBadge({ status }: { status: ActivityStatus }) {
  return <span className={STYLES[status]}>{LABELS[status]}</span>;
}
