import type {
  Activity,
  ActivityStatus,
  AnalysisResult,
  CreateActivityInput,
  VideoFile,
} from "@/types/activity";
import { reconcileStaleAnalyzing, reconcileStaleAnalyzingMany } from "@/lib/analysis-stale";
import { getPublicVideoUrl, getSupabaseAdmin, VIDEO_BUCKET } from "@/lib/supabase/server";

const DEFAULT_COMPANY_ID =
  process.env.CYCLO_COMPANY_ID ||
  process.env.TEMPOOPS_COMPANY_ID ||
  "912bf6f8-e676-462e-8e9a-f44cf7534b34";

type ActivityRow = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  gemini_prompt: string | null;
  gemini_status: ActivityStatus;
  gemini_analysis: AnalysisResult | null;
  gemini_error: string | null;
  created_at: string;
  updated_at: string;
};

type VideoRow = {
  id: string;
  activity_id: string;
  original_name: string;
  stored_name: string;
  storage_path: string;
  mime_type: string;
  size: number;
  uploaded_at: string;
};

function mapVideo(row: VideoRow): VideoFile {
  return {
    id: row.id,
    originalName: row.original_name,
    storedName: row.stored_name,
    storagePath: row.storage_path,
    publicUrl: getPublicVideoUrl(row.storage_path),
    mimeType: row.mime_type,
    size: Number(row.size),
    uploadedAt: row.uploaded_at,
  };
}

function mapActivity(row: ActivityRow, videos: VideoFile[]): Activity {
  return {
    id: row.id,
    title: row.name,
    description: row.description ?? "",
    prompt: row.gemini_prompt ?? "",
    status: row.gemini_status || "draft",
    videos,
    analysis: row.gemini_analysis,
    errorMessage: row.gemini_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function makeCode(title: string) {
  const base = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 16);
  const suffix = Date.now().toString(36).toUpperCase().slice(-4);
  return `${base || "ATIV"}-${suffix}`;
}

async function fetchVideosByActivityIds(activityIds: string[]) {
  if (!activityIds.length) return new Map<string, VideoFile[]>();

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("activity_videos")
    .select("*")
    .in("activity_id", activityIds)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: true });

  if (error) throw new Error(error.message);

  const map = new Map<string, VideoFile[]>();
  for (const row of (data ?? []) as VideoRow[]) {
    const list = map.get(row.activity_id) ?? [];
    list.push(mapVideo(row));
    map.set(row.activity_id, list);
  }
  return map;
}

export async function listActivities(): Promise<Activity[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("activities")
    .select(
      "id, name, code, description, gemini_prompt, gemini_status, gemini_analysis, gemini_error, created_at, updated_at",
    )
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ActivityRow[];
  const videosMap = await fetchVideosByActivityIds(rows.map((row) => row.id));
  const activities = rows.map((row) => mapActivity(row, videosMap.get(row.id) ?? []));
  return reconcileStaleAnalyzingMany(activities);
}

export async function getActivity(id: string): Promise<Activity | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("activities")
    .select(
      "id, name, code, description, gemini_prompt, gemini_status, gemini_analysis, gemini_error, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const videosMap = await fetchVideosByActivityIds([id]);
  return reconcileStaleAnalyzing(mapActivity(data as ActivityRow, videosMap.get(id) ?? []));
}

export async function createActivity(input: CreateActivityInput): Promise<Activity> {
  const supabase = getSupabaseAdmin();
  const title = input.title.trim();
  const prompt = input.prompt.trim();

  const { data, error } = await supabase
    .from("activities")
    .insert({
      company_id: DEFAULT_COMPANY_ID,
      name: title,
      code: makeCode(title),
      description: (input.description ?? "").trim() || null,
      unit: "ciclo",
      status: "DRAFT",
      gemini_prompt: prompt,
      gemini_status: "draft",
      gemini_analysis: null,
      gemini_error: null,
    })
    .select(
      "id, name, code, description, gemini_prompt, gemini_status, gemini_analysis, gemini_error, created_at, updated_at",
    )
    .single();

  if (error) throw new Error(error.message);
  return mapActivity(data as ActivityRow, []);
}

