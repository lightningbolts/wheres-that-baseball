/** Primary brand colors for chart lines and accents (aligned with MLB cap/logo palettes). */
export const MLB_TEAM_COLORS: Record<number, string> = {
  108: "#BA0021", // LAA
  109: "#A71930", // ARI
  110: "#DF4601", // BAL
  111: "#BD3039", // BOS
  112: "#0E3386", // CHC
  113: "#C6011F", // CIN
  114: "#00385D", // CLE
  115: "#33006F", // COL
  116: "#0C2340", // DET
  117: "#002D62", // HOU
  118: "#004687", // KC
  119: "#005A9C", // LAD
  120: "#AB0003", // WSH
  133: "#003831", // OAK
  134: "#27251F", // PIT
  135: "#2F241D", // SD
  136: "#0C2C56", // SEA
  137: "#FD5A1E", // SF
  138: "#C41E3A", // STL
  139: "#092C5C", // TB
  140: "#003278", // TEX
  141: "#134A8E", // TOR
  142: "#002B5C", // MIN
  143: "#E81828", // PHI
  144: "#CE1141", // ATL
  145: "#27251F", // CWS
  146: "#00A3E0", // MIA
  147: "#003087", // NYY
  158: "#12284B", // MIL
};

const FALLBACK_COLOR = "#6b7d72";

export function getTeamColor(teamId: number): string {
  return MLB_TEAM_COLORS[teamId] ?? FALLBACK_COLOR;
}
