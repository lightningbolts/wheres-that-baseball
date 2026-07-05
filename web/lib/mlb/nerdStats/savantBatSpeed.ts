import type { GameNerdSourceRow, SeasonNerdCounters } from "@/lib/mlb/nerdStats/types";
import type { NerdStatSplitFilter } from "@/lib/mlb/nerdStats/splits";

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
  options?: { split?: NerdStatSplitFilter; row?: GameNerdSourceRow },
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

  const split = options?.split ?? "all";
  const row = options?.row;
  const homeRows = feed.team_home ?? [];
  const awayRows = feed.team_away ?? [];

  const rows =
    split === "home"
      ? homeRows
      : split === "away"
        ? awayRows
        : [...homeRows, ...awayRows];

  for (const pitchRow of rows) {
    const teamId = pitchRow.team_batting_id;
    const speed = pitchRow.batSpeed;
    if (teamId == null || speed == null || speed <= 0) continue;
    if (row && split === "home" && teamId !== row.home_team_id) continue;
    if (row && split === "away" && teamId !== row.away_team_id) continue;

    const team = counters[String(teamId)];
    if (!team) continue;

    team.batSpeedSum += speed;
    team.batSpeedCount += 1;
  }
}
