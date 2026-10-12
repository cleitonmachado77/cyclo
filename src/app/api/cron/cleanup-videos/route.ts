import { NextResponse } from "next/server";
import { getSupabaseAdmin, VIDEO_BUCKET } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Remove vídeos expirados da esteira (storage + soft delete).
 * Protegido por CRON_SECRET quando definido.
 */
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = request.headers.get("authorization") || "";
    if (header !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }
  }

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { data: expired, error } = await supabase
    .from("activity_videos")
    .select("id, storage_path, original_name")
    .is("deleted_at", null)
    .not("expires_at", "is", null)
    .lte("expires_at", now)
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = expired || [];
  if (!rows.length) {
    return NextResponse.json({ deleted: 0, message: "Nenhum vídeo expirado." });
  }

  const paths = rows.map((row) => row.storage_path).filter(Boolean);
  if (paths.length) {
    await supabase.storage.from(VIDEO_BUCKET).remove(paths);
  }

  const { error: updateError } = await supabase
    .from("activity_videos")
    .update({ deleted_at: now })
    .in(
      "id",
      rows.map((row) => row.id),
    );

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    deleted: rows.length,
    files: rows.map((row) => row.original_name),
  });
}

export async function GET(request: Request) {
  return POST(request);
}
