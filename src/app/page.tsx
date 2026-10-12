import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";
import { listActivities } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const activities = await listActivities();

  return (
    <AppShell
      title="Atividades de cronometragem"
      subtitle="Cadastre a função, envie os vídeos e deixe o Gemini Agentic medir os tempos de cada movimento."
      actions={
        <Link href="/atividades/nova" className="btn btn-primary">
          Criar atividade
        </Link>
      }
    >
      <section className="panel">
        {activities.length === 0 ? (
          <div className="empty-state">
            <h2>Nenhuma atividade ainda</h2>
            <p>Comece criando a primeira atividade operacional para análise.</p>
            <div style={{ marginTop: "1.25rem" }}>
              <Link href="/atividades/nova" className="btn btn-primary">
                Nova atividade
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid-cards">
            {activities.map((activity) => (
              <Link key={activity.id} href={`/atividades/${activity.id}`} className="activity-card">
                <div className="meta-row">
                  <StatusBadge status={activity.status} />
                  <span>{activity.videos.length} vídeo(s)</span>
                </div>
                <h3>{activity.title}</h3>
                <p>{activity.description || activity.prompt}</p>
                <div className="meta-row">
                  <span>Atualizada {formatDate(activity.updatedAt)}</span>
                  <span className="muted">Abrir →</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
