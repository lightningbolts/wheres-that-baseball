/** Lightweight MLB fetch observability (client + server). */

export interface FetchMetricSample {
  gamePk: number;
  source: "browser" | "server" | "snapshot";
  latencyMs: number;
  payloadBytes: number;
  status: number;
  notModified: boolean;
  at: string;
}

const MAX_SAMPLES = 200;
const samples: FetchMetricSample[] = [];

export function recordFetchMetric(sample: FetchMetricSample): void {
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) {
    samples.splice(0, samples.length - MAX_SAMPLES);
  }

  if (process.env.NODE_ENV === "development") {
    console.debug("[mlb-fetch]", {
      gamePk: sample.gamePk,
      source: sample.source,
      latencyMs: Math.round(sample.latencyMs),
      payloadBytes: sample.payloadBytes,
      status: sample.status,
      notModified: sample.notModified,
    });
  }
}

export function getRecentFetchMetrics(gamePk?: number): FetchMetricSample[] {
  if (gamePk == null) return [...samples];
  return samples.filter((s) => s.gamePk === gamePk);
}

export function clearFetchMetrics(): void {
  samples.length = 0;
}
