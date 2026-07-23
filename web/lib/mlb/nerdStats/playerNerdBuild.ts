import { NERD_STAT_DEFINITIONS } from "@/lib/mlb/nerdStats/statDefinitions";
import {
  TEAM_ONLY_NERD_STAT_IDS,
  type PlayerNerdCard,
  type PlayerNerdCounters,
  type PlayerNerdStatContribution,
  type TeamNerdCounters,
} from "@/lib/mlb/nerdStats/types";

/**
 * Map stat IDs → the counter field that represents "actions" for share-of-team.
 * For rates, this is the numerator (e.g. barrels for barrel-rate).
 */
const SHARE_ACTION_FIELDS: Record<string, keyof TeamNerdCounters> = {
  "walkoff-bloop-singles": "walkoffBloopSingles",
  "double-plays-hit-into": "gidp",
  "rally-killer-gidp": "rallyKillerGidp",
  "triple-plays-hit-into": "triplePlays",
  "triple-play-rate": "triplePlays",
  "hit-by-pitch": "hbp",
  "golden-sombrero": "goldenSombreros",
  "multi-hr-games-allowed": "multiHrGamesAllowed",
  "immaculate-inning-victim": "immaculateInningVictims",
  "post-lead-runs-allowed": "leadTakeNextInningRunsAllowed",
  "pickoffs-suffered": "pickoffs",
  "caught-stealing": "caughtStealing",
  "moonshot-hrs": "moonshotHomeRuns",
  "wall-scraper-hrs": "wallScraperHomeRuns",
  "no-doubter-hr-rate": "noDoubterHomeRuns",
  "barrel-rate": "barrelBalls",
  "solid-plus-rate": "solidContactBalls",
  "weak-contact-rate": "weakContactBalls",
  "hard-hit-rate": "hardHitBalls",
  "sweet-spot-rate": "sweetSpotBalls",
  "meatballs-punished": "meatballsPunished",
  "meatball-punish-rate": "meatballsPunished",
  "meatball-barrel-rate": "meatballBarrels",
  "meatballs-thrown": "meatballsThrown",
  "meatball-rate": "meatballsThrown",
  "meatballs-punished-allowed": "meatballsPunishedAllowed",
  "meatball-whiff-rate": "meatballWhiffs",
  "chop-rate": "chopBalls",
  "popup-rate": "popupBalls",
  "bloop-singles": "bloopSingles",
  "infield-singles": "infieldSingles",
  "gidp-induced": "gidpInduced",
  "nobletigers-induced": "nobletigersInduced",
  "triple-plays-turned": "triplePlaysTurned",
  "no-hitter-bid-ruined": "noHitterBidRuined",
  "errors-committed": "errorsCommitted",
  "errors-per-game": "errorsCommitted",
  "fielding-errors": "fieldingErrors",
  "throwing-errors": "throwingErrors",
  "error-runs-allowed": "errorRunsAllowed",
  "error-games": "errorGames",
  "multi-error-games": "multiErrorGames",
  "late-inning-runs": "lateInningRuns",
  "first-inning-runs": "firstInningRuns",
  "first-inning-runs-allowed": "firstInningRunsAllowed",
  "late-inning-runs-allowed": "lateInningRunsAllowed",
  "strikeout-rate": "strikeouts",
  "walk-rate": "walks",
  "intent-walk-rate": "intentWalks",
  "sac-fly-rate": "sacFlies",
  "sac-bunt-society": "sacBunts",
  "zero-walk-games": "zeroWalkGames",
  "balk-beneficiaries": "balkBenefits",
  "wild-pitch-runs": "wildPitchBenefits",
  "passed-ball-runs": "passedBallBenefits",
  "reached-on-error": "reachedOnError",
  "cycle-games": "cycleGames",
  "back-to-back-hr-games": "backToBackHrGames",
  "back-to-back-to-back-hr-games": "backToBackToBackHrGames",
  "bases-loaded-no-runs": "basesLoadedNoRuns",
  nobletigers: "nobletigers",
  "left-on-base": "leftOnBase",
  "lob-nightmare-games": "lobNightmareGames",
  "player-cycle-games": "playerCycleGames",
  "pinch-hit-chaos": "pinchHitChaos",
  "pinch-hit-hits": "pinchHitHits",
  "runs-with-two-outs-pct": "runsWithTwoOuts",
  "steal-success-rate": "stolenBases",
  "steal-attempt-rate": "stolenBases",
  babip: "hits",
  "hard-hit-balls": "hardHitBalls",
  "sweet-spot-balls": "sweetSpotBalls",
  barrels: "barrelBalls",
  hits: "hits",
  "home-runs": "homeRuns",
  strikeouts: "strikeouts",
  walks: "walks",
  hbp: "hbp",
  "plate-appearances": "plateAppearances",
  "balls-in-play": "ballsInPlay",
  "pitching-strikeouts": "pitchingStrikeouts",
  "hits-allowed": "hitsAllowed",
  "pitches-thrown": "pitchesThrown",
  "pitches-seen": "pitchesSeen",
};

