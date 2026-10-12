import { STAGE_SECTION, measureText, stageHeading } from "@/lib/report-stages";
import type { VideoAnalysis } from "@/types/activity";

export function StageMeasures({ videos }: { videos: VideoAnalysis[] }) {
  if (!videos.length) return null;

  return (
    <div className="stack">
      <h3 className="report-files-title">{STAGE_SECTION}</h3>
      {videos.map((video, stage) => (
        <div key={video.videoId} className="video-item">
          <strong>{stageHeading(stage + 1, video.fileName, video.totalDurationSeconds)}</strong>
          {video.observations ? <p className="muted">{video.observations}</p> : null}
          {video.movements.length ? (
            <ol className="stage-measures">
              {video.movements.map((movement, index) => (
                <li key={`${video.videoId}-${index}`}>{measureText(movement)}</li>
              ))}
            </ol>
          ) : (
            <p className="muted">Nenhum movimento medido.</p>
          )}
        </div>
      ))}
    </div>
  );
}
