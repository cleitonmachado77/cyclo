import { GoogleGenAI } from "@google/genai";
import type { ConsolidatedReport } from "@/types/pipeline";
import { chartLabel, type ChartPoint, type ReportChart, type ReportView } from "@/lib/report-view";

const DEFAULT_COLOR = "#0f766e";
const MAX_POINTS = 60;

const COLOR_NAMES: Array<[string, string]> = [
  ["verde escuro", "#166534"],
  ["verde claro", "#4ade80"],
  ["verde", "#16a34a"],
  ["azul escuro", "#1d4ed8"],
  ["azul claro", "#38bdf8"],
  ["azul", "#2563eb"],
  ["vermelho", "#dc2626"],
  ["laranja", "#ea580c"],
  ["amarelo", "#ca8a04"],
  ["roxo", "#7c3aed"],
  ["rosa", "#db2777"],
  ["preto", "#111827"],
  ["cinza", "#64748b"],
];

type DraftChart = {
  title?: string;
  kind?: string;
  color?: string;
  metric?: string;
  movement?: string;
};

export async function presentReport(view: ReportView, report: ConsolidatedReport) {
  const local = layoutFromPrompt(view.prompt, view, report);
  const remote = await layoutFromModel(view.prompt, report).catch(() => null);
  const chosen = remote?.charts.length ? remote : local;
  return {
    ...view,
    accent: chosen.accent,
    includeKpis: chosen.includeKpis,
    includeDetail: chosen.includeDetail,
    charts: chosen.charts,
  };
}

function layoutFromPrompt(prompt: string, view: ReportView, report: ConsolidatedReport) {
  const color = detectColor(prompt) || DEFAULT_COLOR;
  const subjects = chartSubjects(prompt);
  const includeDetail = !/sem detalh|sem tabela|apenas o gr[aá]fico|somente o gr[aá]fico/i.test(prompt);
  const includeKpis = !/sem indicador|sem resumo num[eé]rico/i.test(prompt);
  const charts: ReportChart[] = [];

  if (!subjects.any) {
    pushAverages(charts, view, color);
    pushCycles(charts, view, color);
  } else {
    if (subjects.cycle) pushCycles(charts, view, color);
    if (subjects.average) pushAverages(charts, view, color);
    for (const movement of namedNearChart(prompt, report)) pushSamples(charts, report, movement, color);
    if (!charts.length) fallbackCharts(view, color).forEach((chart) => charts.push(chart));
  }

  return {
    accent: color,
    includeDetail,
    includeKpis,
    charts: dedupe(charts),
  };
}

function chartSubjects(prompt: string) {
  const lower = prompt.toLowerCase();
  const windows = [...lower.matchAll(/gr[aá]fico|chart/g)].map((match) => lower.slice(match.index || 0, (match.index || 0) + 90));
  return {
    any: windows.length > 0,
    cycle: windows.some((window) => /ciclo/.test(window)),
    average: windows.some((window) => /m[eé]dia|movimento|elemento/.test(window)),
  };
}

function namedNearChart(prompt: string, report: ConsolidatedReport) {
  const lower = prompt.toLowerCase();
  const windows = [...lower.matchAll(/gr[aá]fico|chart/g)].map((match) => lower.slice(Math.max(0, (match.index || 0) - 20), (match.index || 0) + 90));
  return report.movements
    .map((movement) => movement.name)
    .filter((name) => {
      const key = name.trim().toLowerCase();
      return key !== "ciclo completo" && windows.some((window) => window.includes(key));
    });
}

async function layoutFromModel(prompt: string, report: ConsolidatedReport) {
  if (!process.env.GEMINI_API_KEY || !mentionsPresentation(prompt)) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const names = report.movements.map((movement) => movement.name).join(", ") || "nenhum";
  const response = await Promise.race([
    ai.models.generateContent({
      model,
      contents: `O relatório já foi medido. Escolha só a apresentação pedida no prompt. Não invente números.
Prompt:
${prompt.slice(0, 6000)}

Movimentos medidos: ${names}.
Métricas permitidas: "averages" (média de cada movimento), "cycles" (cada ciclo completo), "samples" (ocorrências de um movimento; preencha movement com o nome exato).
kind: "bar" ou "column".
color: hexadecimal. Se o prompt pedir verde, use #16a34a. Se não pedir cor, use #0f766e.
Se o prompt pedir um único gráfico, devolva só esse. Máximo 4.
Responda apenas JSON:
{"accent":"#16a34a","includeKpis":true,"includeDetail":true,"charts":[{"title":"...","kind":"column","color":"#16a34a","metric":"cycles","movement":""}]}`,
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 20000)),
  ]);
  return bindModelLayout(response.text || "", report);
}

