export type NerdSeasonType = "regular" | "postseason";

export const NERD_SEASON_TYPES: Array<{ id: NerdSeasonType; label: string }> = [
  { id: "regular", label: "Regular season" },
  { id: "postseason", label: "Postseason" },
];

export function parseNerdSeasonType(value: string | null | undefined): NerdSeasonType {
  return value === "postseason" ? "postseason" : "regular";
}

export function nerdSeasonTypeLabel(type: NerdSeasonType): string {
  return type === "postseason" ? "Postseason" : "Regular season";
}

export function isPostseasonGameType(gameType: string | null | undefined): boolean {
  return gameType === "F" || gameType === "D" || gameType === "L" || gameType === "W";
}
