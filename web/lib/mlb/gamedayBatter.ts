import { GAMEDAY_ASSETS_BASE } from "@/lib/mlb/gamedayAssets";

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

export interface UniformsTeamEntry {
  teamId?: number;
  uniformAssets?: UniformAssetRaw[];
}

export interface UniformsTeamResponse {
  uniforms?: UniformsTeamEntry[];
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

/** Pants asset code paired with a jersey code from the uniforms API. */
export function gamedayPantsCodeFromJersey(jerseyCode: string): string {
  return jerseyCode.replace("_jersey_", "_pants_");
}

export function gamedayPantsCdnUrl(jerseyCode: string, hand: GamedayBatterHand): string {
  return gamedayBatterCdnUrl(gamedayPantsCodeFromJersey(jerseyCode), hand);
}

export function jerseyVariantFromCode(jerseyCode: string): string | null {
  return jerseyCode.match(/_jersey_(\d+)_/)?.[1] ?? null;
}

export function pickPantsAssetCode(
  assets: UniformAssetRaw[] | undefined,
  jerseyCode: string,
): string | null {
  if (!assets?.length) return null;

  const pants = assets.filter(
    (asset) => asset.uniformAssetType?.uniformAssetTypeCode === "P" && asset.uniformAssetCode,
  );
  if (!pants.length) return null;

  const variant = jerseyVariantFromCode(jerseyCode);
  if (variant) {
    const matched = pants.find((asset) =>
      asset.uniformAssetCode?.includes(`_pants_${variant}_`),
    );
    if (matched?.uniformAssetCode) return matched.uniformAssetCode;
  }

  const active = pants.find((asset) => asset.active);
  return (active ?? pants[0]).uniformAssetCode ?? null;
}

export function pantsCodeForTeam(
  data: UniformsGameResponse | null | undefined,
  teamId: number,
  jerseyCode: string,
): string | null {
  if (!data?.uniforms?.length) return null;

  for (const entry of data.uniforms) {
    for (const side of ["home", "away"] as const) {
      const team = entry[side];
      if (team?.id === teamId) {
        return pickPantsAssetCode(team.uniformAssets, jerseyCode);
      }
    }
  }

  return null;
}

export function pantsCandidatesForJersey(
  assets: UniformAssetRaw[] | undefined,
  jerseyCode: string,
): string[] {
  const candidates = new Set<string>();
  const fromAssets = pickPantsAssetCode(assets, jerseyCode);
  if (fromAssets) candidates.add(fromAssets);
  candidates.add(gamedayPantsCodeFromJersey(jerseyCode));

  const variant = jerseyVariantFromCode(jerseyCode);
  const year = yearFromUniformAssetCode(jerseyCode);
  const teamPrefix = jerseyCode.split("_")[0];

  if (assets?.length) {
    for (const asset of assets) {
      if (asset.uniformAssetType?.uniformAssetTypeCode !== "P" || !asset.uniformAssetCode) continue;
      candidates.add(asset.uniformAssetCode);
    }
  }

  if (variant && teamPrefix) {
    for (const fallbackVariant of [variant, "1", "2", "4", "5"]) {
      candidates.add(`${teamPrefix}_pants_${fallbackVariant}_${year}`);
    }
  }

  return [...candidates];
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
