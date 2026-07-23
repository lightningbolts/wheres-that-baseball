import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { buildPlayerNerdCard } from "@/lib/mlb/nerdStats/playerNerdBuild";
import { mergePlayerSeasonCounters } from "@/lib/mlb/nerdStats/playerMirror";
import type {
  PlayerNerdCard,
  PlayerNerdCounters,
  PlayerNerdIndex,
  PlayerNerdIndexEntry,
  SeasonNerdCounters,
  SeasonPlayerNerdCounters,
} from "@/lib/mlb/nerdStats/types";

function seasonDir(season: number): string {
  return join(process.cwd(), "data", "nerd-stats", String(season));
}

function playersDir(season: number): string {
  return join(seasonDir(season), "players");
}

function indexPath(season: number): string {
  return join(seasonDir(season), "players-index.json");
}

function playerPath(season: number, playerId: number): string {
  return join(playersDir(season), `${playerId}.json`);
}

function countersPath(season: number): string {
  return join(seasonDir(season), "player-counters.json");
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data)}\n`, "utf8");
}

export function loadSeasonPlayerCounters(season: number): SeasonPlayerNerdCounters {
  return readJson<SeasonPlayerNerdCounters>(countersPath(season)) ?? {};
}

export function loadPlayerNerdIndex(season: number): PlayerNerdIndex | null {
  return readJson<PlayerNerdIndex>(indexPath(season));
}

export function loadPlayerNerdCardFile(season: number, playerId: number): PlayerNerdCard | null {
  return readJson<PlayerNerdCard>(playerPath(season, playerId));
}

export function writePlayerNerdStore(
  season: number,
  players: SeasonPlayerNerdCounters,
  teamCounters: SeasonNerdCounters,
): void {
  const dir = playersDir(season);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });

  writeJson(countersPath(season), players);

  const indexEntries: PlayerNerdIndexEntry[] = [];
  const generatedAt = new Date().toISOString();
  const playersByTeam = new Map<number, PlayerNerdCounters[]>();

  for (const player of Object.values(players)) {
    if (!player?.playerId) continue;
    if (player.plateAppearances === 0 && player.pitchesThrown === 0) continue;
    const list = playersByTeam.get(player.teamId) ?? [];
    list.push(player);
    playersByTeam.set(player.teamId, list);
  }

  for (const player of Object.values(players)) {
    if (!player?.playerId) continue;
    if (player.plateAppearances === 0 && player.pitchesThrown === 0) continue;

    const team = teamCounters[String(player.teamId)] ?? null;
    const teammates = playersByTeam.get(player.teamId) ?? [player];
    const card = buildPlayerNerdCard(season, player, team, teammates);
    card.generatedAt = generatedAt;
    writeJson(playerPath(season, player.playerId), card);

    indexEntries.push({
      playerId: player.playerId,
      name: player.name,
      teamId: player.teamId,
      teamAbbrev: player.teamAbbrev,
      plateAppearances: player.plateAppearances,
      pitchesThrown: player.pitchesThrown,
    });
  }

  indexEntries.sort(
    (a, b) =>
      b.plateAppearances + b.pitchesThrown - (a.plateAppearances + a.pitchesThrown) ||
      a.name.localeCompare(b.name),
  );

  writeJson(indexPath(season), {
    season,
    generatedAt,
    players: indexEntries,
  } satisfies PlayerNerdIndex);
}

export function mergeAndWritePlayerNerdStore(
  season: number,
  delta: SeasonPlayerNerdCounters,
  teamCounters: SeasonNerdCounters,
): void {
  const existing = loadSeasonPlayerCounters(season);
  mergePlayerSeasonCounters(existing, delta);
  writePlayerNerdStore(season, existing, teamCounters);
}

/** List player IDs that have a stored card. */
export function listStoredPlayerNerdIds(season: number): number[] {
  const dir = playersDir(season);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => Number.parseInt(f.replace(".json", ""), 10))
    .filter((id) => Number.isFinite(id));
}
