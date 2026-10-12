export const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_BYTES || 50 * 1024 * 1024 * 1024);

export const ALLOWED_VIDEO_MIME = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/mpeg",
  "video/3gpp",
  "video/x-matroska",
]);

export function formatMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function validateVideoFile(file: { name: string; type: string; size: number }) {
  if (file.type && !ALLOWED_VIDEO_MIME.has(file.type) && !file.type.startsWith("video/")) {
    return `Formato não suportado: ${file.name}`;
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return `O vídeo "${file.name}" tem ${formatMb(file.size)}. O limite configurado no app é ${formatMb(MAX_VIDEO_BYTES)}. Se o Supabase ainda bloquear, aumente o Global file size limit em Project Settings → Storage.`;
  }
  return null;
}
