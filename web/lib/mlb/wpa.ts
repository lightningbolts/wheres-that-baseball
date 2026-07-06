import { homeWinProbability } from "@/lib/mlb/winExpectancy";
import type { GameSituation, PlayByPlayEntry } from "@/types/mlb-live";

function situationToInput(
  play: Pick<PlayByPlayEntry, "inning" | "halfInning">,
  situation: GameSituation,
): Parameters<typeof homeWinProbability>[0] {
  return {
    inning: play.inning,
    halfInning: play.halfInning,
    outs: situation.outs,
    onFirst: situation.onFirst,
    onSecond: situation.onSecond,
    onThird: situation.onThird,
    awayScore: situation.awayScore,
    homeScore: situation.homeScore,
  };
}

function isWalkOffSituation(play: PlayByPlayEntry, after: GameSituation): boolean {
  if (!play.halfInning.toLowerCase().startsWith("bot")) return false;
  if (play.inning < 9) return false;
  return after.homeScore > after.awayScore && play.isScoringPlay;
}

function clampHomeWinProbability(
  play: PlayByPlayEntry,
  after: GameSituation,
  probability: number,
): number {
  if (isWalkOffSituation(play, after)) return 1;
  return Math.max(0, Math.min(1, probability));
}

function battingTeamWpa(halfInning: string, homeBefore: number, homeAfter: number): number {
  const homeDelta = homeAfter - homeBefore;
  return halfInning.toLowerCase().startsWith("bot") ? homeDelta : -homeDelta;
}

/** Attach home win probability and WPA to each plate appearance. */
export function annotatePlayByPlayWithWpa(plays: PlayByPlayEntry[]): PlayByPlayEntry[] {
  return plays.map((play) => {
    if (play.isAtBat === false) return play;

    const before = play.situationBefore;
    const after: GameSituation = {
      awayScore: play.awayScore,
      homeScore: play.homeScore,
      outs: play.outs,
      bases: play.bases,
      onFirst: play.onFirst,
      onSecond: play.onSecond,
      onThird: play.onThird,
    };

    const homeWinProbBefore = homeWinProbability(situationToInput(play, before));
    const homeWinProbAfter = clampHomeWinProbability(
      play,
      after,
      homeWinProbability(situationToInput(play, after)),
    );
    const wpa = battingTeamWpa(play.halfInning, homeWinProbBefore, homeWinProbAfter);

    return {
      ...play,
      homeWinProbBefore,
      homeWinProbAfter,
      wpa,
      detail: {
        ...play.detail,
        homeWinProbBefore,
        homeWinProbAfter,
        wpa,
      },
    };
  });
}

/** Format WPA for display (e.g. "+12.3%" or "-3.1%"). */
export function formatWpa(wpa: number | undefined | null): string | null {
  if (wpa == null || !Number.isFinite(wpa)) return null;
  const pct = wpa * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}
