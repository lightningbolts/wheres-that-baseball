import type { PlayerBipDetail, PlayerBipIndexEntry } from "@/lib/mlb/playerBip";
import type { PlayerNerdCard } from "@/lib/mlb/nerdStats/types";
import type { PlayerPitchMix } from "@/lib/mlb/playerPitching";
import type { PlayerPitchingSeasonLine } from "@/lib/mlb/playerBip";

const bipCache = new Map<string, PlayerBipDetail>();
const pitchBipCache = new Map<string, PlayerBipDetail>();
const pitchingCache = new Map<string, PlayerPitchingResponse>();
const nerdCache = new Map<string, PlayerNerdCard>();
const searchCache = new Map<string, PlayerBipIndexEntry[]>();

export interface PlayerPitchingResponse extends PlayerPitchingSeasonLine {
  pitchMix: PlayerPitchMix;
  nerdPitchesThrown: number;
  nerdStrikeouts: number;
  nerdHitsAllowed: number;
  nerdBallsInPlayAllowed: number;
}

function bipKey(season: number, playerId: number): string {
  return `${season}:${playerId}`;
}

function searchKey(season: number, q: string): string {
  return `${season}:${q.trim().toLowerCase()}`;
}

export function getCachedPlayerBip(season: number, playerId: number): PlayerBipDetail | null {
  return bipCache.get(bipKey(season, playerId)) ?? null;
}

export function setCachedPlayerBip(
  season: number,
  playerId: number,
  data: PlayerBipDetail,
): void {
  bipCache.set(bipKey(season, playerId), data);
}

export function getCachedPlayerPitchBip(
  season: number,
  playerId: number,
): PlayerBipDetail | null {
  return pitchBipCache.get(bipKey(season, playerId)) ?? null;
}

export function setCachedPlayerPitchBip(
  season: number,
  playerId: number,
  data: PlayerBipDetail,
): void {
  pitchBipCache.set(bipKey(season, playerId), data);
}

export function getCachedPlayerPitching(
  season: number,
  playerId: number,
): PlayerPitchingResponse | null {
  return pitchingCache.get(bipKey(season, playerId)) ?? null;
}

export function setCachedPlayerPitching(
  season: number,
  playerId: number,
  data: PlayerPitchingResponse,
): void {
  pitchingCache.set(bipKey(season, playerId), data);
}

export function getCachedPlayerNerd(season: number, playerId: number): PlayerNerdCard | null {
  return nerdCache.get(bipKey(season, playerId)) ?? null;
}

export function setCachedPlayerNerd(
  season: number,
  playerId: number,
  data: PlayerNerdCard,
): void {
  nerdCache.set(bipKey(season, playerId), data);
}

export function getCachedPlayerSearch(
  season: number,
  q: string,
): PlayerBipIndexEntry[] | null {
  return searchCache.get(searchKey(season, q)) ?? null;
}

export function setCachedPlayerSearch(
  season: number,
  q: string,
  players: PlayerBipIndexEntry[],
): void {
  searchCache.set(searchKey(season, q), players);
}
