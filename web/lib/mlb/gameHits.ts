import type { HitData, PlayByPlayEntry, PlayDetail } from "@/types/mlb-live";

export const HIT_EVENTS = new Set(["Single", "Double", "Triple", "Home Run"]);

export type HitType = "Single" | "Double" | "Triple" | "Home Run";

export const HIT_TYPE_COLORS: Record<HitType, string> = {
  Single: "#38bdf8",
  Double: "#4ade80",
  Triple: "#fbbf24",
  "Home Run": "#f87171",
};

export const HIT_TYPE_LABELS: Record<HitType, string> = {
  Single: "1B",
  Double: "2B",
  Triple: "3B",
  "Home Run": "HR",
};

export interface GameHit {
  atBatIndex: number;
  batterName: string;
  event: HitType;
  inning: number;
  halfInning: string;
  awayScore: number;
  homeScore: number;
  hit: HitData;
  color: string;
  /** Terminal pitch GUID for Savant clip lookup. */
  playId?: string;
  detail: PlayDetail;
}

export type SprayChartHit = Pick<GameHit, "atBatIndex" | "event" | "hit" | "color">;

export interface GameHitStats {
  total: number;
  singles: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  avgExitVelo: number | null;
  avgLaunchAngle: number | null;
  maxExitVelo: number | null;
  maxDistance: number | null;
}

export function isHitEvent(event: string): event is HitType {
  return HIT_EVENTS.has(event);
}

export function extractGameHits(plays: PlayByPlayEntry[]): GameHit[] {
  const hits: GameHit[] = [];

  for (const play of plays) {
    if (!isHitEvent(play.event)) continue;
    const hit = play.detail.hit;
    if (!hit || (hit.coordX === 0 && hit.coordY === 0 && hit.totalDistance === 0)) continue;

    hits.push({
      atBatIndex: play.atBatIndex,
      batterName: play.batterName,
      event: play.event,
      inning: play.inning,
      halfInning: play.halfInning,
      awayScore: play.awayScore,
      homeScore: play.homeScore,
      hit,
      color: HIT_TYPE_COLORS[play.event],
      playId: play.playId ?? play.detail.playId,
      detail: play.detail,
    });
  }

  return hits;
}

export function computeGameHitStats(
  hits: Array<Pick<GameHit, "event" | "hit">>,
): GameHitStats {
  const singles = hits.filter((h) => h.event === "Single").length;
  const doubles = hits.filter((h) => h.event === "Double").length;
  const triples = hits.filter((h) => h.event === "Triple").length;
  const homeRuns = hits.filter((h) => h.event === "Home Run").length;

  const exitVelos = hits.map((h) => h.hit.launchSpeed).filter((v) => v > 0);
  const launchAngles = hits.map((h) => h.hit.launchAngle).filter((v) => Number.isFinite(v));
  const distances = hits.map((h) => h.hit.totalDistance).filter((d) => d > 0);

  const avg = (values: number[]) =>
    values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

  return {
    total: hits.length,
    singles,
    doubles,
    triples,
    homeRuns,
    avgExitVelo: avg(exitVelos),
    avgLaunchAngle: avg(launchAngles),
    maxExitVelo: exitVelos.length > 0 ? Math.max(...exitVelos) : null,
    maxDistance: distances.length > 0 ? Math.max(...distances) : null,
  };
}
