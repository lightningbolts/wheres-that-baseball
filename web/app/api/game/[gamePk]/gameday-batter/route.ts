import { NextResponse } from "next/server";

import {
  UNIFORMS_GAME_URL,
  UNIFORMS_TEAM_URL,
  gamedayBatterCdnUrl,
  gamedayBatterHand,
  gamedayPantsCdnUrl,
  gamedayPantsCodeFromJersey,
  jerseyCodeForTeam,
  pickJerseyAssetCode,
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

async function fetchTeamJersey(teamId: number): Promise<string | null> {
  const response = await fetch(`${UNIFORMS_TEAM_URL}?teamIds=${teamId}`, {
    next: { revalidate: 3600 },
  });
  if (!response.ok) return null;

  const data = (await response.json()) as UniformsTeamResponse;
  const team = data.teams?.find((entry) => entry.team?.id === teamId);
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
    const pantsCode = gamedayPantsCodeFromJersey(jerseyCode);

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
