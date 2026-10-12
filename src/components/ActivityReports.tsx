"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/lib/format";
import type { RunStatus } from "@/types/pipeline";

type ReportFile = {
  id: string;
  status: RunStatus;
  finishedAt: string | null;
  createdAt: string;
  summary: string;
  models: string[];
  fileName: string;
  downloadUrl: string;
};

const STATUS_LABEL: Record<RunStatus, string> = {
  queued: "Na fila",
  running: "Em andamento",
  done: "Concluído",
  partial: "Parcial",
  error: "Com falha",
};

export function ActivityReports({
  activityId,
  refreshKey,
}: {
  activityId: string;
  refreshKey: string;
}) {
  const [reports, setReports] = useState<ReportFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(`/api/activities/${activityId}/reports`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Falha ao listar relatórios.");
        if (active) {
          setReports(Array.isArray(data.reports) ? data.reports : []);
          setError(null);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Falha ao listar relatórios.");
      }
    })();
    return () => {
      active = false;
    };
  }, [activityId, refreshKey]);

  return (
    <div className="report-files">
      <h3 className="report-files-title">Arquivos do relatório</h3>
      {error ? <p className="muted">{error}</p> : null}
      {!error && reports.length === 0 ? (
        <p className="muted">Os relatórios gerados aparecem aqui em TXT, PDF e Word.</p>
      ) : null}
      <div className="report-list">
        {reports.map((report) => {
          const baseName = report.fileName.replace(/\.txt$/i, "");
          return (
            <div key={report.id} className="report-row">
              <div>
                <strong>{baseName}</strong>
                <div className="muted report-row-meta">
                  {STATUS_LABEL[report.status]} · {formatDate(report.finishedAt || report.createdAt)}
                  {report.models.length ? ` · ${report.models.join(", ")}` : ""}
                </div>
              </div>
              <div className="report-actions">
                <a className="btn btn-secondary btn-sm" href={report.downloadUrl} download={`${baseName}.txt`}>
                  TXT
                </a>
                <a className="btn btn-secondary btn-sm" href={`${report.downloadUrl}?format=pdf`} download={`${baseName}.pdf`}>
                  PDF
                </a>
                <a className="btn btn-secondary btn-sm" href={`${report.downloadUrl}?format=docx`} download={`${baseName}.docx`}>
                  Word
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
