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

/**
 * CDN feed folders under fastball-clips.mlb.com/{gamePk}/{feed}/.
 * Regional / MLB.TV games publish `home` + `away`; national-only
 * telecasts (FOX, ESPN, etc.) publish `network` instead.
 */
export type FastballFeed = "home" | "away" | "network";

/** Probe order: regional feeds first, then national. */
export const FASTBALL_FEED_ORDER: readonly FastballFeed[] = [
  "home",
  "away",
  "network",
];

export function isFastballFeed(value: string | null | undefined): value is FastballFeed {
  return value === "home" || value === "away" || value === "network";
}

export interface FastballResolvedClip {
  playId: string;
  gamePk: number;
  feed: FastballFeed;
  /** All broadcast angles that exist for this play on the CDN / Film Room. */
  availableFeeds: FastballFeed[];
  url: string;
  title: string | null;
}

/** Prefer a regional home feed, then away, then national. */
export function preferFastballFeed(feeds: readonly FastballFeed[]): FastballFeed | null {
  if (feeds.includes("home")) return "home";
  if (feeds.includes("away")) return "away";
  if (feeds.includes("network")) return "network";
  return null;
}

/** True when both regional broadcasts exist (show a Home/Away picker). */
export function hasRegionalFeedChoice(feeds: readonly FastballFeed[] | null | undefined): boolean {
  if (!feeds?.length) return false;
  return feeds.includes("home") && feeds.includes("away");
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
  // Path-keyed so HTTP caches cannot reuse one play's MP4 for another playId.
  // (Query-only URLs previously collapsed to the first clip loaded in a session.)
  return `/api/plays/video/stream/${gamePk}/${feed}/${encodeURIComponent(playId)}`;
}

/** Rewrite a direct fastball-clips URL — or a legacy query proxy URL — to the path proxy. */
export function toPlayableClipUrl(url: string): string {
  const cdn = url.match(
    /fastball-clips\.mlb\.com\/(\d+)\/(home|away|network)\/([0-9a-f-]{36})\.mp4/i,
  );
  if (cdn) {
    return proxiedFastballClipUrl(
      Number(cdn[1]),
      cdn[3],
      cdn[2].toLowerCase() as FastballFeed,
    );
  }

  const legacy = url.match(
    /\/api\/plays\/video\/stream\/?\?([^#]*)/i,
  );
  if (legacy) {
    const params = new URLSearchParams(legacy[1]);
    const gamePk = Number(params.get("gamePk"));
    const playId = params.get("playId")?.trim() ?? "";
    const feedRaw = params.get("feed")?.trim().toLowerCase() ?? "home";
    if (
      Number.isFinite(gamePk) &&
      gamePk > 0 &&
      isValidPlayId(playId) &&
      isFastballFeed(feedRaw)
    ) {
      return proxiedFastballClipUrl(gamePk, playId, feedRaw);
    }
  }

  return url;
}

/** Extract playId from a proxied Fastball stream URL (path or legacy query). */
export function playIdFromPlayableClipUrl(url: string): string | null {
  const path = url.match(
    /\/api\/plays\/video\/stream\/\d+\/(?:home|away|network)\/([0-9a-f-]{36})/i,
  );
  if (path?.[1] && isValidPlayId(path[1])) return path[1];

  const query = url.match(/[?&]playId=([0-9a-f-]{36})/i);
  if (query?.[1] && isValidPlayId(query[1])) return query[1];

  const cdn = url.match(
    /fastball-clips\.mlb\.com\/\d+\/(?:home|away|network)\/([0-9a-f-]{36})\.mp4/i,
  );
  if (cdn?.[1] && isValidPlayId(cdn[1])) return cdn[1];

  return null;
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

/** Probe which Fastball CDN feeds exist for a single play GUID. */
export async function listAvailableFastballFeeds(
  gamePk: number,
  playId: string,
  signal?: AbortSignal,
): Promise<FastballFeed[]> {
  if (!Number.isFinite(gamePk) || gamePk <= 0 || !isValidPlayId(playId)) return [];

  const present = await Promise.all(
    FASTBALL_FEED_ORDER.map(async (feed) => {
      const ok = await probeFastballClipUrl(fastballClipUrl(gamePk, playId, feed), signal);
      return ok ? feed : null;
    }),
  );
  return present.filter((feed): feed is FastballFeed => feed != null);
}

/**
 * Gameday-style clips: MLB publishes progressive MP4s at a stable path almost
 * immediately after the pitch/PA. Prefer HOME, then AWAY, then NETWORK
 * (national-broadcast games often only publish the latter).
 *
 * Only the primary playId is tried first so we don't latch onto an earlier
 * pitch clip from the same PA (or a mismatched candidate GUID).
 */
export async function resolveFastballClip(
  gamePk: number,
  playIds: string[],
  signal?: AbortSignal,
): Promise<FastballResolvedClip | null> {
  if (!Number.isFinite(gamePk) || gamePk <= 0) return null;

  const ids = playIds.filter(isValidPlayId);
  for (const playId of ids) {
    const availableFeeds = await listAvailableFastballFeeds(gamePk, playId, signal);
    const feed = preferFastballFeed(availableFeeds);
    if (!feed) continue;
    return {
      playId,
      gamePk,
      feed,
      availableFeeds,
      url: proxiedFastballClipUrl(gamePk, playId, feed),
      title: null,
    };
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
        playInfo { gamePk }
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
          playInfo?: { gamePk?: number | null };
        }>;
      }>;
    };
  };
}

