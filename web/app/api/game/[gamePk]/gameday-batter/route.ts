import { NextResponse } from "next/server";

import { GAMEDAY_FETCH_HEADERS } from "@/lib/mlb/gamedayAssets";
import {
  UNIFORMS_GAME_URL,
  UNIFORMS_TEAM_URL,
  gamedayBatterCdnUrl,
  gamedayBatterHand,
  gamedayPantsCdnUrl,
  gamedayPantsCodeFromJersey,
  jerseyCodeForTeam,
  pantsCandidatesForJersey,
  pantsCodeForTeam,
  pickJerseyAssetCode,
  pickPantsAssetCode,
  type UniformsGameResponse,
  type UniformsTeamResponse,
} from "@/lib/mlb/gamedayBatter";

export const dynamic = "force-dynamic";

const jerseyCache = new Map<string, { code: string; expiresAt: number }>();
const CACHE_MS = 60 * 60 * 1000;

interface RouteParams {
  params: Promise<{ gamePk: string }>;
}

async function fetchUniformsGame(gamePk: number): Promise<UniformsGameResponse | null> {
  const response = await fetch(`${UNIFORMS_GAME_URL}?gamePks=${gamePk}`, {
    next: { revalidate: 3600 },
  });
  if (!response.ok) return null;
  return (await response.json()) as UniformsGameResponse;
}

async function fetchTeamUniforms(teamId: number): Promise<UniformsTeamResponse["uniforms"]> {
  const response = await fetch(`${UNIFORMS_TEAM_URL}?teamIds=${teamId}`, {
    next: { revalidate: 3600 },
  });
  if (!response.ok) return [];

  const data = (await response.json()) as UniformsTeamResponse;
  return data.uniforms ?? [];
}

async function fetchTeamJersey(teamId: number): Promise<string | null> {
  const uniforms = await fetchTeamUniforms(teamId);
  const team = uniforms.find((entry) => entry.teamId === teamId);
  return pickJerseyAssetCode(team?.uniformAssets);
}

async function resolveJerseyCode(gamePk: number, teamId: number): Promise<string | null> {
  const cacheKey = `${gamePk}:${teamId}`;
  const cached = jerseyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.code;

  const gameData = await fetchUniformsGame(gamePk);
  let code = jerseyCodeForTeam(gameData, teamId);
  if (!code) code = await fetchTeamJersey(teamId);
  if (!code) return null;

  jerseyCache.set(cacheKey, { code, expiresAt: Date.now() + CACHE_MS });
  return code;
}

async function pantsExistsOnCdn(code: string, hand: "right" | "left"): Promise<boolean> {
  const response = await fetch(gamedayBatterCdnUrl(code, hand), {
    method: "HEAD",
    headers: GAMEDAY_FETCH_HEADERS,
  });
  return response.ok;
}

async function resolvePantsCode(
  gamePk: number,
  teamId: number,
  jerseyCode: string,
  hand: "right" | "left",
): Promise<string> {
  const gameData = await fetchUniformsGame(gamePk);
  const fromGame = pantsCodeForTeam(gameData, teamId, jerseyCode);
  if (fromGame && (await pantsExistsOnCdn(fromGame, hand))) return fromGame;

  const teamUniforms = await fetchTeamUniforms(teamId);
  const teamEntry = teamUniforms.find((entry) => entry.teamId === teamId);
  const fromTeam = pickPantsAssetCode(teamEntry?.uniformAssets, jerseyCode);
  if (fromTeam && (await pantsExistsOnCdn(fromTeam, hand))) return fromTeam;

  const candidates = pantsCandidatesForJersey(teamEntry?.uniformAssets, jerseyCode);
  for (const candidate of candidates) {
    if (await pantsExistsOnCdn(candidate, hand)) return candidate;
  }

  return gamedayPantsCodeFromJersey(jerseyCode);
}

export async function GET(request: Request, { params }: RouteParams) {
  const { gamePk: gamePkParam } = await params;
  const gamePk = Number(gamePkParam);
  const { searchParams } = new URL(request.url);
  const teamId = Number(searchParams.get("teamId"));
  const batSide = searchParams.get("batSide");

  if (!Number.isFinite(gamePk) || gamePk <= 0) {
    return NextResponse.json({ error: "Invalid game PK" }, { status: 400 });
  }
  if (!Number.isFinite(teamId) || teamId <= 0) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }

  try {
    const jerseyCode = await resolveJerseyCode(gamePk, teamId);
    if (!jerseyCode) {
      return NextResponse.json({ error: "Uniform not found" }, { status: 404 });
    }

    const hand = gamedayBatterHand(batSide);
    const pantsCode = await resolvePantsCode(gamePk, teamId, jerseyCode, hand);

    return NextResponse.json({
      jerseyUrl: `/api/gameday/batter?code=${encodeURIComponent(jerseyCode)}&hand=${hand}`,
      pantsUrl: `/api/gameday/batter?code=${encodeURIComponent(pantsCode)}&hand=${hand}`,
      imageUrl: `/api/gameday/batter?code=${encodeURIComponent(jerseyCode)}&hand=${hand}`,
      cdnUrl: gamedayBatterCdnUrl(jerseyCode, hand),
      pantsCdnUrl: gamedayPantsCdnUrl(jerseyCode, hand),
      jerseyCode,
      pantsCode,
      hand,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load batter image";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
