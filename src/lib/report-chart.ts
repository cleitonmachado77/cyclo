import sharp from "sharp";
import type { ReportChart } from "@/lib/report-view";

export type ChartImage = {
  png: Buffer;
  width: number;
  height: number;
};

const WIDTH = 1000;

export async function renderChart(chart: ReportChart): Promise<ChartImage | null> {
  if (!chart.points.length) return null;
  const color = /^#[0-9a-fA-F]{6}$/.test(chart.color) ? chart.color : "#0f766e";
  const svg = chart.kind === "column" ? columnSvg(chart.title, chart.points, color) : barSvg(chart.title, chart.points, color);
  const height = chart.kind === "column" ? 320 : 64 + chart.points.length * 42;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { png, width: WIDTH, height };
}

function barSvg(title: string, items: ReportChart["points"], color: string) {
  const row = 42;
  const height = 64 + items.length * row;
  const max = Math.max(...items.map((item) => item.value), 0.1);
  const labelWidth = 250;
  const plot = WIDTH - labelWidth - 110;
  const bars = items
    .map((item, index) => {
      const y = 52 + index * row;
      const width = Math.max(4, (plot * item.value) / max);
      return `
        <text x="16" y="${y + 16}" font-size="16" font-family="Arial, sans-serif" fill="#1f2933">${escapeXml(trim(item.label, 28))}</text>
        <rect x="${labelWidth}" y="${y}" width="${width}" height="22" rx="4" fill="${color}"/>
        <text x="${labelWidth + width + 8}" y="${y + 16}" font-size="15" font-family="Arial, sans-serif" fill="#334155">${formatValue(item.value)}</text>
      `;
    })
    .join("");
  return frame(title, bars, height);
}

function columnSvg(title: string, items: ReportChart["points"], color: string) {
  const height = 320;
  const plotBottom = 250;
  const plotHeight = plotBottom - 56;
  const max = Math.max(...items.map((item) => item.value), 0.1);
  const slot = (WIDTH - 70) / items.length;
  const barWidth = Math.max(4, slot * 0.62);
  const step = items.length > 24 ? 5 : items.length > 16 ? 2 : 1;
  const bars = items
    .map((item, index) => {
      const barHeight = Math.max(2, (plotHeight * item.value) / max);
      const x = 48 + index * slot + (slot - barWidth) / 2;
      const y = plotBottom - barHeight;
      const label =
        index % step === 0 || index === items.length - 1
          ? `<text x="${x + barWidth / 2}" y="274" text-anchor="middle" font-size="12" font-family="Arial, sans-serif" fill="#64748b">${escapeXml(item.label)}</text>`
          : "";
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="2" fill="${color}"/>${label}`;
    })
    .join("");
  const axis = `<line x1="40" y1="${plotBottom}" x2="${WIDTH - 16}" y2="${plotBottom}" stroke="#cbd5e1"/>
    <text x="8" y="64" font-size="12" font-family="Arial, sans-serif" fill="#64748b">${formatValue(max)}</text>`;
  return frame(title, axis + bars, height);
}

function frame(title: string, body: string, height: number) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
  <rect width="100%" height="100%" fill="#f8fafc"/>
  <text x="16" y="30" font-size="18" font-weight="700" font-family="Arial, sans-serif" fill="#0f172a">${escapeXml(title)}</text>
  ${body}
</svg>`;
}

function formatValue(value: number) {
  return `${value.toFixed(1).replace(".", ",")} s`;
}

function trim(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
