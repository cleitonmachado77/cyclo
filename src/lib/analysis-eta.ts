export class AnalysisEta {
  private segmentDurations: number[] = [];
  private prepDurations: number[] = [];
  private plans: number[] = [];
  private openSegment = 0;
  private openPrep = 0;

  beginPrep() {
    this.openPrep = Date.now();
  }

  finishPrep() {
    if (!this.openPrep) return;
    this.prepDurations.push(Date.now() - this.openPrep);
    this.openPrep = 0;
  }

  beginSegment() {
    this.openSegment = Date.now();
  }

  finishSegment() {
    if (!this.openSegment) return;
    this.segmentDurations.push(Date.now() - this.openSegment);
    this.openSegment = 0;
  }

  rememberPlan(count: number) {
    if (count > 0) this.plans.push(count);
  }

  estimate(remainingSegments: number, videosAfter: number) {
    if (remainingSegments <= 0 && videosAfter <= 0) return 0;
    if (!this.segmentDurations.length && !this.prepDurations.length) return null;

    const avgSegment = average(this.segmentDurations);
    const avgPrep = average(this.prepDurations);
    const avgPlan = average(this.plans);
    const futureSegments = videosAfter > 0 && avgPlan > 0 ? Math.round(videosAfter * avgPlan) : 0;
    const prepLeft = videosAfter > 0 && avgPrep > 0 ? videosAfter * avgPrep : 0;
    const segmentLeft = avgSegment > 0 ? (remainingSegments + futureSegments) * avgSegment : 0;

    if (prepLeft + segmentLeft <= 0) return null;
    return Math.round((prepLeft + segmentLeft) / 1000);
  }
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
