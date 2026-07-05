export const ABS_CHALLENGES_PER_GAME = 2;
export const REGULATION_INNINGS = 9;

export interface AbsChallengePlay {
  result?: { description?: string };
  about?: { halfInning?: string };
  matchup?: {
    batter?: { fullName?: string };
    pitcher?: { fullName?: string };
  };
  reviewDetails?: {
    inProgress?: boolean;
    isOverturned?: boolean;
    reviewType?: string;
    challengeTeamId?: number;
  };
  playEvents?: Array<{
    isPitch?: boolean;
    details?: { description?: string };
    reviewDetails?: {
      inProgress?: boolean;
      isOverturned?: boolean;
      reviewType?: string;
      challengeTeamId?: number;
    };
  }>;
}

export interface AbsChallengeCountOptions {
  awayTeamId?: number;
  homeTeamId?: number;
  awayTeamName?: string;
  homeTeamName?: string;
  awayAbbrev?: string;
  homeAbbrev?: string;
}

const ABS_CHALLENGE_DESCRIPTION =
  /challenged\s*\(\s*pitch result\s*\).*call on the field was (?:confirmed|overturned|upheld)/i;

/** Manager reviews that are not ABS pitch-call challenges (HBP, fair/foul, etc.). */
const NON_ABS_CHALLENGE_DESCRIPTION =
  /\bchallenged\s*\(\s*(?:hit by pitch|checked swing|catch(?:er's)? interference|fair.?foul|home run)\b/i;

const ABS_PITCH_CALL_DESCRIPTION = /^ABS (?:confirmed|overturned)/i;

const PITCH_CALL_REVIEW_DESCRIPTION =
  /^(?:called strike|ball|foul|swinging strike|missed bunt|ABS (?:confirmed|overturned))/i;

export interface AbsChallengeFeedData {
  absChallenges?: {
    hasChallenges?: boolean;
    away?: { usedSuccessful?: number; usedFailed?: number; remaining?: number };
    home?: { usedSuccessful?: number; usedFailed?: number; remaining?: number };
  };
  review?: {
    hasChallenges?: boolean;
    away?: { used?: number; remaining?: number };
    home?: { used?: number; remaining?: number };
  };
  teams: {
    away: { id?: number; name: string; abbreviation?: string };
    home: { id?: number; name: string; abbreviation?: string };
  };
}

function isAbsChallengeDescription(description: string): boolean {
  if (NON_ABS_CHALLENGE_DESCRIPTION.test(description)) return false;
  return ABS_CHALLENGE_DESCRIPTION.test(description);
}

function isNonAbsChallengeDescription(description: string): boolean {
  return NON_ABS_CHALLENGE_DESCRIPTION.test(description);
}

/** @deprecated Half-inning does not identify the challenging team. */
export function absDefendingSide(halfInning: string | undefined): "away" | "home" | null {
  const half = halfInning?.toLowerCase();
  if (half === "top") return "home";
  if (half === "bottom") return "away";
  return null;
}

function teamSideFromId(
  teamId: number | undefined,
  awayTeamId: number | undefined,
  homeTeamId: number | undefined,
): "away" | "home" | null {
  if (teamId == null || awayTeamId == null || homeTeamId == null) return null;
  if (teamId === awayTeamId) return "away";
  if (teamId === homeTeamId) return "home";
  return null;
}

function battingSide(halfInning: string | undefined): "away" | "home" | null {
  const half = halfInning?.toLowerCase();
  if (half === "top") return "away";
  if (half === "bottom") return "home";
  return null;
}

function pitchingSide(halfInning: string | undefined): "away" | "home" | null {
  const batting = battingSide(halfInning);
  if (batting === "away") return "home";
  if (batting === "home") return "away";
  return null;
}

function buildPlayerTeamMap(
  allPlays: AbsChallengePlay[],
): Map<string, "away" | "home"> {
  const map = new Map<string, "away" | "home">();

  for (const play of allPlays) {
    const batter = play.matchup?.batter?.fullName;
    const pitcher = play.matchup?.pitcher?.fullName;
    const batterSide = battingSide(play.about?.halfInning);
    const pitcherSide = pitchingSide(play.about?.halfInning);

    if (batter && batterSide) {
      map.set(batter.toLowerCase(), batterSide);
    }
    if (pitcher && pitcherSide) {
      map.set(pitcher.toLowerCase(), pitcherSide);
    }
  }

  return map;
}

function teamSideFromChallengeDescription(
  description: string,
  options?: AbsChallengeCountOptions,
): "away" | "home" | null {
  if (!options) return null;

  const match = /^(.+?) challenged\b/i.exec(description);
  if (!match) return null;

  const challenger = match[1].trim().toLowerCase();
  const awayLabels = [options.awayAbbrev, options.awayTeamName]
    .filter(Boolean)
    .map((value) => value!.toLowerCase());
  const homeLabels = [options.homeAbbrev, options.homeTeamName]
    .filter(Boolean)
    .map((value) => value!.toLowerCase());

  if (awayLabels.some((label) => challenger.includes(label) || label.includes(challenger))) {
    return "away";
  }
  if (homeLabels.some((label) => challenger.includes(label) || label.includes(challenger))) {
    return "home";
  }

  return null;
}

function teamSideFromChallengerName(
  description: string,
  playerTeams: Map<string, "away" | "home">,
): "away" | "home" | null {
  const match = /^(.+?) challenged\b/i.exec(description);
  if (!match) return null;
  return playerTeams.get(match[1].trim().toLowerCase()) ?? null;
}

function resolveAbsChallengeSide(
  play: AbsChallengePlay,
  options: AbsChallengeCountOptions | undefined,
  playerTeams: Map<string, "away" | "home">,
  review?: NonNullable<AbsChallengePlay["playEvents"]>[number]["reviewDetails"],
): "away" | "home" | null {
  const fromTeamId = teamSideFromId(
    review?.challengeTeamId,
    options?.awayTeamId,
    options?.homeTeamId,
  );
  if (fromTeamId) return fromTeamId;

  const description = play.result?.description ?? "";
  return (
    teamSideFromChallengeDescription(description, options) ??
    teamSideFromChallengerName(description, playerTeams)
  );
}

function isFailedAbsChallengeDescription(description: string): boolean {
  return isAbsChallengeDescription(description) && !/call on the field was overturned/i.test(description);
}

function isAbsPlayReview(
  play: AbsChallengePlay,
  review: NonNullable<AbsChallengePlay["reviewDetails"]>,
): boolean {
  if (review.inProgress || review.isOverturned) return false;

  const description = play.result?.description ?? "";
  if (isNonAbsChallengeDescription(description)) return false;
  if (review.reviewType === "ABS") return true;
  return review.reviewType === "MJ" && isAbsChallengeDescription(description);
}

function isCalledStrikeDescription(description: string | undefined): boolean {
  return /called strike/i.test(description ?? "");
}

function isPitchCallReviewDescription(description: string | undefined): boolean {
  return PITCH_CALL_REVIEW_DESCRIPTION.test(description ?? "");
}

function countOptionsFromFeed(gameData: AbsChallengeFeedData): AbsChallengeCountOptions {
  const teams = gameData.teams;
  return {
    awayTeamId: teams.away.id,
    homeTeamId: teams.home.id,
    awayTeamName: teams.away.name,
    homeTeamName: teams.home.name,
    awayAbbrev: teams.away.abbreviation,
    homeAbbrev: teams.home.abbreviation,
  };
}

function countFailedAbsChallengesOnPlay(
  play: AbsChallengePlay,
  options: AbsChallengeCountOptions | undefined,
  playerTeams: Map<string, "away" | "home">,
): { away: number; home: number } {
  const used = { away: 0, home: 0 };
  const description = play.result?.description ?? "";
  if (isNonAbsChallengeDescription(description)) return used;

  const events = play.playEvents ?? [];
  const failedPitchReviews: Array<{ side: "away" | "home"; pitchIndex: number }> = [];

  for (let pitchIndex = 0; pitchIndex < events.length; pitchIndex += 1) {
    const event = events[pitchIndex]!;
    const review = event.reviewDetails;
    if (!review || review.inProgress || review.isOverturned) continue;
    if (!isAbsPitchReviewEvent(play, event)) continue;

    const side = resolveAbsChallengeSide(play, options, playerTeams, review);
    if (!side) continue;

    failedPitchReviews.push({ side, pitchIndex });
    used[side] += 1;
  }

  if (failedPitchReviews.length > 0) {
    const firstReviewIndex = Math.min(...failedPitchReviews.map((review) => review.pitchIndex));
    const side = failedPitchReviews[0]!.side;

    for (let pitchIndex = 0; pitchIndex < firstReviewIndex; pitchIndex += 1) {
      const event = events[pitchIndex];
      if (event?.isPitch === false) continue;
      if (!isCalledStrikeDescription(event?.details?.description)) continue;
      used[side] += 1;
    }

    return used;
  }

  const playReview = play.reviewDetails;
  if (playReview && isAbsPlayReview(play, playReview)) {
    const side = resolveAbsChallengeSide(play, options, playerTeams, playReview);
    if (side) used[side] += 1;
    return used;
  }

  if (isFailedAbsChallengeDescription(description)) {
    const side = resolveAbsChallengeSide(play, options, playerTeams);
    if (side) used[side] += 1;
  }

  return used;
}

function isAbsPitchReviewEvent(
  play: AbsChallengePlay,
  event: NonNullable<AbsChallengePlay["playEvents"]>[number],
): boolean {
  if (event.isPitch === false) return false;

  const description = play.result?.description ?? "";
  if (isNonAbsChallengeDescription(description)) return false;

  const review = event.reviewDetails;
  if (!review || review.inProgress) return false;

  if (review.reviewType === "ABS") return true;

  const callDescription = event.details?.description ?? "";
  if (ABS_PITCH_CALL_DESCRIPTION.test(callDescription)) return true;

  if (review.reviewType === "MJ" && isAbsChallengeDescription(description)) return true;

  if (
    (review.reviewType === "MJ" || review.reviewType === "ABS") &&
    review.challengeTeamId != null &&
    isPitchCallReviewDescription(callDescription)
  ) {
    return true;
  }

  return false;
}

/** Count completed ABS challenges from play-by-play (API review.used is often stale). */
export function countAbsChallengesUsedFromPlays(
  allPlays: AbsChallengePlay[] | undefined,
  options?: AbsChallengeCountOptions,
): { away: number; home: number } {
  const used = { away: 0, home: 0 };
  if (!allPlays?.length) return used;

  const playerTeams = buildPlayerTeamMap(allPlays);

  for (const play of allPlays) {
    const playUsed = countFailedAbsChallengesOnPlay(play, options, playerTeams);
    used.away += playUsed.away;
    used.home += playUsed.home;
  }

  return used;
}

export function resolveAbsChallengesUsed(
  allPlays: AbsChallengePlay[] | undefined,
  awayTeamId: number | undefined,
  homeTeamId: number | undefined,
  reviewAwayUsed?: number,
  reviewHomeUsed?: number,
  options?: AbsChallengeCountOptions & {
    hasChallenges?: boolean;
    absChallenges?: AbsChallengeFeedData["absChallenges"];
  },
): { away: number; home: number } {
  const mergedOptions: AbsChallengeCountOptions = {
    ...options,
    awayTeamId: options?.awayTeamId ?? awayTeamId,
    homeTeamId: options?.homeTeamId ?? homeTeamId,
  };

  const absChallenges = options?.absChallenges;
  if (absChallenges?.hasChallenges) {
    const awayFailed = absChallenges.away?.usedFailed;
    const homeFailed = absChallenges.home?.usedFailed;
    if (awayFailed != null && homeFailed != null) {
      return { away: awayFailed, home: homeFailed };
    }
  }

  const fromPlays = allPlays?.length
    ? countAbsChallengesUsedFromPlays(allPlays, mergedOptions)
    : { away: 0, home: 0 };

  if (reviewAwayUsed == null || reviewHomeUsed == null) {
    return fromPlays;
  }

  const fromReview = { away: reviewAwayUsed, home: reviewHomeUsed };
  const playTotal = fromPlays.away + fromPlays.home;
  const reviewTotal = reviewAwayUsed + reviewHomeUsed;

  if (playTotal === 0 && reviewTotal > 0) {
    return fromReview;
  }

  if (options?.hasChallenges && playTotal !== reviewTotal) {
    return fromReview;
  }

  return fromPlays;
}

/** Resolve used counts from feed metadata, preferring absChallenges.usedFailed. */
export function resolveAbsChallengesUsedFromFeed(
  gameData: AbsChallengeFeedData,
  allPlays: AbsChallengePlay[] | undefined,
): { away: number; home: number } {
  const options = countOptionsFromFeed(gameData);
  return resolveAbsChallengesUsed(
    allPlays,
    options.awayTeamId,
    options.homeTeamId,
    gameData.review?.away?.used,
    gameData.review?.home?.used,
    {
      ...options,
      hasChallenges: gameData.review?.hasChallenges,
      absChallenges: gameData.absChallenges,
    },
  );
}

/** Resolve remaining ABS challenges from feed metadata and play-by-play fallback. */
export function resolveAbsChallengesRemaining(
  gameData: AbsChallengeFeedData,
  allPlays: AbsChallengePlay[] | undefined,
  inning: number,
): { away: number; home: number } {
  const absChallenges = gameData.absChallenges;
  if (absChallenges?.hasChallenges) {
    const awayRemaining = absChallenges.away?.remaining;
    const homeRemaining = absChallenges.home?.remaining;
    if (awayRemaining != null && homeRemaining != null) {
      return { away: awayRemaining, home: homeRemaining };
    }

    const awayFailed = absChallenges.away?.usedFailed;
    const homeFailed = absChallenges.home?.usedFailed;
    if (awayFailed != null && homeFailed != null) {
      return {
        away: computeAbsChallengesRemaining(awayFailed, inning),
        home: computeAbsChallengesRemaining(homeFailed, inning),
      };
    }
  }

  const used = resolveAbsChallengesUsedFromFeed(gameData, allPlays);
  return {
    away: computeAbsChallengesRemaining(used.away, inning),
    home: computeAbsChallengesRemaining(used.home, inning),
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
