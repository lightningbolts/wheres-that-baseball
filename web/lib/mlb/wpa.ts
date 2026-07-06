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

/** Win probability for the team at bat (home WP in the bottom half). */
export function battingTeamWinProbability(
  halfInning: string,
  homeWinProb: number | undefined | null,
): number | null {
  if (homeWinProb == null || !Number.isFinite(homeWinProb)) return null;
  return halfInning.toLowerCase().startsWith("bot") ? homeWinProb : 1 - homeWinProb;
}

/** Format win probability for display (e.g. "45%"). */
export function formatWinProbability(probability: number | undefined | null): string | null {
  if (probability == null || !Number.isFinite(probability)) return null;
  return `${Math.round(probability * 100)}%`;
}

/** Format win probability on a 0–1 scale (e.g. "0.450"). */
export function formatWinProbabilityDecimal(probability: number | undefined | null): string | null {
  if (probability == null || !Number.isFinite(probability)) return null;
  return probability.toFixed(3);
}

/** Percent with decimal, e.g. "45% (0.450)". */
export function formatWinProbabilityWithDecimal(
  probability: number | undefined | null,
): string | null {
  const pct = formatWinProbability(probability);
  const dec = formatWinProbabilityDecimal(probability);
  if (!pct || !dec) return null;
  return `${pct} (${dec})`;
}

/** Format WPA for display (e.g. "+12.3%" or "-3.1%"). */
export function formatWpa(wpa: number | undefined | null): string | null {
  if (wpa == null || !Number.isFinite(wpa)) return null;
  const pct = wpa * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/** Batting-team WP before/after with WPA delta (e.g. "32% (0.320) → 45% (0.450) · +13.0% WPA"). */
export function formatPlayWinProbabilityLine(
  play: Pick<PlayByPlayEntry, "halfInning" | "homeWinProbBefore" | "homeWinProbAfter" | "wpa">,
): string | null {
  const wpBefore = formatWinProbabilityWithDecimal(
    battingTeamWinProbability(play.halfInning, play.homeWinProbBefore),
  );
  const wpAfter = formatWinProbabilityWithDecimal(
    battingTeamWinProbability(play.halfInning, play.homeWinProbAfter),
  );
  const wpaLabel = formatWpa(play.wpa);

  const wpLabel =
    wpBefore && wpAfter
      ? `${wpBefore} → ${wpAfter}`
      : wpAfter
        ? `${wpAfter} WP`
        : wpBefore;

  if (wpLabel && wpaLabel) return `${wpLabel} · ${wpaLabel} WPA`;
  if (wpaLabel) return `${wpaLabel} WPA`;
  return wpLabel;
}