export async function updateActivity(
  id: string,
  patch: Partial<Activity>,
): Promise<Activity | null> {
  const current = await getActivity(id);
  if (!current) return null;

  const supabase = getSupabaseAdmin();
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (patch.title !== undefined) payload.name = patch.title;
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.prompt !== undefined) payload.gemini_prompt = patch.prompt;
  if (patch.status !== undefined) payload.gemini_status = patch.status;
  if (patch.analysis !== undefined) payload.gemini_analysis = patch.analysis;
  if (patch.errorMessage !== undefined) payload.gemini_error = patch.errorMessage;

  const { data, error } = await supabase
    .from("activities")
    .update(payload)
    .eq("id", id)
    .select(
      "id, name, code, description, gemini_prompt, gemini_status, gemini_analysis, gemini_error, created_at, updated_at",
    )
    .single();

  if (error) throw new Error(error.message);

  const videos =
    patch.videos !== undefined
      ? patch.videos
      : ((await fetchVideosByActivityIds([id])).get(id) ?? []);

  return mapActivity(data as ActivityRow, videos);
}

export async function addVideosToActivity(
  activityId: string,
  videos: Omit<VideoFile, "publicUrl">[],
): Promise<Activity | null> {
  const supabase = getSupabaseAdmin();
  if (videos.length) {
    const { error } = await supabase.from("activity_videos").insert(
      videos.map((video) => ({
        id: video.id,
        activity_id: activityId,
        original_name: video.originalName,
        stored_name: video.storedName,
        storage_path: video.storagePath,
        mime_type: video.mimeType,
        size: video.size,
        uploaded_at: video.uploadedAt,
        source: "manual",
        expires_at: new Date(
          Date.now() + Number(process.env.VIDEO_RETENTION_HOURS || 72) * 60 * 60 * 1000,
        ).toISOString(),
      })),
    );
    if (error) throw new Error(error.message);
  }

  const current = await getActivity(activityId);
  if (!current) return null;

  return updateActivity(activityId, {
    status: current.prompt.trim() ? "ready" : "draft",
    analysis: null,
    errorMessage: null,
    videos: current.videos,
  });
}

export async function removeVideo(activityId: string, videoId: string): Promise<Activity | null> {
  const activity = await getActivity(activityId);
  if (!activity) return null;

  const video = activity.videos.find((item) => item.id === videoId);
  if (!video) return null;

  const supabase = getSupabaseAdmin();
  await supabase.storage.from(VIDEO_BUCKET).remove([video.storagePath]);

  const { error } = await supabase.from("activity_videos").delete().eq("id", videoId);
  if (error) throw new Error(error.message);

  const remaining = activity.videos.filter((item) => item.id !== videoId);
  return updateActivity(activityId, {
    status: remaining.length && activity.prompt.trim() ? "ready" : "draft",
    analysis: null,
    errorMessage: null,
    videos: remaining,
  });
}

export async function deleteActivity(id: string): Promise<boolean> {
  const activity = await getActivity(id);
  if (!activity) return false;

  const supabase = getSupabaseAdmin();
  if (activity.videos.length) {
    await supabase.storage
      .from(VIDEO_BUCKET)
      .remove(activity.videos.map((video) => video.storagePath));
  }

  const { error } = await supabase.from("activities").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return true;
}

export async function downloadVideoToTemp(video: VideoFile, targetPath: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.from(VIDEO_BUCKET).download(video.storagePath);
  if (error || !data) {
    throw new Error(error?.message || `Falha ao baixar vídeo ${video.originalName}`);
  }

  const { promises: fs } = await import("fs");
  const buffer = Buffer.from(await data.arrayBuffer());
  await fs.writeFile(targetPath, buffer);
}
