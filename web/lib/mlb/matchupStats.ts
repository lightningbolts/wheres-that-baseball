import type { BatterHittingLine, BatterVsPitcherRecord } from "@/types/mlb-live";

import { cachedStatsFetch } from "@/lib/mlb/statsCache";

const MLB_STATS_BASE = "https://statsapi.mlb.com/api/v1";

interface VsPlayerTotalStat {
  atBats?: number;
  hits?: number;
  homeRuns?: number;
  strikeOuts?: number;
  baseOnBalls?: number;
  plateAppearances?: number;
  avg?: string;
  ops?: string;
}

interface VsPlayerTotalResponse {
  stats?: Array<{
    splits?: Array<{ stat?: VsPlayerTotalStat }>;
  }>;
}

function parseHittingLine(stat: VsPlayerTotalStat): BatterHittingLine {
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

export async function fetchBatterVsPitcherRecord(
  batterId: number,
  pitcherId: number,
): Promise<BatterVsPitcherRecord | null> {
  return cachedStatsFetch([`matchup`, String(batterId), String(pitcherId)], async () => {
    const url = new URL(`${MLB_STATS_BASE}/people/${batterId}/stats`);
    url.searchParams.set("stats", "vsPlayerTotal");
    url.searchParams.set("group", "hitting");
    url.searchParams.set("opposingPlayerId", String(pitcherId));

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`MLB matchup stats failed: ${response.status}`);
    }

    const data = (await response.json()) as VsPlayerTotalResponse;
    const stat = data.stats?.[0]?.splits?.[0]?.stat;
    if (!stat) return null;

    return {
      batterId,
      pitcherId,
      ...parseHittingLine(stat),
    };
  });
}