function feedFromFilmroomType(type: string | null | undefined): FastballFeed | null {
  const normalized = (type ?? "").toUpperCase();
  if (normalized === "HOME") return "home";
  if (normalized === "AWAY") return "away";
  if (normalized === "NETWORK") return "network";
  return null;
}

function mp4FromFilmroomFeed(
  feed: { type?: string; playbacks?: Array<{ name?: string; url?: string }> },
): { feed: FastballFeed; url: string; gamePk: number } | null {
  const feedName = feedFromFilmroomType(feed.type);
  if (!feedName) return null;

  for (const pb of feed.playbacks ?? []) {
    const clipUrl = pb.url?.trim();
    if (!clipUrl) continue;
    if (!(pb.name === "mp4Avc" || clipUrl.endsWith(".mp4"))) continue;
    const gamePkMatch = clipUrl.match(/fastball-clips\.mlb\.com\/(\d+)\//);
    const gamePk = gamePkMatch ? Number(gamePkMatch[1]) : 0;
    if (!Number.isFinite(gamePk) || gamePk <= 0) continue;
    return { feed: feedName, url: clipUrl, gamePk };
  }
  return null;
}

/** GraphQL fallback when the deterministic CDN path is not warm yet. */
export async function resolveFilmroomClipByPlayId(
  playId: string,
  signal?: AbortSignal,
  expectedGamePk?: number | null,
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

    // Film Room media id is the pitch/play GUID — reject cross-play hits.
    const playbackId = playback.id?.trim();
    if (playbackId && isValidPlayId(playbackId) && playbackId !== playId) {
      return null;
    }

    const playInfoGamePk = playback.playInfo?.gamePk ?? null;
    if (
      expectedGamePk != null &&
      expectedGamePk > 0 &&
      playInfoGamePk != null &&
      playInfoGamePk !== expectedGamePk
    ) {
      return null;
    }

    const byFeed = new Map<FastballFeed, { url: string; gamePk: number }>();
    for (const feed of playback.feeds ?? []) {
      const parsed = mp4FromFilmroomFeed(feed);
      if (!parsed) continue;
      if (
        expectedGamePk != null &&
        expectedGamePk > 0 &&
        parsed.gamePk !== expectedGamePk
      ) {
        continue;
      }
      if (!byFeed.has(parsed.feed)) {
        byFeed.set(parsed.feed, { url: parsed.url, gamePk: parsed.gamePk });
      }
    }

    const availableFeeds = FASTBALL_FEED_ORDER.filter((feed) => byFeed.has(feed));
    const feed = preferFastballFeed(availableFeeds);
    if (!feed) return null;
    const selected = byFeed.get(feed);
    if (!selected) return null;

    return {
      playId,
      gamePk: selected.gamePk,
      feed,
      availableFeeds,
      url: toPlayableClipUrl(selected.url),
      title: playback.title ?? null,
    };
  } catch {
    return null;
  }
}
