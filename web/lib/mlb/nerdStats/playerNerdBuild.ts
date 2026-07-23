import { NERD_STAT_DEFINITIONS, type NerdStatDefinition } from "@/lib/mlb/nerdStats/statDefinitions";
import {
  TEAM_ONLY_NERD_STAT_IDS,
  type PlayerNerdCard,
  type PlayerNerdCounters,
  type PlayerNerdStatContribution,
  type TeamNerdCounters,
} from "@/lib/mlb/nerdStats/types";

/** Numerator / action count used for share-of-team. */
type ShareActions =
  | keyof TeamNerdCounters
  | ((counters: TeamNerdCounters) => number | null);

/**
 * Map stat IDs → actions for share-of-team.
 * For rates this is the numerator (e.g. barrels for barrel-rate).
 * For averages / sample-based metrics this is the sample size (e.g. exitVeloCount).
 */
const SHARE_ACTIONS: Record<string, ShareActions> = {
  // Counts
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
  "baserunning-blunders": (c) => c.caughtStealing + c.pickoffs,
  "moonshot-hrs": "moonshotHomeRuns",
  "wall-scraper-hrs": "wallScraperHomeRuns",
  "bloop-singles": "bloopSingles",
  "infield-singles": "infieldSingles",
  "gidp-induced": "gidpInduced",
  "nobletigers-induced": "nobletigersInduced",
  "triple-plays-turned": "triplePlaysTurned",
  "no-hitter-bid-ruined": "noHitterBidRuined",
  "errors-committed": "errorsCommitted",
  "fielding-errors": "fieldingErrors",
  "throwing-errors": "throwingErrors",
  "error-runs-allowed": "errorRunsAllowed",
  "error-games": "errorGames",
  "multi-error-games": "multiErrorGames",
  "late-inning-runs": "lateInningRuns",
  "first-inning-runs": "firstInningRuns",
  "first-inning-runs-allowed": "firstInningRunsAllowed",
  "late-inning-runs-allowed": "lateInningRunsAllowed",
  "sac-bunt-society": "sacBunts",
  "zero-walk-games": "zeroWalkGames",
  "balk-beneficiaries": "balkBenefits",
  "wild-pitch-runs": "wildPitchBenefits",
  "passed-ball-runs": "passedBallBenefits",
  "reached-on-error": "reachedOnError",
  "cycle-games": "cycleGames",
  "back-to-back-hr-games": "backToBackHrGames",
  "back-to-back-to-back-hr-games": "backToBackToBackHrGames",
  "back-to-back-hr-sequences": "backToBackHrSequences",
  "bases-loaded-no-runs": "basesLoadedNoRuns",
  nobletigers: "nobletigers",
  "left-on-base": "leftOnBase",
  "lob-nightmare-games": "lobNightmareGames",
  "player-cycle-games": "playerCycleGames",
  "pinch-hit-chaos": "pinchHitChaos",
  "pinch-hit-hits": "pinchHitHits",
  "meatballs-punished": "meatballsPunished",
  "meatballs-thrown": "meatballsThrown",
  "meatballs-punished-allowed": "meatballsPunishedAllowed",
  "small-ball-score": (c) => c.sacBunts + c.sacFlies + c.stolenBases,
  "foul-ball-factory": "foulBalls",
  "quick-half-innings-seen": "quickHalfInningsSeen",
  "long-half-innings-seen": "longHalfInningsSeen",
  "total-pitches-seen": "pitchesSeen",
  doubles: "doubles",
  triples: "triples",
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

  // Rate numerators
  "no-doubter-hr-rate": "noDoubterHomeRuns",
  "barrel-rate": "barrelBalls",
  "solid-plus-rate": (c) => c.solidContactBalls + c.barrelBalls,
  "weak-contact-rate": "weakContactBalls",
  "hard-hit-rate": "hardHitBalls",
  "sweet-spot-rate": "sweetSpotBalls",
  "meatball-punish-rate": "meatballsPunished",
  "meatball-barrel-rate": "meatballBarrels",
  "meatball-rate": "meatballsThrown",
  "meatball-whiff-rate": "meatballWhiffs",
  "chop-rate": "chopBalls",
  "popup-rate": "popupBalls",
  "strikeout-rate": "strikeouts",
  "walk-rate": "walks",
  "intent-walk-rate": "intentWalks",
  "sac-fly-rate": "sacFlies",
  "errors-per-game": "errorsCommitted",
  "runs-with-two-outs-pct": "runsWithTwoOuts",
  "steal-success-rate": "stolenBases",
  "steal-attempt-rate": (c) => c.stolenBases + c.caughtStealing,
  babip: (c) => Math.max(0, c.hits - c.homeRuns),
  "gidp-rate": "gidp",
  "hr-per-pa": "homeRuns",
  "hbp-rate": "hbp",
  "three-true-outcomes-rate": (c) => c.strikeouts + c.walks + c.homeRuns,
  "extra-base-rate": (c) => c.doubles + c.triples + c.homeRuns,
  "contact-rate": (c) =>
    Math.max(0, c.plateAppearances - c.strikeouts - c.walks - c.homeRuns),
  "pinch-hit-success-rate": "pinchHitHits",
  "first-inning-run-share": "firstInningRuns",
  "late-inning-run-share": "lateInningRuns",
  "first-inning-runs-allowed-share": "firstInningRunsAllowed",
  "late-inning-runs-allowed-share": "lateInningRunsAllowed",
  "ball-rate": "pitchBalls",
  "foul-rate": "foulBalls",
  "pitch-bip-rate": "ballsInPlay",
  "swinging-strike-rate": "swingingStrikes",
  "called-strike-rate": "calledStrikes",
  "balls-in-play-allowed-rate": "ballsInPlayAllowed",

  // First-pitch (hitting)
  "first-pitch-strike-rate": "firstPitchStrikes",
  "first-pitch-ball-rate": "firstPitchBalls",
  "first-pitch-swing-rate": "firstPitchSwings",
  "first-pitch-called-strike-rate": "firstPitchCalledStrikes",
  "first-pitch-whiff-rate": "firstPitchSwingingStrikes",
  "first-pitch-foul-rate": "firstPitchFouls",
  "first-pitch-in-play-rate": "firstPitchInPlay",
  "first-pitch-avg": "firstPitchHits",
  "first-pitch-slg": "firstPitchTotalBases",
  "first-pitch-hr-rate": "firstPitchHomeRuns",

  // First-pitch (pitching)
  "first-pitch-strike-rate-pitching": "firstPitchStrikesThrown",
  "first-pitch-ball-rate-pitching": "firstPitchBallsThrown",
  "first-pitch-called-strike-rate-pitching": "firstPitchCalledStrikesInduced",
  "first-pitch-whiff-rate-pitching": "firstPitchSwingingStrikesInduced",
  "first-pitch-foul-rate-pitching": "firstPitchFoulsInduced",
  "first-pitch-in-play-allowed-rate": "firstPitchInPlayAllowed",
  "first-pitch-avg-against": "firstPitchHitsAllowed",
  "first-pitch-slg-against": "firstPitchTotalBasesAllowed",
  "first-pitch-hr-rate-allowed": "firstPitchHomeRunsAllowed",

  // RISP / full count
  "risp-batting": "rispHits",
  "full-count-obp": (c) => c.fullCountHits + c.fullCountWalks + c.fullCountHbp,
  "full-count-slg": "fullCountTotalBases",
  "full-count-ops": (c) => c.fullCountHits + c.fullCountWalks + c.fullCountHbp,

  // Sample-size based (averages / extrema)
  "avg-exit-velo": "exitVeloCount",
  "avg-launch-angle": "launchAngleCount",
  "how-was-that-hit": "launchSpeedAngleCount",
  "hardest-hit": "battedBallEvents",
  "hardest-hit-allowed": "battedBallEvents",
  "softest-home-run": "homeRuns",
  "shortest-home-run": "homeRuns",
  "flarest-home-run": "homeRuns",
  "lob-pct": "leftOnBase",

  // Pace — share of team pitches / plate appearances
  "pitches-per-pa": "pitchesSeen",
  "pitches-per-run": "pitchesSeen",
  "pitches-per-hit": "pitchesSeen",
  "pitches-seen-per-half": "pitchesSeen",
  "pitches-per-run-allowed": "pitchesThrown",
  "pitches-per-hit-allowed": "pitchesThrown",
  "pitches-thrown-per-half": "pitchesThrown",
  "post-lead-runs-per-chance": "leadTakeNextInningRunsAllowed",
};

