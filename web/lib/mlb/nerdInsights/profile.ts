import type { PlayerNerdCard, TeamNerdCard } from "@/lib/mlb/nerdStats/types";
import type {
  PlayerNerdHighlight,
  PlayerNerdProfile,
  TeamNerdProfile,
  TeamNerdStatEntry,
} from "@/lib/mlb/nerdInsights/types";
import { MLB_TEAMS } from "@/lib/mlb/teams";

/** Stats worth calling out for individual batters in the live feed. */
export const PLAYER_BATTER_INSIGHT_STAT_IDS = new Set([
  "barrel-rate",
  "hard-hit-rate",
  "sweet-spot-rate",
  "moonshot-hrs",
  "no-doubter-hr-rate",
  "hr-per-pa",
  "bloop-singles",
  "infield-singles",
  "double-plays-hit-into",
  "rally-killer-gidp",
  "golden-sombrero",
  "hit-by-pitch",
  "hbp-rate",
  "foul-ball-factory",
  "strikeout-rate",
  "walk-rate",
  "meatballs-punished",
  "meatball-punish-rate",
  "weak-contact-rate",
  "chop-rate",
  "popup-rate",
  "steal-attempt-rate",
  "steal-success-rate",
  "caught-stealing",
  "pinch-hit-hits",
  "pinch-hit-success-rate",
  "left-on-base",
  "three-true-outcomes-rate",
  "extra-base-rate",
]);

/** Stats worth calling out for individual pitchers in the live feed. */
export const PLAYER_PITCHER_INSIGHT_STAT_IDS = new Set([
  "gidp-induced",
  "nobletigers-induced",
  "meatballs-thrown",
  "meatball-rate",
  "called-strike-rate",
  "swinging-strike-rate",
  "first-pitch-strike-rate-pitching",
  "first-pitch-whiff-rate-pitching",
  "balls-in-play-allowed-rate",
  "hits-allowed",
  "pitching-strikeouts",
  "multi-hr-games-allowed",
  "almost-immaculate-inning-victim",
  "no-hitter-bid-ruined",
]);

const MIN_TEAMMATES_FOR_RANK = 3;
const MIN_SHARE_OF_TEAM = 0.3;

function isNotablePlayerContribution(
  contribution: PlayerNerdCard["contributions"][number],
  allowedStats: Set<string>,
): boolean {
  if (!allowedStats.has(contribution.statId)) return false;
  if (contribution.teamRank == null || contribution.teamRankedCount == null) return false;
  if (contribution.teamRankedCount < MIN_TEAMMATES_FOR_RANK) return false;
  if (contribution.playerDisplay === "—" || contribution.playerDisplay === "0") return false;

  const isTeamLeader = contribution.teamRank === 1;
  const ownsLargeShare =
    contribution.shareOfTeam != null &&
    contribution.shareOfTeam >= MIN_SHARE_OF_TEAM &&
    contribution.teamRank <= 3;

  if (!isTeamLeader && !ownsLargeShare) return false;

  if (
    contribution.playerActions != null &&
    contribution.playerActions <= 0 &&
    (contribution.playerValue == null || contribution.playerValue <= 0)
  ) {
    return false;
  }

  return true;
}

function toHighlight(
  contribution: PlayerNerdCard["contributions"][number],
): PlayerNerdHighlight {
  return {
    statId: contribution.statId,
    title: contribution.title,
    playerDisplay: contribution.playerDisplay,
    teamRank: contribution.teamRank!,
    teamRankedCount: contribution.teamRankedCount!,
    shareOfTeam: contribution.shareOfTeam,
    playerActions: contribution.playerActions,
  };
}

export function profileFromPlayerCard(card: PlayerNerdCard): PlayerNerdProfile {
  const allowed = new Set([
    ...PLAYER_BATTER_INSIGHT_STAT_IDS,
    ...PLAYER_PITCHER_INSIGHT_STAT_IDS,
  ]);

  const highlights = card.contributions
    .filter((contribution) => isNotablePlayerContribution(contribution, allowed))
    .map(toHighlight)
    .slice(0, 8);

  return {
    playerId: card.playerId,
    name: card.name,
    teamId: card.teamId,
    teamAbbrev: card.teamAbbrev,
    highlights,
  };
}

export function profileFromTeamCard(card: TeamNerdCard): TeamNerdProfile {
  const stats = new Map<string, TeamNerdStatEntry>();
  for (const entry of card.stats) {
    stats.set(entry.statId, {
      rank: entry.rank,
      displayValue: entry.displayValue,
      value: entry.value,
      title: entry.title,
      sort: entry.sort,
    });
  }
  return {
    teamId: card.teamId,
    abbrev: card.abbrev,
    stats,
  };
}

export function getTeamStat(
  profile: TeamNerdProfile | null | undefined,
  statId: string,
): TeamNerdStatEntry | undefined {
  return profile?.stats.get(statId);
}

export function isEliteRank(
  entry: TeamNerdStatEntry | undefined,
  maxRank = 5,
): entry is TeamNerdStatEntry {
  if (!entry || entry.rank > maxRank) return false;
  return entry.value > 0 || entry.displayValue !== "—";
}

/** Bottom-N in the league (insights only — wider than share-card cursed threshold). */
export function isCursedInsightRank(
  entry: TeamNerdStatEntry | undefined,
  bottomN = 8,
): entry is TeamNerdStatEntry {
  if (!entry) return false;
  const threshold = MLB_TEAMS.length - bottomN + 1;
  if (entry.rank < threshold) return false;
  return entry.value > 0 || entry.displayValue !== "—";
}

export function isNotableInsightRank(
  entry: TeamNerdStatEntry | undefined,
  eliteMaxRank = 8,
  cursedBottomN = 8,
): entry is TeamNerdStatEntry {
  return isEliteRank(entry, eliteMaxRank) || isCursedInsightRank(entry, cursedBottomN);
}

export function rankLabel(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

export function formatSharePct(share: number): string {
  return `${Math.round(share * 100)}%`;
}
