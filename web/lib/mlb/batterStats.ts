import type { BatterHittingLine, BatterRispStats } from "@/types/mlb-live";

import { cachedStatsFetch } from "@/lib/mlb/statsCache";

const MLB_STATS_BASE = "https://statsapi.mlb.com/api/v1";

interface HittingStatRaw {
  atBats?: number;
  hits?: number;
  homeRuns?: number;
  strikeOuts?: number;
  baseOnBalls?: number;
  plateAppearances?: number;
  avg?: string;
  ops?: string;
}

interface StatSplitsResponse {
  stats?: Array<{
    splits?: Array<{ season?: string; stat?: HittingStatRaw }>;
  }>;
}

function parseHittingLine(stat: HittingStatRaw): BatterHittingLine {
  return {
    plateAppearances: stat.plateAppearances ?? 0,
    atBats: stat.atBats ?? 0,
    hits: stat.hits ?? 0,
    homeRuns: stat.homeRuns ?? 0,
    strikeOuts: stat.strikeOuts ?? 0,
    walks: stat.baseOnBalls ?? 0,
    avg: stat.avg ?? ".---",
    ops: stat.ops ?? ".---",
  };
}

export async function fetchBatterRispStats(batterId: number): Promise<BatterRispStats | null> {
  return cachedStatsFetch([`risp`, String(batterId)], async () => {
    const url = new URL(`${MLB_STATS_BASE}/people/${batterId}/stats`);
    url.searchParams.set("stats", "statSplits");
    url.searchParams.set("group", "hitting");
    url.searchParams.set("sitCodes", "risp");

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`MLB RISP stats failed: ${response.status}`);
    }

    const data = (await response.json()) as StatSplitsResponse;
    const split = data.stats?.[0]?.splits?.[0];
    if (!split?.stat) return null;

    return {
      batterId,
      season: split.season ?? "",
      ...parseHittingLine(split.stat),
    };
  });
}
