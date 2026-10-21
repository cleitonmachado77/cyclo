import { NextResponse } from "next/server";
import { readActivityReport } from "@/lib/activity-reports";
import { renderReportDocx } from "@/lib/report-docx";
import { renderReportPdf } from "@/lib/report-pdf";
import { renderReportTxt } from "@/lib/report-txt";
import { renderReportXlsx } from "@/lib/report-xlsx";
import { presentReport } from "@/lib/report-layout";
import { buildReportView } from "@/lib/report-view";
import { getActivity } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; runId: string }> };
type ReportFormat = "txt" | "pdf" | "docx" | "xlsx";

export async function GET(request: Request, { params }: Params) {
  const { id, runId } = await params;
  const format = reportFormat(new URL(request.url).searchParams.get("format"));
  if (!format) {
    return NextResponse.json({ error: "Formato de relatório inválido." }, { status: 400 });
  }

  const activity = await getActivity(id);
  if (!activity) {
    return NextResponse.json({ error: "Atividade não encontrada." }, { status: 404 });
  }

  try {
    const source = await readActivityReport(activity.id, runId, activity.title);
    if (!source) {
      return NextResponse.json({ error: "Relatório não encontrado." }, { status: 404 });
    }

    const view = await presentReport(buildReportView(source), source.report);
    if (format === "pdf") {
      const body = await renderReportPdf(view);
      return attachment(`${view.fileBase}.pdf`, "application/pdf", new Uint8Array(body));
    }
    if (format === "docx") {
      const body = await renderReportDocx(view);
      return attachment(
        `${view.fileBase}.docx`,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        new Uint8Array(body),
      );
    }
    if (format === "xlsx") {
      const body = await renderReportXlsx(view, source.report);
      return attachment(
        `${view.fileBase}.xlsx`,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        new Uint8Array(body),
      );
    }

    const text = renderReportTxt(source);
    return attachment(`${view.fileBase}.txt`, "text/plain; charset=utf-8", `\uFEFF${text}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao gerar o arquivo.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function reportFormat(value: string | null): ReportFormat | null {
  if (!value || value === "txt") return "txt";
  if (value === "pdf" || value === "docx" || value === "xlsx") return value;
  return null;
}

function attachment(fileName: string, contentType: string, body: BodyInit) {
  const asciiName = fileName.replace(/[^\w.\-]+/g, "_");
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
