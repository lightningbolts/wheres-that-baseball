import type { BatterBoxLine, GameBoxScore, PitcherBoxLine } from "@/types/mlb-boxscore";

function defenseTeam(boxScore: GameBoxScore, offenseTeamId: number | null) {
  if (offenseTeamId == null) return null;
  if (offenseTeamId === boxScore.home.teamId) return boxScore.away;
  if (offenseTeamId === boxScore.away.teamId) return boxScore.home;
  return null;
}

function offenseTeam(boxScore: GameBoxScore, offenseTeamId: number | null) {
  if (offenseTeamId == null) return null;
  if (offenseTeamId === boxScore.home.teamId) return boxScore.home;
  if (offenseTeamId === boxScore.away.teamId) return boxScore.away;
  return null;
}

export function findBatterBoxLine(
  boxScore: GameBoxScore | null | undefined,
  playerId: number | null | undefined,
  offenseTeamId: number | null | undefined,
): BatterBoxLine | null {
  if (!boxScore || !playerId) return null;
  const team = offenseTeam(boxScore, offenseTeamId ?? null);
  return team?.batters.find((line) => line.playerId === playerId) ?? null;
}

export function findPitcherBoxLine(
  boxScore: GameBoxScore | null | undefined,
  playerId: number | null | undefined,
  offenseTeamId: number | null | undefined,
): PitcherBoxLine | null {
  if (!boxScore || !playerId) return null;
  const team = defenseTeam(boxScore, offenseTeamId ?? null);
  if (!team) return null;
  return team.pitchers.find((line) => line.playerId === playerId) ?? team.pitchers.at(-1) ?? null;
}

export function formatBatterGameLine(line: BatterBoxLine | null): string | null {
  if (!line) return null;
  const game = `${line.hits}-${line.atBats}`;
  const season = line.seasonAvg && line.seasonAvg !== ".000" ? line.seasonAvg : null;
  return season ? `${game}, ${season} AVG` : game;
}

export function formatPitcherGameLine(line: PitcherBoxLine | null): string | null {
  if (!line) return null;
  const ip = line.inningsPitched || "0.0";
  const era = line.seasonEra && line.seasonEra !== "—" ? line.seasonEra : null;
  return era ? `${ip} IP, ${era} ERA` : `${ip} IP`;
}

/**
 * Prefer live matchup stand for the current PA; fall back to box-score batSide.
 * Returns `L` / `R`, or null when unknown.
 */
export function resolveBatSide(
  liveBatSide: string | null | undefined,
  boxScore: GameBoxScore | null | undefined,
  batterId: number | null | undefined,
  offenseTeamId: number | null | undefined,
): "L" | "R" | null {
  const live = liveBatSide?.trim().toUpperCase();
  if (live === "L" || live === "R") return live;

  const fromBox = findBatterBoxLine(boxScore, batterId, offenseTeamId)?.batSide
    ?.trim()
    .toUpperCase();
  if (fromBox === "L" || fromBox === "R") return fromBox;
  // Switch hitters without a live stand — Gameday defaults to the RHB box.
  if (fromBox === "S") return "R";
  return null;
}
