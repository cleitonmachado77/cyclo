import { STUDY_METHOD, STUDY_SECTION, buildStationViews, stationHeading } from "@/lib/report-study";
import { buildStationStudies } from "@/lib/time-study";
import type { VideoAnalysis } from "@/types/activity";

export function StationStudy({ videos }: { videos: VideoAnalysis[] }) {
  const stations = buildStationViews(buildStationStudies(videos));
  if (!stations.length) return null;

  return (
    <div className="stack">
      <h3 className="report-files-title">{STUDY_SECTION}</h3>
      <p className="muted" style={{ fontSize: "0.82rem" }}>{STUDY_METHOD}</p>
      {stations.map((station) => (
        <div key={station.title} className="video-item">
          <strong>{stationHeading(station)}</strong>
          <ul className="qualitative-list">
            {station.indicators.map((item) => (
              <li key={item.label}>
                {item.label}: {item.value}
              </li>
            ))}
          </ul>
          {station.warnings.map((warning) => (
            <p key={warning} className="muted">
              Atenção: {warning}
            </p>
          ))}
          {station.elements.length ? (
            <div style={{ overflowX: "auto" }}>
              <table className="result-table">
                <thead>
                  <tr>
                    <th>Elemento</th>
                    <th>Tipo</th>
                    <th>Média</th>
                    <th>Desvio</th>
                    <th>Erro 95%</th>
                    <th>n necessário</th>
                    <th>Frequência</th>
                  </tr>
                </thead>
                <tbody>
                  {station.elements.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td>{row.type}</td>
                      <td>{row.mean}</td>
                      <td>{row.stdDev}</td>
                      <td>{row.error}</td>
                      <td>{row.required}</td>
                      <td>{row.frequency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
