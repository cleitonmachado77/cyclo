import { NextResponse } from "next/server";
import { deleteActivity, getActivity, updateActivity } from "@/lib/store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const activity = await getActivity(id);
  if (!activity) {
    return NextResponse.json({ error: "Atividade não encontrada." }, { status: 404 });
  }
  return NextResponse.json({ activity });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json()) as {
    title?: string;
    description?: string;
    prompt?: string;
  };

  const current = await getActivity(id);
  if (!current) {
    return NextResponse.json({ error: "Atividade não encontrada." }, { status: 404 });
  }

  const nextPrompt = body.prompt?.trim() ?? current.prompt;
  const nextTitle = body.title?.trim() ?? current.title;
  const nextDescription = body.description?.trim() ?? current.description;
  const promptChanged = nextPrompt !== current.prompt;

  const activity = await updateActivity(id, {
    title: nextTitle,
    description: nextDescription,
    prompt: nextPrompt,
    status:
      current.videos.length && nextPrompt
        ? promptChanged && current.status === "done"
          ? "ready"
          : current.status === "draft"
            ? "ready"
            : current.status
        : "draft",
    analysis: promptChanged ? null : current.analysis,
  });

  return NextResponse.json({ activity });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const ok = await deleteActivity(id);
  if (!ok) {
    return NextResponse.json({ error: "Atividade não encontrada." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
