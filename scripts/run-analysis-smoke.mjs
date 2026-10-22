/**
 * Smoke test: dispara análise e acompanha SSE até done/error.
 * Uso: node scripts/run-analysis-smoke.mjs [activityId]
 */
const activityId = process.argv[2] || "be3b9250-23d6-4c7b-8e3c-0572b4299bf2";
const maxVideos = Number(process.env.SMOKE_MAX_VIDEOS || process.argv[3] || 1);
const base = process.env.SMOKE_BASE_URL || "http://localhost:3000";

function log(...args) {
  const ts = new Date().toLocaleTimeString("pt-BR");
  console.log(`[${ts}]`, ...args);
}

async function main() {
  const statusRes = await fetch(`${base}/api/activities/${activityId}`);
  const statusData = await statusRes.json();
  if (!statusRes.ok) throw new Error(statusData.error || "Atividade não encontrada");
  log("Atividade:", statusData.activity.title, "| status:", statusData.activity.status);
  log("Vídeos na atividade:", statusData.activity.videos?.length || 0, "| smoke max:", maxVideos || "todos");

  let jobId = "";
  let completed = false;
  let lastSeq = 0;
  let lastMessage = "";
  let outcome = null;

  while (!completed) {
    const headers = {
      ...(jobId ? { "x-analysis-job": jobId } : {}),
      ...(maxVideos > 0 ? { "x-max-videos": String(maxVideos) } : {}),
    };
    const response = await fetch(`${base}/api/activities/${activityId}/analyze`, {
      method: "POST",
      headers,
    });

    if (response.status === 409) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || "Job interrompido");
    }
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";

      for (const chunk of chunks) {
        if (!chunk.trim() || chunk.startsWith(":")) continue;
        let eventName = "message";
        let dataLine = "";
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          if (line.startsWith("data:")) dataLine += line.slice(5).trim();
        }
        if (!dataLine) continue;
        let payload;
        try {
          payload = JSON.parse(dataLine);
        } catch {
          continue;
        }

        if (typeof payload.seq === "number") {
          if (payload.seq <= lastSeq) continue;
          lastSeq = payload.seq;
        }
        if (typeof payload.jobId === "string") jobId = payload.jobId;

        if (eventName === "progress") {
          const msg = `${payload.percent ?? "?"}% ${payload.message || ""}${payload.detail ? ` · ${payload.detail}` : ""}`;
          if (msg !== lastMessage) {
            lastMessage = msg;
            log(msg);
          }
        }
        if (eventName === "done") {
          completed = true;
          outcome = { ok: true, payload };
          log("DONE", payload.activity?.status || "", payload.run?.status || "");
        }
        if (eventName === "error") {
          completed = true;
          outcome = { ok: false, error: payload.error || "erro desconhecido" };
          log("ERROR", outcome.error);
        }
      }
    }

    if (!completed) {
      log("SSE fechou sem conclusão — reconectando…");
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  if (!outcome?.ok) {
    console.error("SMOKE_FAIL", outcome?.error);
    process.exit(1);
  }

  const finalRes = await fetch(`${base}/api/activities/${activityId}`);
  const finalData = await finalRes.json();
  const activity = finalData.activity;
  log("Status final:", activity.status);
  log("Modelo:", activity.analysis?.model || "—");
  log("Resumo:", (activity.analysis?.summary || "").slice(0, 200));
  const movements = activity.analysis?.videos?.flatMap((v) => v.movements || []) || [];
  log("Movimentos medidos:", movements.length);
  if (activity.status === "error" || !activity.analysis) {
    console.error("SMOKE_FAIL sem analysis útil");
    process.exit(1);
  }
  if (movements.length === 0) {
    console.error("SMOKE_FAIL analysis sem movimentos");
    process.exit(1);
  }
  console.log("SMOKE_OK");
}

main().catch((err) => {
  console.error("SMOKE_FAIL", err.message || err);
  process.exit(1);
});