function resolveActions(
  counters: TeamNerdCounters,
  statId: string,
  computed: number | null,
): number | null {
  const spec = SHARE_ACTIONS[statId];
  if (typeof spec === "function") {
    const value = spec(counters);
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  if (typeof spec === "string") {
    const value = counters[spec];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
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

/** Competition rank (1,2,2,4) among teammates with a finite value for this stat. */
export function rankPlayerOnTeam(
  playerId: number,
  teammates: PlayerNerdCounters[],
  def: NerdStatDefinition,
): { teamRank: number | null; teamRankedCount: number | null } {
  const scored = teammates
    .map((mate) => ({
      playerId: mate.playerId,
      value: def.compute(mate),
    }))
    .filter(
      (row): row is { playerId: number; value: number } =>
        row.value != null && Number.isFinite(row.value),
    );

  if (scored.length === 0) {
    return { teamRank: null, teamRankedCount: null };
  }

  scored.sort((a, b) => (def.sort === "asc" ? a.value - b.value : b.value - a.value));

  let rank = 1;
  for (let i = 0; i < scored.length; i += 1) {
    if (i > 0 && scored[i]!.value !== scored[i - 1]!.value) {
      rank = i + 1;
    }
    if (scored[i]!.playerId === playerId) {
      return { teamRank: rank, teamRankedCount: scored.length };
    }
  }

  return { teamRank: null, teamRankedCount: scored.length };
}

export function buildPlayerNerdContributions(
  player: PlayerNerdCounters,
  team: TeamNerdCounters | null,
  teammates: PlayerNerdCounters[] = [],
): PlayerNerdStatContribution[] {
  const contributions: PlayerNerdStatContribution[] = [];
  const roster =
    teammates.length > 0
      ? teammates
      : [player];

  for (const def of NERD_STAT_DEFINITIONS) {
    if (TEAM_ONLY_NERD_STAT_IDS.has(def.id)) continue;

    const playerValue = def.compute(player);
    const teamValue = team ? def.compute(team) : null;

    if (playerValue == null && player.plateAppearances === 0 && player.pitchesThrown === 0) {
      continue;
    }

    const playerActions = resolveActions(player, def.id, playerValue);
    if (
      (playerValue == null || playerValue === 0) &&
      (playerActions == null || playerActions === 0)
    ) {
      continue;
    }

    const teamActions = team ? resolveActions(team, def.id, teamValue) : null;

    let shareOfTeam: number | null = null;
    if (playerActions != null && teamActions != null && teamActions > 0) {
      shareOfTeam = Math.min(1, playerActions / teamActions);
    }

    const { teamRank, teamRankedCount } = rankPlayerOnTeam(player.playerId, roster, def);

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
      teamRank,
      teamRankedCount,
    });
  }

  contributions.sort((a, b) => {
    const shareA = a.shareOfTeam ?? -1;
    const shareB = b.shareOfTeam ?? -1;
    if (shareA !== shareB) return shareB - shareA;
    const rankA = a.teamRank ?? Number.POSITIVE_INFINITY;
    const rankB = b.teamRank ?? Number.POSITIVE_INFINITY;
    if (rankA !== rankB) return rankA - rankB;
    return a.title.localeCompare(b.title);
  });

  return contributions;
}

export function buildPlayerNerdCard(
  season: number,
  player: PlayerNerdCounters,
  team: TeamNerdCounters | null,
  teammates: PlayerNerdCounters[] = [],
): PlayerNerdCard {
  return {
    season,
    playerId: player.playerId,
    name: player.name,
    teamId: player.teamId,
    teamAbbrev: player.teamAbbrev,
    generatedAt: new Date().toISOString(),
    contributions: buildPlayerNerdContributions(player, team, teammates),
  };
}
