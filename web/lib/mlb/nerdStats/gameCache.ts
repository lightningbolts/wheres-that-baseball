import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createEmptySeasonCounters, mergeSeasonCounters } from "@/lib/mlb/nerdStats/counters";
import { mergePlayerSeasonCounters } from "@/lib/mlb/nerdStats/playerMirror";
import type { NerdStatSplitId } from "@/lib/mlb/nerdStats/splits";
import type { SeasonNerdCounters, SeasonPlayerNerdCounters } from "@/lib/mlb/nerdStats/types";
import { gameDateInNerdWindow, type NerdStatWindowId } from "@/lib/mlb/nerdStats/windows";

export interface PerGameNerdCacheEntry {
  gamePk: number;
  gameDate: string;
  combined: SeasonNerdCounters;
  home: SeasonNerdCounters;
  away: SeasonNerdCounters;
  /** Player counters for this game (season-scope / split=all). */
  players?: SeasonPlayerNerdCounters;
  extractedAt: string;
}

function gamesDir(season: number): string {
  return join(process.cwd(), "data", "nerd-stats", String(season), "games");
}

function gameCachePath(season: number, gamePk: number): string {
  return join(gamesDir(season), `${gamePk}.json`);
}

export function writePerGameNerdCache(
  season: number,
  entry: PerGameNerdCacheEntry,
): void {
  mkdirSync(gamesDir(season), { recursive: true });
  writeFileSync(gameCachePath(season, entry.gamePk), `${JSON.stringify(entry)}\n`, "utf8");
}

export function loadPerGameNerdCache(
  season: number,
  gamePk: number,
): PerGameNerdCacheEntry | null {
  const path = gameCachePath(season, gamePk);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as PerGameNerdCacheEntry;
}

export function listCachedGamePks(season: number): number[] {
  const dir = gamesDir(season);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => Number.parseInt(name.replace(/\.json$/, ""), 10))
    .filter((gamePk) => Number.isFinite(gamePk));
}

export function loadPerGameNerdCaches(
  season: number,
  gamePks: number[],
): { cached: PerGameNerdCacheEntry[]; missing: number[] } {
  const cached: PerGameNerdCacheEntry[] = [];
  const missing: number[] = [];

  for (const gamePk of gamePks) {
    const entry = loadPerGameNerdCache(season, gamePk);
    if (entry) cached.push(entry);
    else missing.push(gamePk);
  }

  return { cached, missing };
}

export function mergePerGameCaches(
  entries: PerGameNerdCacheEntry[],
  scope: "combined" | NerdStatSplitId = "combined",
): SeasonNerdCounters {
  const counters = createEmptySeasonCounters();
  for (const entry of entries) {
    const slice =
      scope === "home" ? entry.home : scope === "away" ? entry.away : entry.combined;
    mergeSeasonCounters(counters, slice);
  }
  return counters;
}

export function mergePerGamePlayerCaches(
  entries: PerGameNerdCacheEntry[],
): SeasonPlayerNerdCounters {
  const players: SeasonPlayerNerdCounters = {};
  for (const entry of entries) {
    if (entry.players) mergePlayerSeasonCounters(players, entry.players);
  }
  return players;
}

export function mergePerGameCachesForWindow(
  entries: PerGameNerdCacheEntry[],
  windowId: NerdStatWindowId,
  scope: "combined" | NerdStatSplitId = "combined",
): SeasonNerdCounters {
  const filtered = entries.filter((entry) => gameDateInNerdWindow(entry.gameDate, windowId));
  return mergePerGameCaches(filtered, scope);
}

export function countPerGameCachesInWindow(
  entries: PerGameNerdCacheEntry[],
  windowId: NerdStatWindowId,
): number {
  return entries.filter((entry) => gameDateInNerdWindow(entry.gameDate, windowId)).length;
}
