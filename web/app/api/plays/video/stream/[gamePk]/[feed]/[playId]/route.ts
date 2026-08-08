import { proxyFastballStream, parseStreamFeed } from "@/lib/mlb/fastballStreamProxy";
import { isValidPlayId } from "@/lib/mlb/playVideo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ gamePk: string; feed: string; playId: string }>;
};

/**
 * Path-keyed Fastball proxy: /api/plays/video/stream/{gamePk}/{feed}/{playId}
 * PlayId in the path prevents caches from serving the wrong at-bat's MP4.
 */
export async function GET(request: Request, context: RouteContext) {
  const { gamePk: gamePkRaw, feed: feedRaw, playId: playIdRaw } = await context.params;
  const playId = playIdRaw?.replace(/\.mp4$/i, "").trim() ?? "";
  const gamePk = Number(gamePkRaw);
  const feed = parseStreamFeed(feedRaw);
  const range = request.headers.get("range");

  if (!isValidPlayId(playId)) {
    return Response.json({ error: "Invalid playId" }, { status: 400 });
  }

  return proxyFastballStream({ gamePk, playId, feed, range });
}