function actionCount(
  counters: TeamNerdCounters,
  statId: string,
  computed: number | null,
): number | null {
  const field = SHARE_ACTION_FIELDS[statId];
  if (field) {
    const value = counters[field];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }

  // Direct count stats: computed value is already a non-negative integer count.
  if (
    computed != null &&
    Number.isFinite(computed) &&
    Number.isInteger(computed) &&
    computed >= 0 &&
    computed < 1_000_000
  ) {
    return computed;
  }

  return null;
}

export function buildPlayerNerdContributions(
  player: PlayerNerdCounters,
  team: TeamNerdCounters | null,
): PlayerNerdStatContribution[] {
  const contributions: PlayerNerdStatContribution[] = [];

  for (const def of NERD_STAT_DEFINITIONS) {
    if (TEAM_ONLY_NERD_STAT_IDS.has(def.id)) continue;

    const playerValue = def.compute(player);
    const teamValue = team ? def.compute(team) : null;

    if (playerValue == null && player.plateAppearances === 0 && player.pitchesThrown === 0) {
      continue;
    }

    const playerActions = actionCount(player, def.id, playerValue);
    if (
      (playerValue == null || playerValue === 0) &&
      (playerActions == null || playerActions === 0)
    ) {
      continue;
    }

    const teamActions = team ? actionCount(team, def.id, teamValue) : null;

    let shareOfTeam: number | null = null;
    if (playerActions != null && teamActions != null && teamActions > 0) {
      shareOfTeam = Math.min(1, playerActions / teamActions);
    }

    contributions.push({
      statId: def.id,
      title: def.title,
      subtitle: def.subtitle,
      category: def.category,
      unit: def.unit,
      sort: def.sort,
      playerValue,
      teamValue,
      playerDisplay: playerValue == null ? "—" : def.formatValue(playerValue),
      teamDisplay: teamValue == null ? "—" : def.formatValue(teamValue),
      shareOfTeam,
      playerActions,
      teamActions,
    });
  }

  contributions.sort((a, b) => {
    const shareA = a.shareOfTeam ?? -1;
    const shareB = b.shareOfTeam ?? -1;
    if (shareA !== shareB) return shareB - shareA;
    return a.title.localeCompare(b.title);
  });

  return contributions;
}

export function buildPlayerNerdCard(
  season: number,
  player: PlayerNerdCounters,
  team: TeamNerdCounters | null,
): PlayerNerdCard {
  return {
    season,
    playerId: player.playerId,
    name: player.name,
    teamId: player.teamId,
    teamAbbrev: player.teamAbbrev,
    generatedAt: new Date().toISOString(),
    contributions: buildPlayerNerdContributions(player, team),
  };
}
