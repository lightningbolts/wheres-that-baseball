import { extractNerdCountersFromGame } from "@/lib/mlb/nerdStats/extractGame";
import type { PerGameNerdCacheEntry } from "@/lib/mlb/nerdStats/gameCache";
import { loadPerGameNerdCache, writePerGameNerdCache } from "@/lib/mlb/nerdStats/gameCache";
import { loadGameSourceRow } from "@/lib/mlb/nerdStats/gameSourceCache";
import type { NerdStatSplitFilter } from "@/lib/mlb/nerdStats/splits";
import type { GameNerdSourceRow, SeasonNerdCounters } from "@/lib/mlb/nerdStats/types";

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

export function resetBatSpeedCounters(counters: SeasonNerdCounters): void {
  for (const team of Object.values(counters)) {
    if (!team || typeof team !== "object") continue;
    team.batSpeedSum = 0;
    team.batSpeedCount = 0;
  }
}

/** Keep bat-speed totals when re-aggregating PBP counters with --skip-savant. */
export function preserveBatSpeedCounters(
  target: SeasonNerdCounters,
  source: SeasonNerdCounters,
): void {
  for (const [teamId, team] of Object.entries(target)) {
    const previous = source[teamId];
    if (!previous || !team) continue;
    team.batSpeedSum = previous.batSpeedSum;
    team.batSpeedCount = previous.batSpeedCount;
  }
}

/**
 * Refresh Savant bat speed on a per-game cache entry.
 * Uses stored game_state when present — no Supabase reads.
 */
export async function refreshSavantBatSpeedForGame(
  season: number,
  gamePk: number,
): Promise<PerGameNerdCacheEntry | null> {
  const source = loadGameSourceRow(season, gamePk);
  const existing = loadPerGameNerdCache(season, gamePk);

  if (!existing && source) {
    const combined = extractNerdCountersFromGame(source, "all");
    const home = extractNerdCountersFromGame(source, "home");
    const away = extractNerdCountersFromGame(source, "away");
    await enrichCountersWithSavantBatSpeed(combined, gamePk, { row: source, split: "all" });
    await enrichCountersWithSavantBatSpeed(home, gamePk, { row: source, split: "home" });
    await enrichCountersWithSavantBatSpeed(away, gamePk, { row: source, split: "away" });
    const entry: PerGameNerdCacheEntry = {
      gamePk,
      gameDate: source.game_date,
      combined,
      home,
      away,
      extractedAt: new Date().toISOString(),
    };
    writePerGameNerdCache(season, entry);
    return entry;
  }

  if (!existing) return null;

  resetBatSpeedCounters(existing.combined);
  resetBatSpeedCounters(existing.home);
  resetBatSpeedCounters(existing.away);

  await enrichCountersWithSavantBatSpeed(existing.combined, gamePk, {
    row: source ?? undefined,
    split: "all",
  });
  await enrichCountersWithSavantBatSpeed(existing.home, gamePk, {
    row: source ?? undefined,
    split: "home",
  });
  await enrichCountersWithSavantBatSpeed(existing.away, gamePk, {
    row: source ?? undefined,
    split: "away",
  });

  const entry: PerGameNerdCacheEntry = {
    ...existing,
    extractedAt: new Date().toISOString(),
  };
  writePerGameNerdCache(season, entry);
  return entry;
}
