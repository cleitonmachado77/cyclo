import { NextResponse } from "next/server";
import { createActivity, listActivities } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const activities = await listActivities();
  return NextResponse.json({ activities });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    title?: string;
    description?: string;
    prompt?: string;
  };

  if (!body.title?.trim() || !body.prompt?.trim()) {
    return NextResponse.json(
      { error: "Título e prompt são obrigatórios." },
      { status: 400 },
    );
  }

  const activity = await createActivity({
    title: body.title,
    description: body.description,
    prompt: body.prompt,
  });

  return NextResponse.json({ activity }, { status: 201 });
}
