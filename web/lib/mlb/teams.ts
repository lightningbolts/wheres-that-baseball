export type MLBLeague = "AL" | "NL";
export type MLBDivision = "East" | "Central" | "West";

export type NerdStatGroupFilter =
  | "all"
  | MLBLeague
  | `${MLBLeague}-${MLBDivision}`;

export interface MLBTeam {
  id: number;
  name: string;
  abbrev: string;
  league: MLBLeague;
  division: MLBDivision;
  /** Alternate abbrevs used by the MLB Stats API / live feeds. */
  aliases?: string[];
}

/** All 30 MLB teams — sorted alphabetically by city/name for the team picker. */
export const MLB_TEAMS: MLBTeam[] = [
  { id: 109, name: "Arizona Diamondbacks", abbrev: "ARI", league: "NL", division: "West", aliases: ["AZ"] },
  { id: 144, name: "Atlanta Braves", abbrev: "ATL", league: "NL", division: "East" },
  { id: 110, name: "Baltimore Orioles", abbrev: "BAL", league: "AL", division: "East" },
  { id: 111, name: "Boston Red Sox", abbrev: "BOS", league: "AL", division: "East" },
  { id: 112, name: "Chicago Cubs", abbrev: "CHC", league: "NL", division: "Central" },
  { id: 145, name: "Chicago White Sox", abbrev: "CWS", league: "AL", division: "Central" },
  { id: 113, name: "Cincinnati Reds", abbrev: "CIN", league: "NL", division: "Central" },
  { id: 114, name: "Cleveland Guardians", abbrev: "CLE", league: "AL", division: "Central" },
  { id: 115, name: "Colorado Rockies", abbrev: "COL", league: "NL", division: "West" },
  { id: 116, name: "Detroit Tigers", abbrev: "DET", league: "AL", division: "Central" },
  { id: 117, name: "Houston Astros", abbrev: "HOU", league: "AL", division: "West" },
  { id: 118, name: "Kansas City Royals", abbrev: "KC", league: "AL", division: "Central" },
  { id: 108, name: "Los Angeles Angels", abbrev: "LAA", league: "AL", division: "West" },
  { id: 119, name: "Los Angeles Dodgers", abbrev: "LAD", league: "NL", division: "West" },
  { id: 146, name: "Miami Marlins", abbrev: "MIA", league: "NL", division: "East" },
  { id: 158, name: "Milwaukee Brewers", abbrev: "MIL", league: "NL", division: "Central" },
  { id: 142, name: "Minnesota Twins", abbrev: "MIN", league: "AL", division: "Central" },
  { id: 121, name: "New York Mets", abbrev: "NYM", league: "NL", division: "East" },
  { id: 147, name: "New York Yankees", abbrev: "NYY", league: "AL", division: "East" },
  { id: 133, name: "Athletics", abbrev: "OAK", league: "AL", division: "West", aliases: ["ATH"] },
  { id: 143, name: "Philadelphia Phillies", abbrev: "PHI", league: "NL", division: "East" },
  { id: 134, name: "Pittsburgh Pirates", abbrev: "PIT", league: "NL", division: "Central" },
  { id: 135, name: "San Diego Padres", abbrev: "SD", league: "NL", division: "West" },
  { id: 137, name: "San Francisco Giants", abbrev: "SF", league: "NL", division: "West" },
  { id: 136, name: "Seattle Mariners", abbrev: "SEA", league: "AL", division: "West" },
  { id: 138, name: "St. Louis Cardinals", abbrev: "STL", league: "NL", division: "Central" },
  { id: 139, name: "Tampa Bay Rays", abbrev: "TB", league: "AL", division: "East" },
  { id: 140, name: "Texas Rangers", abbrev: "TEX", league: "AL", division: "West" },
  { id: 141, name: "Toronto Blue Jays", abbrev: "TOR", league: "AL", division: "East" },
  { id: 120, name: "Washington Nationals", abbrev: "WSH", league: "NL", division: "East" },
];

export const NERD_STAT_GROUP_FILTERS: Array<{ id: NerdStatGroupFilter; label: string }> = [
  { id: "all", label: "All MLB" },
  { id: "AL", label: "American League" },
  { id: "NL", label: "National League" },
  { id: "AL-East", label: "AL East" },
  { id: "AL-Central", label: "AL Central" },
  { id: "AL-West", label: "AL West" },
  { id: "NL-East", label: "NL East" },
  { id: "NL-Central", label: "NL Central" },
  { id: "NL-West", label: "NL West" },
];

export function getTeamById(teamId: number): MLBTeam | undefined {
  return MLB_TEAMS.find((team) => team.id === teamId);
}

function normalizeTeamAbbrev(abbrev: string): string {
  return abbrev.trim().toUpperCase();
}

export function getTeamByAbbrev(abbrev: string): MLBTeam | undefined {
  const normalized = normalizeTeamAbbrev(abbrev);
  return MLB_TEAMS.find(
    (team) =>
      team.abbrev.toUpperCase() === normalized ||
      team.aliases?.some((alias) => alias.toUpperCase() === normalized),
  );
}

export function getTeamsByLeague(league: MLBLeague): MLBTeam[] {
  return MLB_TEAMS.filter((team) => team.league === league);
}

export function getTeamsByDivision(league: MLBLeague, division: MLBDivision): MLBTeam[] {
  return MLB_TEAMS.filter((team) => team.league === league && team.division === division);
}

export function getTeamIdsForGroup(filter: NerdStatGroupFilter): number[] {
  if (filter === "all") return MLB_TEAMS.map((team) => team.id);
  if (filter === "AL" || filter === "NL") {
    return getTeamsByLeague(filter).map((team) => team.id);
  }
  const [league, division] = filter.split("-") as [MLBLeague, MLBDivision];
  return getTeamsByDivision(league, division).map((team) => team.id);
}

export function teamInGroup(teamId: number, filter: NerdStatGroupFilter): boolean {
  if (filter === "all") return true;
  const team = getTeamById(teamId);
  if (!team) return false;
  if (filter === "AL" || filter === "NL") return team.league === filter;
  const [league, division] = filter.split("-") as [MLBLeague, MLBDivision];
  return team.league === league && team.division === division;
}
