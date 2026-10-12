import { NextResponse } from "next/server";
import { listActivityReports } from "@/lib/activity-reports";
import { getActivity } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const activity = await getActivity(id);
  if (!activity) {
    return NextResponse.json({ error: "Atividade não encontrada." }, { status: 404 });
  }

  try {
    const reports = await listActivityReports(activity.id, activity.title);
    return NextResponse.json({
      reports: reports.map((report) => ({
        ...report,
        downloadUrl: `/api/activities/${activity.id}/reports/${report.id}`,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao listar relatórios.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
