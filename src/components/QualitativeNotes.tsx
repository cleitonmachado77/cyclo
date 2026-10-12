import { buildQualitative, qualitativeIsEmpty, type QualitativeVideo } from "@/lib/report-qualitative";

export function QualitativeNotes({ videos }: { videos: QualitativeVideo[] }) {
  const section = buildQualitative(videos);
  if (qualitativeIsEmpty(section)) return null;

  return (
    <div className="stack">
      <h3 className="report-files-title">Observações qualitativas sobre ergonomia, fluidez e oportunidades de melhoria.</h3>
      <QualitativeGroup title="Ergonomia" items={section.ergonomics} />
      <QualitativeGroup title="Fluidez" items={section.flow} />
      <QualitativeGroup title="Oportunidades de melhoria" items={section.improvements} />
    </div>
  );
}

function QualitativeGroup({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <strong>{title}</strong>
      <ul className="qualitative-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
