import type { GameBoxScore } from "@/types/mlb-boxscore";
import type { PlayByPlayEntry } from "@/types/mlb-live";

export function battingTeamId(
  play: PlayByPlayEntry,
  awayTeamId: number,
  homeTeamId: number,
): number {
  return play.halfInning === "bottom" ? homeTeamId : awayTeamId;
}

export function fieldingTeamId(
  play: PlayByPlayEntry,
  awayTeamId: number,
  homeTeamId: number,
): number {
  return play.halfInning === "bottom" ? awayTeamId : homeTeamId;
}

export function runsScoredOnPlay(play: PlayByPlayEntry): { away: number; home: number } {
  const before = play.situationBefore;
  return {
    away: play.awayScore - before.awayScore,
    home: play.homeScore - before.homeScore,
  };
}

export function runsForBattingTeam(play: PlayByPlayEntry): number {
  const runs = runsScoredOnPlay(play);
  return play.halfInning === "bottom" ? runs.home : runs.away;
}

export function isBloopSingle(play: PlayByPlayEntry): boolean {
  if (play.event !== "Single") return false;
  const hit = play.detail.hit;
  if (hit && hit.launchSpeed > 0) {
    return (
      hit.launchAngle >= 20 &&
      hit.launchSpeed < 88 &&
      (hit.totalDistance === 0 || hit.totalDistance < 220)
    );
  }
  return /bloops?|flares?|drops? in/i.test(`${play.event} ${play.description}`);
}

export function isInfieldSingle(play: PlayByPlayEntry): boolean {
  if (play.event !== "Single") return false;
  const hit = play.detail.hit;
  if (hit && hit.totalDistance > 0 && hit.totalDistance < 150) return true;
  return /infield hit|bunt single/i.test(play.description);
}

export function isWalkOff(play: PlayByPlayEntry, plays: PlayByPlayEntry[]): boolean {
  if (play.halfInning !== "bottom" || !play.isScoringPlay) return false;
  if (play.homeScore <= play.awayScore || play.inning < 9) return false;
  const playIndex = plays.findIndex((entry) => entry.atBatIndex === play.atBatIndex);
  if (playIndex === -1) return false;
  for (let i = playIndex + 1; i < plays.length; i += 1) {
    if (plays[i]!.isAtBat) return false;
  }
  return true;
}

/** Winning bottom-of-9+ scoring play that puts the home team ahead (feed-safe). */
export function findWalkOffPlay(
  plays: PlayByPlayEntry[],
  finalHomeScore: number,
  finalAwayScore: number,
): PlayByPlayEntry | null {
  if (finalHomeScore <= finalAwayScore) return null;

  const candidates = plays.filter((play) => {
    if (play.halfInning !== "bottom" || play.inning < 9 || !play.isScoringPlay) return false;
    const before = play.situationBefore;
    return before.homeScore <= before.awayScore && play.homeScore > play.awayScore;
  });

  return candidates.at(-1) ?? null;
}

export function runnersLeftOnBases(before: PlayByPlayEntry["situationBefore"]): number {
  return (before.onFirst ? 1 : 0) + (before.onSecond ? 1 : 0) + (before.onThird ? 1 : 0);
}

export function extractPinchHitterName(description: string): string | null {
  const match = description.match(/Pinch-hitter\s+(.+?)\s+replaces/i);
  return match?.[1]?.trim() ?? null;
}

export function isTriplePlayOpportunity(play: PlayByPlayEntry): boolean {
  if (!play.isAtBat) return false;
  const before = play.situationBefore;
  if (before.outs !== 0) return false;
  const loaded = before.onFirst && before.onSecond;
  const basesLoaded = before.onFirst && before.onSecond && before.onThird;
  return loaded || basesLoaded;
}

export function isGidp(play: PlayByPlayEntry): boolean {
  return /grounded into dp/i.test(play.event);
}

export function isRallyKillerGidp(play: PlayByPlayEntry): boolean {
  if (!isGidp(play)) return false;
  return play.situationBefore.onSecond;
}

export function isTriplePlay(play: PlayByPlayEntry): boolean {
  return /triple play/i.test(`${play.event} ${play.description}`);
}

export function isStolenBase(play: PlayByPlayEntry): boolean {
  const text = `${play.event} ${play.description}`.toLowerCase();
  return /stolen base|\bsteals?\b/.test(text) && !/caught stealing/.test(text);
}

export function isCaughtStealing(play: PlayByPlayEntry): boolean {
  return /caught stealing/i.test(`${play.event} ${play.description}`);
}

export function isPickoff(play: PlayByPlayEntry): boolean {
  return /pick(?:s|ed)?\s*off/i.test(`${play.event} ${play.description}`);
}

export function isBalk(play: PlayByPlayEntry): boolean {
  return /balk/i.test(`${play.event} ${play.description}`);
}

export function isWildPitch(play: PlayByPlayEntry): boolean {
  return /wild pitch/i.test(`${play.event} ${play.description}`);
}

export function isPassedBall(play: PlayByPlayEntry): boolean {
  return /passed ball/i.test(`${play.event} ${play.description}`);
}

export function isPitcherHit(
  play: PlayByPlayEntry,
  pitcherBatterIds?: Set<number>,
): boolean {
  if (!["Single", "Double", "Triple", "Home Run"].includes(play.event)) return false;
  if (play.batterId != null && pitcherBatterIds?.has(play.batterId)) return true;

  const name = play.batterName.trim();
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^Pitcher\\s+${escaped}\\b`, "i").test(play.description)) return true;

  // Hits fielded by the pitcher are not pitcher hits.
  if (/\bto pitcher\b|\bby pitcher\b|\bpitcher to\b/i.test(play.description)) return false;

  return false;
}

export function buildPitcherBatterIds(boxScore: GameBoxScore | null): Set<number> {
  const ids = new Set<number>();
  if (!boxScore) return ids;

  for (const side of [boxScore.away, boxScore.home]) {
    for (const pitcher of side.pitchers ?? []) {
      ids.add(pitcher.playerId);
    }
    for (const batter of side.batters ?? []) {
      if (/\bP\b/.test(batter.positions)) {
        ids.add(batter.playerId);
      }
    }
  }

  return ids;
}

export function isBarrel(hit: { launchSpeed: number; launchAngle: number }): boolean {
  return hit.launchSpeed >= 98 && hit.launchAngle >= 8 && hit.launchAngle <= 50;
}

export function isNoDoubterHr(hit: { launchSpeed: number; launchAngle: number }): boolean {
  return hit.launchSpeed >= 105 && hit.launchAngle >= 20 && hit.launchAngle <= 35;
}

export function hasBattedBallData(play: PlayByPlayEntry): boolean {
  const hit = play.detail.hit;
  return Boolean(hit && hit.launchSpeed > 0);
}

export function teamWon(teamId: number, row: { away_team_id: number; home_team_id: number; away_score: number; home_score: number }): boolean {
  const isHome = teamId === row.home_team_id;
  const teamScore = isHome ? row.home_score : row.away_score;
  const oppScore = isHome ? row.away_score : row.home_score;
  return teamScore > oppScore;
}

export function teamLost(teamId: number, row: { away_team_id: number; home_team_id: number; away_score: number; home_score: number }): boolean {
  const isHome = teamId === row.home_team_id;
  const teamScore = isHome ? row.home_score : row.away_score;
  const oppScore = isHome ? row.away_score : row.home_score;
  return teamScore < oppScore;
}

export function teamRuns(teamId: number, row: { away_team_id: number; home_team_id: number; away_score: number; home_score: number }): number {
  return teamId === row.home_team_id ? row.home_score : row.away_score;
}
