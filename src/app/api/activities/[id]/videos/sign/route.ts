import path from "path";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getActivity } from "@/lib/store";
import { getSupabaseAdmin, VIDEO_BUCKET } from "@/lib/supabase/server";
import { validateVideoFile } from "@/lib/video";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function extensionFor(mimeType: string, fileName: string) {
  const fromName = path.extname(fileName);
  if (fromName) return fromName.toLowerCase();
  if (mimeType === "video/webm") return ".webm";
  if (mimeType === "video/quicktime") return ".mov";
  return ".mp4";
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const activity = await getActivity(id);
  if (!activity) {
    return NextResponse.json({ error: "Atividade não encontrada." }, { status: 404 });
  }

  const body = (await request.json()) as {
    fileName?: string;
    mimeType?: string;
    size?: number;
  };

  const fileName = body.fileName?.trim();
  const mimeType = body.mimeType || "video/mp4";
  const size = Number(body.size || 0);

  if (!fileName || !size) {
    return NextResponse.json({ error: "Metadados do vídeo incompletos." }, { status: 400 });
  }

  const validationError = validateVideoFile({ name: fileName, type: mimeType, size });
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 413 });
  }

  const videoId = randomUUID();
  const storedName = `${id}-${videoId}${extensionFor(mimeType, fileName)}`;
  const storagePath = `${id}/${storedName}`;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(VIDEO_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Falha ao gerar URL de upload." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    videoId,
    storedName,
    storagePath,
    path: data.path,
    token: data.token,
    signedUrl: data.signedUrl,
  });
}
