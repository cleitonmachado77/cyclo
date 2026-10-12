import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Upload multipart legado desativado.
 * Use /videos/sign + upload direto + /videos/complete.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Use o fluxo de upload direto. Se o vídeo passar de 50 MB, comprima ou aumente o limite global do Storage no Supabase.",
    },
    { status: 410 },
  );
}
