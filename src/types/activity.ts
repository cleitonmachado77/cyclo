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

/**
 * repetitivo/casual/estranho/espera/maquina são elementos folha.
 * "ciclo" é o intervalo do ciclo completo do posto e cobre os elementos folha.
 * "sem_visao" é tempo em que a câmera não mostra o posto; fica fora das estatísticas.
 */
export type ElementType = "repetitivo" | "casual" | "estranho" | "espera" | "maquina" | "ciclo" | "sem_visao";

export type MovementTiming = {
  name: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  notes?: string;
  status?: "complete" | "partial" | "not_found";
  station?: string;
  operator?: string;
  elementType?: ElementType;
  cycle?: number | null;
};

export type StationInfo = {
  id: string;
  description: string;
};

export type VideoAnalysis = {
  videoId: string;
  fileName: string;
  movements: MovementTiming[];
  totalDurationSeconds: number;
  observations?: string;
  stations?: StationInfo[];
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
