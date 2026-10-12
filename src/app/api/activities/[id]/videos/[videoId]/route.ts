import { NextResponse } from "next/server";
import { removeVideo } from "@/lib/store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; videoId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const { id, videoId } = await params;
  const activity = await removeVideo(id, videoId);
  if (!activity) {
    return NextResponse.json({ error: "Vídeo ou atividade não encontrado." }, { status: 404 });
  }
  return NextResponse.json({ activity });
}
