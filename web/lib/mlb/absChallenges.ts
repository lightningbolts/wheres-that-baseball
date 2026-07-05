export const ABS_CHALLENGES_PER_GAME = 2;
export const REGULATION_INNINGS = 9;

/** MLB feed codes pitch-call ABS reviews as MJ or ABS. */
export const ABS_REVIEW_TYPES = new Set(["MJ", "ABS"]);

export interface AbsChallengePlay {
  result?: { description?: string };
  about?: { halfInning?: string };
  playEvents?: Array<{
    isPitch?: boolean;
    reviewDetails?: {
      inProgress?: boolean;
      reviewType?: string;
      challengeTeamId?: number;
    };
  }>;
}

const ABS_CHALLENGE_DESCRIPTION =
  /challenged\s*\(\s*pitch result\s*\).*call on the field was (?:confirmed|overturned)/i;

/** Manager reviews that are not ABS pitch-call challenges (HBP, fair/foul, etc.). */
const NON_ABS_CHALLENGE_DESCRIPTION =
  /\bchallenged\s*\(\s*(?:hit by pitch|checked swing|catch(?:er's)? interference|fair.?foul|home run)\b/i;

function isAbsChallengeDescription(description: string): boolean {
  if (NON_ABS_CHALLENGE_DESCRIPTION.test(description)) return false;
  return ABS_CHALLENGE_DESCRIPTION.test(description);
}

function isNonAbsChallengeDescription(description: string): boolean {
  return NON_ABS_CHALLENGE_DESCRIPTION.test(description);
}

/** Defensive team for ABS pitch challenges (only defense can challenge). */
export function absDefendingSide(halfInning: string | undefined): "away" | "home" | null {
  const half = halfInning?.toLowerCase();
  if (half === "top") return "home";
  if (half === "bottom") return "away";
  return null;
}

function teamSideFromId(
  teamId: number | undefined,
  awayTeamId: number,
  homeTeamId: number,
): "away" | "home" | null {
  if (teamId == null) return null;
  if (teamId === awayTeamId) return "away";
  if (teamId === homeTeamId) return "home";
  return null;
}

function resolveAbsChallengeSide(
  play: AbsChallengePlay,
  review: NonNullable<AbsChallengePlay["playEvents"]>[number]["reviewDetails"],
  awayTeamId: number,
  homeTeamId: number,
): "away" | "home" | null {
  const fromChallengeTeam = teamSideFromId(review?.challengeTeamId, awayTeamId, homeTeamId);
  if (fromChallengeTeam) return fromChallengeTeam;
  return absDefendingSide(play.about?.halfInning);
}

function isAbsPitchReviewEvent(
  play: AbsChallengePlay,
  event: NonNullable<AbsChallengePlay["playEvents"]>[number],
): boolean {
  if (event.isPitch === false) return false;

  const description = play.result?.description ?? "";
  if (isNonAbsChallengeDescription(description)) return false;

  const review = event.reviewDetails;
  if (!review) return false;
  if (review.reviewType && !ABS_REVIEW_TYPES.has(review.reviewType)) return false;
  if (review.reviewType === "ABS") return true;
  if (review.reviewType === "MJ") return event.isPitch !== false;
  return false;
}

/** Count completed ABS challenges from play-by-play (API review.used is often stale). */
export function countAbsChallengesUsedFromPlays(
  allPlays: AbsChallengePlay[] | undefined,
  awayTeamId: number,
  homeTeamId: number,
): { away: number; home: number } {
  const used = { away: 0, home: 0 };
  if (!allPlays?.length) return used;

  for (const play of allPlays) {
    const description = play.result?.description ?? "";
    if (isNonAbsChallengeDescription(description)) continue;

    let counted = false;

    for (const event of play.playEvents ?? []) {
      const review = event.reviewDetails;
      if (!review || review.inProgress) continue;
      if (!isAbsPitchReviewEvent(play, event)) continue;

      const side = resolveAbsChallengeSide(play, review, awayTeamId, homeTeamId);
      if (!side) continue;

      used[side] += 1;
      counted = true;
      break;
    }

    if (!counted && isAbsChallengeDescription(description)) {
      const side = absDefendingSide(play.about?.halfInning);
      if (side) used[side] += 1;
    }
  }

  return used;
}

export function resolveAbsChallengesUsed(
  allPlays: AbsChallengePlay[] | undefined,
  awayTeamId: number | undefined,
  homeTeamId: number | undefined,
  reviewAwayUsed?: number,
  reviewHomeUsed?: number,
): { away: number; home: number } {
  if (allPlays?.length && awayTeamId != null && homeTeamId != null) {
    return countAbsChallengesUsedFromPlays(allPlays, awayTeamId, homeTeamId);
  }

  return {
    away: reviewAwayUsed ?? 0,
    home: reviewHomeUsed ?? 0,
  };
}

/** Remaining ABS challenges: 2 to start, +1 per extra inning, capped at 2. */
export function computeAbsChallengesRemaining(used: number, inning: number): number {
  const safeUsed = Math.max(0, used);
  const safeInning = Math.max(1, inning);
  const extraInnings = Math.max(0, safeInning - REGULATION_INNINGS);
  return Math.min(
    ABS_CHALLENGES_PER_GAME,
    Math.max(0, ABS_CHALLENGES_PER_GAME - safeUsed + extraInnings),
  );
}
