import { NERD_STAT_DEFINITIONS } from "@/lib/mlb/nerdStats/statDefinitions";
import {
  TEAM_ONLY_NERD_STAT_IDS,
  type PlayerNerdCard,
  type PlayerNerdCounters,
  type PlayerNerdStatContribution,
  type TeamNerdCounters,
} from "@/lib/mlb/nerdStats/types";

/** Prefer a clear count field when the computed value is a rate. */
const SHARE_ACTION_FIELDS: Partial<Record<string, keyof TeamNerdCounters>> = {
  gidp: "gidp",
  "rally-killer-gidp": "rallyKillerGidp",
  "home-runs": "homeRuns",
  barrels: "barrelBalls",
  "hard-hit-balls": "hardHitBalls",
  "sweet-spot-balls": "sweetSpotBalls",
  "bloop-singles": "bloopSingles",
  "infield-singles": "infieldSingles",
  "plate-appearances": "plateAppearances",
  strikeouts: "strikeouts",
  walks: "walks",
  hbp: "hbp",
  hits: "hits",
  "meatballs-punished": "meatballsPunished",
  "meatballs-seen": "meatballsSeen",
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
    return typeof value === "number" ? value : null;
  }
  if (computed != null && Number.isInteger(computed) && computed >= 0 && computed < 1_000_000) {
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
    if (playerActions != null && teamActions != null && teamActions > 0 && playerActions >= 0) {
      shareOfTeam = playerActions / teamActions;
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
