export interface MLBTeam {
  id: number;
  name: string;
  abbrev: string;
}

/** All 30 MLB teams — sorted alphabetically by city/name for the team picker. */
export const MLB_TEAMS: MLBTeam[] = [
  { id: 109, name: "Arizona Diamondbacks", abbrev: "ARI" },
  { id: 144, name: "Atlanta Braves", abbrev: "ATL" },
  { id: 110, name: "Baltimore Orioles", abbrev: "BAL" },
  { id: 111, name: "Boston Red Sox", abbrev: "BOS" },
  { id: 112, name: "Chicago Cubs", abbrev: "CHC" },
  { id: 145, name: "Chicago White Sox", abbrev: "CWS" },
  { id: 113, name: "Cincinnati Reds", abbrev: "CIN" },
  { id: 114, name: "Cleveland Guardians", abbrev: "CLE" },
  { id: 115, name: "Colorado Rockies", abbrev: "COL" },
  { id: 116, name: "Detroit Tigers", abbrev: "DET" },
  { id: 117, name: "Houston Astros", abbrev: "HOU" },
  { id: 118, name: "Kansas City Royals", abbrev: "KC" },
  { id: 108, name: "Los Angeles Angels", abbrev: "LAA" },
  { id: 119, name: "Los Angeles Dodgers", abbrev: "LAD" },
  { id: 146, name: "Miami Marlins", abbrev: "MIA" },
  { id: 158, name: "Milwaukee Brewers", abbrev: "MIL" },
  { id: 142, name: "Minnesota Twins", abbrev: "MIN" },
  { id: 121, name: "New York Mets", abbrev: "NYM" },
  { id: 147, name: "New York Yankees", abbrev: "NYY" },
  { id: 133, name: "Oakland Athletics", abbrev: "OAK" },
  { id: 143, name: "Philadelphia Phillies", abbrev: "PHI" },
  { id: 134, name: "Pittsburgh Pirates", abbrev: "PIT" },
  { id: 135, name: "San Diego Padres", abbrev: "SD" },
  { id: 137, name: "San Francisco Giants", abbrev: "SF" },
  { id: 136, name: "Seattle Mariners", abbrev: "SEA" },
  { id: 138, name: "St. Louis Cardinals", abbrev: "STL" },
  { id: 139, name: "Tampa Bay Rays", abbrev: "TB" },
  { id: 140, name: "Texas Rangers", abbrev: "TEX" },
  { id: 141, name: "Toronto Blue Jays", abbrev: "TOR" },
  { id: 120, name: "Washington Nationals", abbrev: "WSH" },
];

export function getTeamById(teamId: number): MLBTeam | undefined {
  return MLB_TEAMS.find((team) => team.id === teamId);
}
