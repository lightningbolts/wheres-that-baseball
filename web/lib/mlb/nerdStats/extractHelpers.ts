import { PLATE_HALF_WIDTH_FT } from "@/lib/mlb/strikeZoneMath";
import type { PlayByPlayEntry, PlayPitch } from "@/types/mlb-live";

export function reachedFullCount(pitches: PlayPitch[]): boolean {
  return pitches.some((pitch) => pitch.balls === 3 && pitch.strikes === 2);
}

/** First tracked pitch of a plate appearance (skips non-pitch feed events). */
export function firstPitchOfAtBat(pitches: PlayPitch[]): PlayPitch | null {
  for (const pitch of pitches) {
    if (pitch.isPitch) return pitch;
  }
  return null;
}

/**
 * Meatball = heart of the zone: middle ~2/3 of plate width, middle third of
 * the batter's strike zone. Easy-to-hit pitches down the pipe.
 */
export function isMeatball(
  pitch: Pick<
    PlayPitch,
    "plateX" | "plateZ" | "strikeZoneTop" | "strikeZoneBottom" | "hasPlateLocation"
  >,
): boolean {
  if (pitch.hasPlateLocation === false) return false;
  if (!Number.isFinite(pitch.plateX) || !Number.isFinite(pitch.plateZ)) return false;
  const height = pitch.strikeZoneTop - pitch.strikeZoneBottom;
  if (!(height > 0)) return false;

  const halfHeart = PLATE_HALF_WIDTH_FT * (2 / 3);
  const zLo = pitch.strikeZoneBottom + height / 3;
  const zHi = pitch.strikeZoneTop - height / 3;
  return Math.abs(pitch.plateX) <= halfHeart && pitch.plateZ >= zLo && pitch.plateZ <= zHi;
}

/** Statcast hard-hit threshold. */
export function isHardHit(hit: { launchSpeed: number }): boolean {
  return hit.launchSpeed >= 95;
}

/** Statcast sweet-spot launch angles (8°–32°). */
export function isSweetSpot(hit: { launchAngle: number }): boolean {
  return hit.launchAngle >= 8 && hit.launchAngle <= 32;
}

/**
 * Statcast launch_speed_angle ("How was that hit?"):
 * 1 Weak · 2 Topped · 3 Under · 4 Flare/Burner · 5 Solid · 6 Barrel
 * Formula from Tangotiger / Statcast lab.
 */
export function launchSpeedAngle(hit: {
  launchSpeed: number;
  launchAngle: number;
}): 1 | 2 | 3 | 4 | 5 | 6 | null {
  const speed = hit.launchSpeed;
  const angle = hit.launchAngle;
  if (!Number.isFinite(speed) || !Number.isFinite(angle) || speed <= 0) return null;

  if (
    speed * 1.5 - angle >= 117 &&
    speed + angle >= 124 &&
    speed >= 98 &&
    angle >= 4 &&
    angle <= 50
  ) {
    return 6;
  }

  if (
    speed * 1.5 - angle >= 111 &&
    speed + angle >= 119 &&
    speed >= 95 &&
    angle >= 0 &&
    angle <= 52
  ) {
    return 5;
  }

  if (speed <= 59) return 1;

  if (
    (speed * 2 - angle >= 87 &&
      angle <= 41 &&
      speed * 2 + angle <= 175 &&
      speed + angle * 1.3 >= 89 &&
      speed >= 59 &&
      speed <= 72) ||
    (speed + angle * 1.3 <= 112 &&
      speed + angle * 1.55 >= 92 &&
      speed >= 72 &&
      speed <= 86) ||
    (angle <= 20 && speed + angle * 2.4 >= 98 && speed >= 86 && speed <= 95) ||
    (speed - angle >= 76 && speed + angle * 2.4 >= 98 && speed >= 95 && angle <= 30)
  ) {
    return 4;
  }

  if (speed + angle * 2 >= 116) return 3;
  if (speed + angle * 2 <= 116) return 2;
  return null;
}

export function inPlayPitch(pitches: PlayPitch[]): PlayPitch | null {
  for (let i = pitches.length - 1; i >= 0; i -= 1) {
    if (pitches[i]?.isInPlay) return pitches[i]!;
  }
  return pitches.at(-1) ?? null;
}

export function hitTotalBases(event: string): number {
  switch (event) {
    case "Single":
      return 1;
    case "Double":
      return 2;
    case "Triple":
      return 3;
    case "Home Run":
      return 4;
    default:
      return 0;
  }
}

const HIT_EVENTS = new Set(["Single", "Double", "Triple", "Home Run"]);

export function isHitEvent(event: string): boolean {
  return HIT_EVENTS.has(event);
}

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
  if (!before) {
    return { away: 0, home: 0 };
  }
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

export function errorInPlay(play: PlayByPlayEntry): boolean {
  return /error/i.test(`${play.event} ${play.description}`);
}

export function isFieldingError(play: PlayByPlayEntry): boolean {
  return play.event === "Field Error" || /fielding error/i.test(play.description);
}

export function countThrowingErrors(play: PlayByPlayEntry): number {
  const matches = play.description.match(/throwing error/gi);
  return matches?.length ?? 0;
}

export function batterReachedOnError(play: PlayByPlayEntry): boolean {
  if (play.event === "Field Error") return true;
  return /reaches on (?:a )?(?:fielding )?error/i.test(play.description);
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
