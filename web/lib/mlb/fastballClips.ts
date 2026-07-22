import { isValidPlayId } from "@/lib/mlb/playVideo";

const FASTBALL_CLIPS_BASE = "https://fastball-clips.mlb.com";
const FILMROOM_GATEWAY = "https://fastball-gateway.mlb.com/graphql";

const BROWSER_HEADERS: HeadersInit = {
  Accept: "*/*",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Origin: "https://www.mlb.com",
  Referer: "https://www.mlb.com/",
};

export type FastballFeed = "home" | "away";

export interface FastballResolvedClip {
  playId: string;
  gamePk: number;
  feed: FastballFeed;
  url: string;
  title: string | null;
}

export function fastballClipUrl(
  gamePk: number,
  playId: string,
  feed: FastballFeed = "home",
): string {
  return `${FASTBALL_CLIPS_BASE}/${gamePk}/${feed}/${playId}.mp4`;
}

/** Browser-playable URL — proxies Fastball CDN (hotlink-protected for non-MLB origins). */
export function proxiedFastballClipUrl(
  gamePk: number,
  playId: string,
  feed: FastballFeed = "home",
): string {
  const params = new URLSearchParams({
    gamePk: String(gamePk),
    playId,
    feed,
  });
  return `/api/plays/video/stream?${params.toString()}`;
}

/** Rewrite a direct fastball-clips URL to our same-origin stream proxy. */
export function toPlayableClipUrl(url: string): string {
  const match = url.match(
    /fastball-clips\.mlb\.com\/(\d+)\/(home|away)\/([0-9a-f-]{36})\.mp4/i,
  );
  if (!match) return url;
  return proxiedFastballClipUrl(Number(match[1]), match[3], match[2].toLowerCase() as FastballFeed);
}

/** Cheap existence check — Range GET for the ISO BMFF `ftyp` header. */
export async function probeFastballClipUrl(
  url: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        ...BROWSER_HEADERS,
        Range: "bytes=0-31",
      },
      signal,
      cache: "no-store",
    });
    if (!(response.ok || response.status === 206)) return false;
    const contentType = response.headers.get("content-type") ?? "";
    // Hotlink protection often returns 200 text/html instead of video.
    if (contentType.includes("text/html") || contentType.includes("text/plain")) {
      return false;
    }
    if (contentType.includes("video/")) return true;
    const bytes = new Uint8Array(await response.arrayBuffer());
    // MP4/ISOBMFF: bytes 4..8 === "ftyp"
    return (
      bytes.length >= 8 &&
      bytes[4] === 0x66 &&
      bytes[5] === 0x74 &&
      bytes[6] === 0x79 &&
      bytes[7] === 0x70
    );
  } catch {
    return false;
  }
}

/**
 * Gameday-style clips: MLB publishes progressive MP4s at a stable path almost
 * immediately after the pitch/PA. Prefer HOME, then AWAY.
 */
export async function resolveFastballClip(
  gamePk: number,
  playIds: string[],
  signal?: AbortSignal,
): Promise<FastballResolvedClip | null> {
  if (!Number.isFinite(gamePk) || gamePk <= 0) return null;

  const ids = playIds.filter(isValidPlayId);
  for (const playId of ids) {
    for (const feed of ["home", "away"] as const) {
      const url = fastballClipUrl(gamePk, playId, feed);
      if (await probeFastballClipUrl(url, signal)) {
        return {
          playId,
          gamePk,
          feed,
          url: proxiedFastballClipUrl(gamePk, playId, feed),
          title: null,
        };
      }
    }
  }
  return null;
}

const FILMROOM_SEARCH_QUERY = `query Search($query: String!, $page: Int, $limit: Int, $languagePreference: LanguagePreference, $contentPreference: ContentPreference, $queryType: QueryType = STRUCTURED) {
  search(query: $query, limit: $limit, page: $page, languagePreference: $languagePreference, contentPreference: $contentPreference, queryType: $queryType) {
    plays {
      mediaPlayback {
        id
        title
        feeds {
          type
          playbacks { name url }
        }
      }
    }
    total
  }
}`;

interface FilmroomSearchResponse {
  data?: {
    search?: {
      total?: number;
      plays?: Array<{
        mediaPlayback?: Array<{
          id?: string;
          title?: string;
          feeds?: Array<{
            type?: string;
            playbacks?: Array<{ name?: string; url?: string }>;
          }>;
        }>;
      }>;
    };
  };
}

/** GraphQL fallback when the deterministic CDN path is not warm yet. */
export async function resolveFilmroomClipByPlayId(
  playId: string,
  signal?: AbortSignal,
): Promise<FastballResolvedClip | null> {
  if (!isValidPlayId(playId)) return null;

  const variables = {
    query: `PlayId = ["${playId}"] Order By Timestamp DESC`,
    limit: 3,
    page: 0,
    languagePreference: "EN",
    contentPreference: "CMS_FIRST",
    queryType: "STRUCTURED",
  };

  const url =
    `${FILMROOM_GATEWAY}?query=${encodeURIComponent(FILMROOM_SEARCH_QUERY)}` +
    `&operationName=Search&variables=${encodeURIComponent(JSON.stringify(variables))}`;

  try {
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as FilmroomSearchResponse;
    const playback = data.data?.search?.plays?.[0]?.mediaPlayback?.[0];
    if (!playback) return null;

    const feeds = playback.feeds ?? [];
    const ordered = [
      ...feeds.filter((feed) => (feed.type ?? "").toUpperCase() === "HOME"),
      ...feeds.filter((feed) => (feed.type ?? "").toUpperCase() === "AWAY"),
      ...feeds,
    ];

    for (const feed of ordered) {
      for (const pb of feed.playbacks ?? []) {
        const clipUrl = pb.url?.trim();
        if (!clipUrl) continue;
        if (pb.name === "mp4Avc" || clipUrl.endsWith(".mp4")) {
          const feedName: FastballFeed =
            (feed.type ?? "").toUpperCase() === "AWAY" ? "away" : "home";
          const gamePkMatch = clipUrl.match(/fastball-clips\.mlb\.com\/(\d+)\//);
          const gamePk = gamePkMatch ? Number(gamePkMatch[1]) : 0;
          return {
            playId,
            gamePk,
            feed: feedName,
            url: toPlayableClipUrl(clipUrl),
            title: playback.title ?? null,
          };
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}