function bindModelLayout(raw: string, report: ConsolidatedReport) {
  const parsed = extractJson(raw) as {
    accent?: string;
    includeKpis?: boolean;
    includeDetail?: boolean;
    charts?: DraftChart[];
  };
  const charts = (parsed.charts || [])
    .slice(0, 4)
    .map((chart) => bindChart(chart, report))
    .filter((chart): chart is ReportChart => Boolean(chart));
  if (!charts.length) return null;
  return {
    accent: normalizeColor(parsed.accent) || charts[0].color,
    includeKpis: parsed.includeKpis !== false,
    includeDetail: parsed.includeDetail !== false,
    charts,
  };
}

function bindChart(chart: DraftChart, report: ConsolidatedReport): ReportChart | null {
  const color = normalizeColor(chart.color) || DEFAULT_COLOR;
  const kind = chart.kind === "column" ? "column" : "bar";
  const metric = chart.metric || "";
  if (metric === "averages") {
    const points = report.movements
      .filter((movement) => movement.name.trim().toLowerCase() !== "ciclo completo")
      .map((movement) => ({
        label: chartLabel(movement),
        value: round(movement.avgDurationSeconds),
      }));
    return points.length ? spec(chart.title || "Tempo médio por elemento e posto", "Cada barra usa a média medida no relatório.", kind, color, points) : null;
  }
  if (metric === "cycles") {
    const points = samplePoints(report, "ciclo completo");
    return points.length ? spec(chart.title || "Duração de cada ciclo completo", "Cada barra é um ciclo completo do primeiro posto, na ordem do vídeo.", kind, color, points) : null;
  }
  if (metric === "samples" && chart.movement) {
    const points = samplePoints(report, chart.movement);
    return points.length
      ? spec(chart.title || chart.movement, `Cada barra é uma ocorrência medida de ${chart.movement}.`, kind, color, points)
      : null;
  }
  return null;
}

function pushAverages(charts: ReportChart[], view: ReportView, color: string) {
  if (!view.averages.length) return;
  charts.push(spec("Tempo médio por elemento e posto", "Cada barra usa a média medida no relatório.", "bar", color, view.averages));
}

function pushCycles(charts: ReportChart[], view: ReportView, color: string) {
  for (const station of view.stationCycles) {
    charts.push(
      spec(
        `Duração de cada ciclo completo — ${station.station}`,
        station.note || "Cada barra é um ciclo completo medido neste posto, na ordem do vídeo.",
        "column",
        color,
        station.points,
      ),
    );
  }
}

function pushSamples(charts: ReportChart[], report: ConsolidatedReport, name: string, color: string) {
  const points = samplePoints(report, name);
  if (points.length < 2) return;
  charts.push(spec(name, `Cada barra é uma ocorrência medida de ${name}.`, points.length > 12 ? "column" : "bar", color, points));
}

function samplePoints(report: ConsolidatedReport, name: string): ChartPoint[] {
  const movement = report.movements.find((item) => item.name.trim().toLowerCase() === name.trim().toLowerCase());
  return (movement?.samples || []).slice(0, MAX_POINTS).map((sample, index) => ({
    label: String(index + 1),
    value: round(sample.durationSeconds),
  }));
}

function fallbackCharts(view: ReportView, color: string) {
  const charts: ReportChart[] = [];
  pushAverages(charts, view, color);
  pushCycles(charts, view, color);
  return charts;
}

function spec(title: string, caption: string, kind: ReportChart["kind"], color: string, points: ChartPoint[]): ReportChart {
  return { title, caption, kind, color, points };
}

function dedupe(charts: ReportChart[]) {
  const seen = new Set<string>();
  return charts.filter((chart) => {
    const key = `${chart.kind}:${chart.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mentionsPresentation(prompt: string) {
  return /gr[aá]fico|chart|barra|coluna|#[0-9a-f]{6}|\b(verde|azul|vermelho|laranja|amarelo|roxo|rosa|preto|cinza)\b/i.test(prompt);
}

function detectColor(prompt: string) {
  const hex = prompt.match(/#([0-9a-fA-F]{6})\b/);
  if (hex) return `#${hex[1]}`;
  const lower = prompt.toLowerCase();
  const anchor = lower.search(/gr[aá]fico/);
  let best: { distance: number; color: string } | null = null;
  const used: Array<{ index: number; length: number }> = [];
  for (const [name, color] of COLOR_NAMES) {
    const index = lower.indexOf(name);
    if (index < 0) continue;
    if (used.some((span) => index >= span.index && index < span.index + span.length)) continue;
    used.push({ index, length: name.length });
    const distance = anchor < 0 ? index : Math.abs(index - anchor);
    if (!best || distance < best.distance) best = { distance, color };
  }
  return best?.color || null;
}

function normalizeColor(value?: string) {
  const match = value?.match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1]}` : null;
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || text.trim();
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first < 0 || last < 0) throw new Error("sem json");
  return JSON.parse(candidate.slice(first, last + 1));
}

export function tintColor(hex: string, ratio = 0.9) {
  const match = hex.match(/^#?([0-9a-fA-F]{6})$/);
  const raw = match?.[1] || "0f766e";
  const mixed = [0, 2, 4].map((index) => {
    const channel = parseInt(raw.slice(index, index + 2), 16);
    return Math.round(channel + (255 - channel) * ratio);
  });
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
