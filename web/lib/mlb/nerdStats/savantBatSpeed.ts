import type { SeasonNerdCounters } from "@/lib/mlb/nerdStats/types";

interface SavantPitchRow {
  team_batting_id?: number;
  batSpeed?: number;
}

interface SavantGameFeed {
  team_home?: SavantPitchRow[];
  team_away?: SavantPitchRow[];
}

/** Fetch per-team bat speed from Baseball Savant (not in the MLB live feed). */
export async function enrichCountersWithSavantBatSpeed(
  counters: SeasonNerdCounters,
  gamePk: number,
): Promise<void> {
  let feed: SavantGameFeed;
  try {
    const response = await fetch(`https://baseballsavant.mlb.com/gf?game_pk=${gamePk}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return;
    feed = (await response.json()) as SavantGameFeed;
  } catch {
    return;
  }

  const rows = [...(feed.team_home ?? []), ...(feed.team_away ?? [])];
  for (const row of rows) {
    const teamId = row.team_batting_id;
    const speed = row.batSpeed;
    if (teamId == null || speed == null || speed <= 0) continue;

    const team = counters[String(teamId)];
    if (!team) continue;

    team.batSpeedSum += speed;
    team.batSpeedCount += 1;
  }
}
