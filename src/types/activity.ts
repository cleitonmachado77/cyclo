export type ActivityStatus = "draft" | "ready" | "analyzing" | "done" | "error";

export type VideoFile = {
  id: string;
  originalName: string;
  storedName: string;
  storagePath: string;
  publicUrl: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
};

export type MovementTiming = {
  name: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  notes?: string;
  status?: "complete" | "partial" | "not_found";
};

export type VideoAnalysis = {
  videoId: string;
  fileName: string;
  movements: MovementTiming[];
  totalDurationSeconds: number;
  observations?: string;
};

export type AnalysisResult = {
  analyzedAt: string;
  model: string;
  summary: string;
  videos: VideoAnalysis[];
  rawText?: string;
};

export type Activity = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  status: ActivityStatus;
  videos: VideoFile[];
  analysis: AnalysisResult | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateActivityInput = {
  title: string;
  description?: string;
  prompt: string;
};
