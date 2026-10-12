"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";

export default function NovaAtividadePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, prompt }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Não foi possível criar a atividade.");
      }
      router.push(`/atividades/${data.activity.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado.");
      setLoading(false);
    }
  }

  return (
    <AppShell
      title="Nova atividade"
      subtitle="Defina a função operacional e descreva os movimentos que o agente deve reconhecer e cronometrar."
      actions={
        <Link href="/" className="btn btn-secondary">
          Voltar
        </Link>
      }
    >
      <form className="panel form-grid" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="title">Nome da atividade</label>
          <input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex.: Montagem de kit de peças"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="description">Descrição (opcional)</label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Contexto da operação, posto de trabalho, turno..."
          />
        </div>

        <div className="field">
          <label htmlFor="prompt">Prompt para o agente</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ex.: Reconheça e meça o tempo de: 1) pegar a peça, 2) encaixar no suporte, 3) apertar o parafuso, 4) inspecionar o acabamento."
            required
            className="prompt-field"
          />
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="page-actions">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? (
              <>
                <span className="spinner" /> Criando...
              </>
            ) : (
              "Criar e adicionar vídeos"
            )}
          </button>
        </div>
      </form>
    </AppShell>
  );
}
