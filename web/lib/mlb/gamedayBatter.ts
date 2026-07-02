const GAMEDAY_ASSETS_BASE =
  "https://prod-gameday.mlbstatic.com/responsive-gameday-assets/1.3.0";

export type GamedayBatterHand = "right" | "left";

export interface UniformAssetRaw {
  uniformAssetCode?: string;
  active?: boolean;
  uniformAssetType?: { uniformAssetTypeCode?: string };
}

export interface UniformsGameTeamRaw {
  id?: number;
  uniformAssets?: UniformAssetRaw[];
}

export interface UniformsGameResponse {
  uniforms?: Array<{
    gamePk?: number;
    home?: UniformsGameTeamRaw;
    away?: UniformsGameTeamRaw;
  }>;
}

export interface UniformsTeamResponse {
  teams?: Array<{
    team?: { id?: number };
    uniformAssets?: UniformAssetRaw[];
  }>;
}

export function gamedayBatterHand(batSide: string | null | undefined): GamedayBatterHand {
  return batSide?.toUpperCase() === "L" ? "left" : "right";
}

export function yearFromUniformAssetCode(code: string): string {
  return code.split("_").at(-1) ?? new Date().getFullYear().toString();
}

export function gamedayBatterCdnUrl(code: string, hand: GamedayBatterHand): string {
  const year = yearFromUniformAssetCode(code);
  return `${GAMEDAY_ASSETS_BASE}/images/batters/${year}/${hand}/${code}.png`;
}

export function pickJerseyAssetCode(assets: UniformAssetRaw[] | undefined): string | null {
  if (!assets?.length) return null;

  const jerseys = assets.filter(
    (asset) => asset.uniformAssetType?.uniformAssetTypeCode === "J" && asset.uniformAssetCode,
  );
  if (!jerseys.length) return null;

  const active = jerseys.find((asset) => asset.active);
  return (active ?? jerseys[0]).uniformAssetCode ?? null;
}

export function jerseyCodeForTeam(
  data: UniformsGameResponse | null | undefined,
  teamId: number,
): string | null {
  if (!data?.uniforms?.length) return null;

  for (const entry of data.uniforms) {
    for (const side of ["home", "away"] as const) {
      const team = entry[side];
      if (team?.id === teamId) {
        return pickJerseyAssetCode(team.uniformAssets);
      }
    }
  }

  return null;
}

export const UNIFORMS_GAME_URL = "https://statsapi.mlb.com/api/v1/uniforms/game";
export const UNIFORMS_TEAM_URL = "https://statsapi.mlb.com/api/v1/uniforms/team";
