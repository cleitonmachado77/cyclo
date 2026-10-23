"use client";

import { FormEvent, use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActivityReports } from "@/components/ActivityReports";
import { AppShell } from "@/components/AppShell";
import { AnalysisMonitor, applyAnalysisProgress, startMonitor, type AnalysisMonitorState } from "@/components/AnalysisMonitor";
import { StatusBadge } from "@/components/StatusBadge";
import { formatBytes, formatDate } from "@/lib/format";
import { QualitativeNotes } from "@/components/QualitativeNotes";
import { StageMeasures } from "@/components/StageMeasures";
import { StationStudy } from "@/components/StationStudy";
import { toUserMessage } from "@/lib/errors";
import { readSse } from "@/lib/read-sse";
import { uploadWithProgress } from "@/lib/upload";
import type { Activity } from "@/types/activity";

type UploadProgress = {
  fileName: string;
  fileIndex: number;
  fileCount: number;
  percent: number;
  phase: "preparing" | "uploading" | "confirming";
};

type AnalysisProgress = AnalysisMonitorState;

export default function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisPaused, setAnalysisPaused] = useState(false);
  const [analysisControlBusy, setAnalysisControlBusy] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(`/api/activities/${id}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Atividade não encontrada.");
        if (!active) return;
        setActivity(data.activity);
        setTitle(data.activity.title);
        setDescription(data.activity.description || "");
        setPrompt(data.activity.prompt || "");
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Erro ao carregar.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const canAnalyze = useMemo(
    () => Boolean(activity?.videos.length && prompt.trim() && !analyzing),
    [activity, prompt, analyzing],
  );

  async function saveDetails(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/activities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, prompt }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao salvar.");
      setActivity(data.activity);
      setMessage("Detalhes atualizados.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    if (!files.length) return;
    setUploading(true);
    setError(null);
    setMessage(null);

    try {
      const list = Array.from(files);
      const confirmed: Array<{
        id: string;
        originalName: string;
        storedName: string;
        storagePath: string;
        mimeType: string;
        size: number;
      }> = [];

      for (let index = 0; index < list.length; index += 1) {
        const file = list[index];
        setUploadProgress({
          fileName: file.name,
          fileIndex: index + 1,
          fileCount: list.length,
          percent: 0,
          phase: "preparing",
        });

        const signResponse = await fetch(`/api/activities/${id}/videos/sign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type || "video/mp4",
            size: file.size,
          }),
        });
        const signData = await signResponse.json();
        if (!signResponse.ok) {
          throw new Error(signData.error || `Falha ao preparar upload de ${file.name}`);
        }

        setUploadProgress({
          fileName: file.name,
          fileIndex: index + 1,
          fileCount: list.length,
          percent: 0,
          phase: "uploading",
        });

        await uploadWithProgress(signData.signedUrl, file, (percent) => {
          setUploadProgress({
            fileName: file.name,
            fileIndex: index + 1,
            fileCount: list.length,
            percent,
            phase: "uploading",
          });
        });

        confirmed.push({
          id: signData.videoId,
          originalName: file.name,
          storedName: signData.storedName,
          storagePath: signData.storagePath,
          mimeType: file.type || "video/mp4",
          size: file.size,
        });
      }

      setUploadProgress({
        fileName: list.length === 1 ? list[0].name : `${list.length} arquivos`,
        fileIndex: list.length,
        fileCount: list.length,
        percent: 100,
        phase: "confirming",
      });

      const completeResponse = await fetch(`/api/activities/${id}/videos/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videos: confirmed }),
      });
      const completeData = await completeResponse.json();
      if (!completeResponse.ok) {
        throw new Error(completeData.error || "Falha ao confirmar vídeos.");
      }

      setActivity(completeData.activity);
      setMessage(`${completeData.uploaded.length} vídeo(s) enviado(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro no upload.");
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  async function removeVideo(videoId: string) {
    setError(null);
    try {
      const response = await fetch(`/api/activities/${id}/videos/${videoId}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao remover vídeo.");
      setActivity(data.activity);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao remover.");
    }
  }

  async function pauseAnalysis() {
    setAnalysisControlBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/activities/${id}/analyze`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Não foi possível pausar.");
      setAnalysisPaused(true);
      setMessage("Pausa solicitada. Vale no próximo trecho ou vídeo.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao pausar.");
    } finally {
      setAnalysisControlBusy(false);
    }
  }

  async function resumeAnalysis() {
    setAnalysisControlBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/activities/${id}/analyze`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Não foi possível continuar.");
      setAnalysisPaused(false);
      setMessage("Análise retomada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao continuar.");
    } finally {
      setAnalysisControlBusy(false);
    }
  }

  async function refreshActivity() {
    const response = await fetch(`/api/activities/${id}`);
    const data = await response.json().catch(() => null);
    if (response.ok && data?.activity) setActivity(data.activity as Activity);
  }

  async function stopAnalysis() {
    if (!confirm("Encerrar a análise agora? O progresso parcial dos trechos já salvos será mantido no run.")) {
      return;
    }
    setAnalysisControlBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/activities/${id}/analyze`, { method: "DELETE" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Não foi possível encerrar.");
      setAnalysisPaused(false);
      setMessage("Análise encerrada.");
      await refreshActivity();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao encerrar.");
    } finally {
      setAnalysisControlBusy(false);
    }
  }

  async function runAnalysis() {
    setAnalyzing(true);
    setAnalysisPaused(false);
    setError(null);
    setMessage(null);
    setAnalysisProgress(startMonitor("Preparando esteira de análise..."));

    try {
      if (
        title !== activity?.title ||
        description !== activity?.description ||
        prompt !== activity?.prompt
      ) {
        const saveResponse = await fetch(`/api/activities/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, description, prompt }),
        });
        const saveData = await saveResponse.json();
        if (!saveResponse.ok) {
          throw new Error(saveData.error || "Falha ao salvar o prompt.");
        }
        setActivity(saveData.activity);
      }

      let jobId = "";
      let completed = false;
      let reconnects = 0;
      let lastSeq = 0;

      while (!completed) {
        const response = await fetch(`/api/activities/${id}/analyze`, {
          method: "POST",
          headers: jobId ? { "x-analysis-job": jobId } : undefined,
        });

        if (response.status === 409) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || "A análise em andamento foi interrompida. Inicie de novo.");
        }

        if (!response.ok || !response.body) {
          const fallback = await response.json().catch(() => null);
          throw new Error(fallback?.error || "Falha ao iniciar análise.");
        }

        await readSse(response, (eventName, payload) => {
          if (typeof payload.seq === "number") {
            if (payload.seq <= lastSeq) return;
            lastSeq = payload.seq;
          }
          if (typeof payload.jobId === "string") jobId = payload.jobId;

          if (eventName === "progress") {
            const phase = String(payload.phase || "");
            if (phase === "paused") setAnalysisPaused(true);
            else if (phase && phase !== "paused") setAnalysisPaused(false);
            setAnalysisProgress((prev) => applyAnalysisProgress(payload, prev));
          }

          if (eventName === "done") {
            completed = true;
            setAnalysisPaused(false);
            const nextActivity = payload.activity as Activity | undefined;
            if (nextActivity) setActivity(nextActivity);
            setMessage(`Análise concluída com ${nextActivity?.analysis?.model || "IA"}.`);
            setAnalysisProgress((prev) =>
              applyAnalysisProgress(
                {
                  ...payload,
                  phase: "done",
                  percent: 100,
                  message: "Análise concluída",
                  detail: nextActivity?.analysis?.summary,
                },
                prev,
              ),
            );
          }

          if (eventName === "error") {
            completed = true;
            setAnalysisPaused(false);
            const nextActivity = payload.activity as Activity | undefined;
            if (nextActivity) setActivity(nextActivity);
            const reason = toUserMessage(
              payload.error,
              "Não foi possível concluir a análise agora. Tente novamente em instantes.",
            );
            if (/cancelad/i.test(reason) || /encerrad/i.test(reason)) {
              setMessage(reason);
              void refreshActivity();
              return;
            }
            throw new Error(reason);
          }
        });

        if (!completed) {
          reconnects += 1;
          if (reconnects > 8) {
            throw new Error("A conexão com a esteira foi interrompida.");
          }
          setAnalysisProgress((prev) =>
            prev
              ? applyAnalysisProgress(
                  {
                    phase: prev.phase,
                    message: "Conexão retomada. A esteira continua.",
                    percent: prev.percent,
                    elapsedSeconds: prev.elapsedSeconds,
                    etaSeconds: prev.etaSeconds,
                  },
                  prev,
                )
              : prev,
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    } catch (err) {
      const reason = toUserMessage(
        err,
        "Não foi possível concluir a análise agora. Tente novamente em instantes.",
      );
      if (/cancelad/i.test(reason) || /encerrad/i.test(reason)) {
        setMessage(reason);
      } else {
        setError(reason);
      }
    } finally {
      setAnalyzing(false);
      setAnalysisPaused(false);
      setAnalysisControlBusy(false);
    }
  }

  async function removeActivity() {
    if (!confirm("Excluir esta atividade e seus vídeos?")) return;
    const response = await fetch(`/api/activities/${id}`, { method: "DELETE" });
    if (response.ok) {
      router.push("/");
      router.refresh();
    }
  }

  if (loading) {
    return (
      <AppShell title="Carregando atividade...">
        <div className="panel muted">Buscando dados...</div>
      </AppShell>
    );
  }

  if (!activity) {
    return (
      <AppShell title="Atividade não encontrada">
        <div className="panel">
          <div className="alert alert-error">{error || "Registro inexistente."}</div>
          <div style={{ marginTop: "1rem" }}>
            <Link href="/" className="btn btn-secondary">
              Voltar
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={activity.title}
      subtitle="Envie os vídeos, refine o prompt e execute a análise agentic para obter os tempos."
      actions={
        <>
          <StatusBadge status={analyzing ? "analyzing" : activity.status} />
          <button type="button" className="btn btn-danger btn-sm" onClick={removeActivity}>
            Excluir
          </button>
        </>
      }
    >
      <div className="stack">
        {error && <div className="alert alert-soft">{error}</div>}
        {message && <div className="alert alert-info">{message}</div>}
        {activity.errorMessage && !error && (
          <div className="alert alert-soft">
            {toUserMessage(
              activity.errorMessage,
              "Não foi possível concluir a análise agora. Tente novamente em instantes.",
            )}
          </div>
        )}

        {analysisProgress && (
          <AnalysisMonitor
            progress={analysisProgress}
            controlling={analyzing}
            paused={analysisPaused}
            busy={analysisControlBusy}
            onPause={() => void pauseAnalysis()}
            onResume={() => void resumeAnalysis()}
            onStop={() => void stopAnalysis()}
          />
        )}

        <div className="split">
          <form className="panel form-grid" onSubmit={saveDetails}>
            <h2 className="panel-title">Detalhes da atividade</h2>
            <p className="panel-copy">
              Descreva com clareza os movimentos que devem ser reconhecidos e medidos.
            </p>

            <div className="field">
              <label htmlFor="title">Nome</label>
              <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>

            <div className="field">
              <label htmlFor="description">Descrição</label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="prompt">Prompt do agente</label>
              <textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                required
                className="prompt-field"
              />
              <p className="muted">PDF e Word seguem este prompt. Um pedido como “gráfico verde dos ciclos” sai nesse formato.</p>
            </div>

            <div className="page-actions">
              <button type="submit" className="btn btn-secondary" disabled={saving}>
                {saving ? "Salvando..." : "Salvar alterações"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canAnalyze}
                onClick={runAnalysis}
              >
                {analyzing ? (
                  <>
                    <span className="spinner" /> Analisando...
                  </>
                ) : (
                  "Analisar com Gemini"
                )}
              </button>
            </div>
          </form>

          <section className="panel panel-videos">
            <h2 className="panel-title">Vídeos ({activity.videos.length})</h2>
            <p className="panel-copy">
              Envie vários registros. Vídeos longos viram um proxy, são fatiados e analisados um trecho por vez.
            </p>

            <label
              className={`dropzone ${dragging ? "is-dragging" : ""} ${uploading ? "is-uploading" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!uploading) void uploadFiles(event.dataTransfer.files);
              }}
            >
              {uploading && uploadProgress ? (
                <div className="upload-progress">
                  <strong>
                    {uploadProgress.phase === "preparing" && "Preparando upload..."}
                    {uploadProgress.phase === "uploading" && "Enviando vídeo..."}
                    {uploadProgress.phase === "confirming" && "Confirmando no banco..."}
                  </strong>
                  <p>
                    {uploadProgress.fileName}
                    {uploadProgress.fileCount > 1
                      ? ` · arquivo ${uploadProgress.fileIndex} de ${uploadProgress.fileCount}`
                      : ""}
                  </p>
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={uploadProgress.percent}
                    aria-label="Progresso do upload"
                  >
                    <div
                      className="progress-fill"
                      style={{ width: `${uploadProgress.percent}%` }}
                    />
                  </div>
                  <span className="progress-label">{uploadProgress.percent}%</span>
                </div>
              ) : (
                <>
                  <strong>Arraste vídeos ou clique para selecionar</strong>
                  <p>Formatos: MP4, MOV, WEBM · até 50 GB por arquivo.</p>
                </>
              )}
              <input
                type="file"
                accept="video/*"
                multiple
                hidden
                disabled={uploading}
                onChange={(event) => {
                  if (event.target.files) void uploadFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>

            <div className="video-list">
              {activity.videos.length === 0 && (
                <p className="muted">Nenhum vídeo enviado ainda.</p>
              )}
              {activity.videos.map((video) => (
                <div key={video.id} className="video-item">
                  <video controls preload="metadata" src={video.publicUrl || `/uploads/${video.storedName}`} />
                  <div className="video-meta">
                    <div>
                      <strong>{video.originalName}</strong>
                      <div className="muted" style={{ fontSize: "0.82rem", marginTop: 4 }}>
                        {formatBytes(video.size)} · {formatDate(video.uploadedAt)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => void removeVideo(video.id)}
                    >
                      Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>        </div>

        <section className="panel">
          <h2 className="panel-title">Relatório consolidado</h2>
          {!activity.analysis ? (
            <p className="panel-copy">
              Após enviar os vídeos, execute a análise. O sistema processa em fila e consolida os tempos.
            </p>
          ) : (
            <div className="stack">
              <div className="alert alert-info">
                <strong>Resumo:</strong> {activity.analysis.summary}
                <div className="muted" style={{ marginTop: 6, fontSize: "0.82rem" }}>
                  {activity.analysis.model} · {formatDate(activity.analysis.analyzedAt)} ·{" "}
                  {activity.analysis.videos.length} vídeo(s)
                </div>
              </div>

              <StationStudy videos={activity.analysis.videos} />
              <QualitativeNotes videos={activity.analysis.videos} />
              <StageMeasures videos={activity.analysis.videos} />
            </div>
          )}
          <ActivityReports
            activityId={activity.id}
            refreshKey={activity.analysis?.analyzedAt || activity.updatedAt}
          />
        </section>
      </div>
    </AppShell>
  );
}
