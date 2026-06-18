import { NextResponse } from "next/server";

import { archiveFinishedGame } from "@/lib/games/archiveGame";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

interface RouteParams {
  params: Promise<{ gamePk: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { gamePk: gamePkParam } = await params;
  const gamePk = Number(gamePkParam);

  if (!Number.isFinite(gamePk) || gamePk <= 0) {
    return NextResponse.json({ error: "Invalid game PK" }, { status: 400 });
  }

  try {
    const result = await archiveFinishedGame(gamePk, {
      maxAttempts: 5,
      retryDelayMs: 12_000,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to archive game";
    return NextResponse.json({ error: message, archived: false }, { status: 502 });
  }
}
