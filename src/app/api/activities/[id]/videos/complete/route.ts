import { NextResponse } from "next/server";
import type { VideoFile } from "@/types/activity";
import { addVideosToActivity, getActivity, updateActivity } from "@/lib/store";
import { getSupabaseAdmin, VIDEO_BUCKET } from "@/lib/supabase/server";
import { validateVideoFile } from "@/lib/video";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const activity = await getActivity(id);
  if (!activity) {
    return NextResponse.json({ error: "Atividade não encontrada." }, { status: 404 });
  }

  const body = (await request.json()) as {
    videos?: Array<{
      id: string;
      originalName: string;
      storedName: string;
      storagePath: string;
      mimeType: string;
      size: number;
    }>;
  };

  const videos = body.videos ?? [];
  if (!videos.length) {
    return NextResponse.json({ error: "Nenhum vídeo para confirmar." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const added: Omit<VideoFile, "publicUrl">[] = [];

  for (const video of videos) {
    const validationError = validateVideoFile({
      name: video.originalName,
      type: video.mimeType,
      size: video.size,
    });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 413 });
    }

    const { data: listed, error: listError } = await supabase.storage
      .from(VIDEO_BUCKET)
      .list(id, { search: video.storedName });

    if (listError) {
      return NextResponse.json({ error: listError.message }, { status: 500 });
    }

    const exists = (listed ?? []).some((item) => item.name === video.storedName);
    if (!exists) {
      return NextResponse.json(
        { error: `Upload incompleto para ${video.originalName}. Tente novamente.` },
        { status: 400 },
      );
    }

    added.push({
      id: video.id,
      originalName: video.originalName,
      storedName: video.storedName,
      storagePath: video.storagePath,
      mimeType: video.mimeType || "video/mp4",
      size: video.size,
      uploadedAt: new Date().toISOString(),
    });
  }

  const updated = await addVideosToActivity(id, added);
  if (!updated) {
    return NextResponse.json({ error: "Falha ao salvar vídeos." }, { status: 500 });
  }

  if (!activity.prompt.trim()) {
    await updateActivity(id, { status: "draft" });
  }

  const finalActivity = await getActivity(id);
  return NextResponse.json(
    { activity: finalActivity, uploaded: finalActivity?.videos.slice(-added.length) ?? [] },
    { status: 201 },
  );
}
