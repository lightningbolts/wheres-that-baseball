import { isValidPlayId } from "@/lib/mlb/playVideo";

const MLB_CONTENT_BASE = "https://statsapi.mlb.com/api/v1";

/** Distribution / package tags — only exclude when they are the *sole* signal. */
const DISTRIBUTION_TAXONOMY = new Set([
  "international-feed",
  "eclat-feed",
  "alexa",
  "apple-news",
  "imagen-feed",
  "3-yahoo-ads-feed",
]);

/** Always drop these package types (recaps / condensed games). */
const EXCLUDED_TAXONOMY = new Set([
  "condensed-game",
  "game-recap",
]);

const EXCLUDED_TITLE_RE =
  /lineups?|bench availability|fielding alignment|bullpen availability|probable pitchers|bat tracking|measuring the stats|against the |outing against|breaking down .+ pitches|rain delay|starts in a|visualizing .+ swing/i;

const PLAY_SIGNAL_TAXONOMY = new Set([
  "in-game-highlight",
  "game-action-tracking",
  "game-story-highlight",
  "highlight",
  "abs",
  "home-run",
  "highlight-reel-offense",
  "highlight-reel-defense",
]);

export interface MlbContentPlayback {
  name?: string;
  url?: string;
}

export interface MlbContentKeyword {
  type?: string;
  value?: string;
  displayName?: string;
}

export interface MlbContentHighlightItem {
  type?: string;
  state?: string;
  date?: string;
  id?: string;
  guid?: string | null;
  headline?: string;
  title?: string;
  blurb?: string;
  description?: string;
  mediaPlaybackId?: string;
  playbacks?: MlbContentPlayback[];
  keywordsAll?: MlbContentKeyword[];
  image?: {
    title?: string | null;
    templateUrl?: string;
    cuts?: Array<{ width?: number; height?: number; src?: string }>;
  };
}

export interface MlbGameContentResponse {
  highlights?: {
    highlights?: {
      items?: MlbContentHighlightItem[];
    };
  };
}

export interface GameHighlightClip {
  id: string;
  playId: string | null;
  title: string;
  description: string | null;
  url: string;
  thumbnailUrl: string | null;
  date: string | null;
}

export function mlbGameContentUrl(gamePk: number): string {
  return `${MLB_CONTENT_BASE}/game/${gamePk}/content`;
}

/**
 * StatsAPI content often ships broadcast clips as HLS-only. Diamond forge assets
 * also publish progressive MP4s at a stable suffix we can derive.
 */
export function mp4UrlFromForgeHls(url: string): string | null {
  const trimmed = url.trim();
  if (!/mlb-cuts-diamond\.mlb\.com\/FORGE\//i.test(trimmed)) return null;
  if (!trimmed.includes(".m3u8")) return null;
  const withoutQuery = trimmed.split("?")[0] ?? trimmed;
  const base = withoutQuery.replace(/\.m3u8$/i, "");
  // Prefer the 4Mbps 720p progressive cut (verified available for 2026 forge assets).
  return `${base}_1280x720_59_4000K.mp4`;
}

/** Prefer a progressive MP4 for `<video src>` (works without HLS). */
export function pickHighlightMp4Url(playbacks: MlbContentPlayback[] | undefined): string | null {
  if (!playbacks?.length) return null;

  const scored = playbacks
    .map((playback) => {
      const url = playback.url?.trim();
      if (!url) return null;
      const name = (playback.name ?? "").toLowerCase();
      let score = 0;
      if (name === "mp4avc") score = 100;
      else if (name.includes("mp4") || name === "highbit") score = 80;
      else if (url.endsWith(".mp4")) score = 70;
      else if (name.includes("hls") || url.includes(".m3u8")) score = 10;
      else score = 20;
      return { url, score, name };
    })
    .filter((row): row is { url: string; score: number; name: string } => row != null);

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);

  const bestMp4 = scored.find((row) => row.score >= 70);
  if (bestMp4) return bestMp4.url;

  // HLS-only Content items (common for broadcast HR clips) → derive forge MP4.
  for (const row of scored) {
    const derived = mp4UrlFromForgeHls(row.url);
    if (derived) return derived;
  }

  return null;
}

export function pickHighlightThumbnail(
  image: MlbContentHighlightItem["image"] | undefined,
): string | null {
  if (!image) return null;
  const cuts = image.cuts ?? [];
  if (cuts.length > 0) {
    const sorted = [...cuts].sort(
      (a, b) => (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0),
    );
    // Prefer a mid-size cut (~640w) for gallery posters on slow links.
    const mid =
      sorted.find((cut) => (cut.width ?? 0) >= 640) ??
      sorted.find((cut) => (cut.width ?? 0) >= 320) ??
      sorted[Math.floor(sorted.length / 2)];
    if (mid?.src) return mid.src;
  }
  if (image.templateUrl) {
    return image.templateUrl.replace("{formatInstructions}", "w_640,h_360,c_fill,q_auto:eco,f_auto");
  }
  return null;
}

function taxonomyValues(item: MlbContentHighlightItem): Set<string> {
  const values = new Set<string>();
  for (const keyword of item.keywordsAll ?? []) {
    if (keyword.type === "taxonomy" && keyword.value) {
      values.add(keyword.value.toLowerCase());
    }
  }
  return values;
}

export function isPlayHighlightItem(item: MlbContentHighlightItem): boolean {
  if (item.type !== "video") return false;
  if (!pickHighlightMp4Url(item.playbacks)) return false;

  const title = (item.headline || item.title || item.blurb || "").trim();
  if (EXCLUDED_TITLE_RE.test(title)) return false;

  const tax = taxonomyValues(item);
  for (const excluded of EXCLUDED_TAXONOMY) {
    if (tax.has(excluded)) return false;
  }

  const playId = item.guid?.trim() ?? "";
  if (playId && isValidPlayId(playId)) return true;

  for (const signal of PLAY_SIGNAL_TAXONOMY) {
    if (tax.has(signal)) return true;
  }

  // Distribution-only tags without a play signal are editorial packages.
  const nonDistribution = [...tax].filter((value) => !DISTRIBUTION_TAXONOMY.has(value));
  return nonDistribution.length > 0 && !title.toLowerCase().includes("availability");
}

export function parseGameHighlightClips(
  content: MlbGameContentResponse | null | undefined,
): GameHighlightClip[] {
  const items = content?.highlights?.highlights?.items ?? [];
  const clips: GameHighlightClip[] = [];
  const seenUrls = new Set<string>();

  for (const item of items) {
    if (!isPlayHighlightItem(item)) continue;
    const url = pickHighlightMp4Url(item.playbacks);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);

    const playIdRaw = item.guid?.trim() ?? "";
    const playId = playIdRaw && isValidPlayId(playIdRaw) ? playIdRaw : null;
    const title = (item.headline || item.title || item.blurb || "Play highlight").trim();

    clips.push({
      id: item.id || playId || url,
      playId,
      title,
      description: item.description?.trim() || item.blurb?.trim() || null,
      url,
      thumbnailUrl: pickHighlightThumbnail(item.image),
      date: item.date ?? null,
    });
  }

  clips.sort((a, b) => {
    const aTime = a.date ? Date.parse(a.date) : 0;
    const bTime = b.date ? Date.parse(b.date) : 0;
    return aTime - bTime;
  });

  return clips;
}

/** playId → direct MP4 URL from game content (live-friendly; skips Savant). */
export function highlightUrlByPlayId(clips: GameHighlightClip[]): Map<string, GameHighlightClip> {
  const map = new Map<string, GameHighlightClip>();
  for (const clip of clips) {
    if (!clip.playId) continue;
    if (!map.has(clip.playId)) map.set(clip.playId, clip);
  }
  return map;
}

export async function fetchMlbGameContent(
  gamePk: number,
  signal?: AbortSignal,
): Promise<MlbGameContentResponse> {
  const response = await fetch(mlbGameContentUrl(gamePk), {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`MLB game content failed: ${response.status}`);
  }
  return (await response.json()) as MlbGameContentResponse;
}

interface ClipsCacheEntry {
  clips: GameHighlightClip[];
  expiresAt: number;
}

const clipsCache = new Map<number, ClipsCacheEntry>();
const clipsInflight = new Map<number, Promise<GameHighlightClip[]>>();
const CLIPS_TTL_MS = 45 * 1000;

export async function fetchGameHighlightClips(
  gamePk: number,
  signal?: AbortSignal,
): Promise<GameHighlightClip[]> {
  const cached = clipsCache.get(gamePk);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.clips;
  }

  const pending = clipsInflight.get(gamePk);
  if (pending) return pending;

  const promise = (async () => {
    const content = await fetchMlbGameContent(gamePk, signal);
    const clips = parseGameHighlightClips(content);
    clipsCache.set(gamePk, { clips, expiresAt: Date.now() + CLIPS_TTL_MS });
    return clips;
  })().finally(() => {
    clipsInflight.delete(gamePk);
  });

  clipsInflight.set(gamePk, promise);
  return promise;
}

/** Look up a Content MP4 by play GUID without scraping Savant. */
export async function resolveHighlightByPlayId(
  gamePk: number,
  playId: string,
  signal?: AbortSignal,
): Promise<GameHighlightClip | null> {
  return resolveHighlightByPlayIds(gamePk, [playId], signal);
}

/** Match any of several pitch GUIDs from the same PA (Content often keys the in-play pitch). */
export async function resolveHighlightByPlayIds(
  gamePk: number,
  playIds: string[],
  signal?: AbortSignal,
): Promise<GameHighlightClip | null> {
  const wanted = new Set(playIds.filter((id) => isValidPlayId(id)));
  if (wanted.size === 0) return null;

  const clips = await fetchGameHighlightClips(gamePk, signal);
  const matched = clips.find((clip) => clip.playId && wanted.has(clip.playId));
  if (matched) return matched;

  // Content list can lag the item map — re-fetch raw content and match guids directly,
  // including forge-derived MP4s that the list parser already understands.
  try {
    const content = await fetchMlbGameContent(gamePk, signal);
    for (const item of content.highlights?.highlights?.items ?? []) {
      const guid = item.guid?.trim() ?? "";
      if (!guid || !wanted.has(guid)) continue;

      let url = pickHighlightMp4Url(item.playbacks);
      if (!url) {
        url = await fetchDataServiceMp4(item.id || item.mediaPlaybackId);
      }
      if (!url) continue;

      return {
        id: item.id || guid,
        playId: guid,
        title: (item.headline || item.title || "Play highlight").trim(),
        description: item.description?.trim() || item.blurb?.trim() || null,
        url,
        thumbnailUrl: pickHighlightThumbnail(item.image),
        date: item.date ?? null,
      };
    }
  } catch {
    // best-effort
  }

  return null;
}

async function fetchDataServiceMp4(
  slugOrId: string | null | undefined,
): Promise<string | null> {
  if (!slugOrId) return null;
  try {
    const response = await fetch(
      `https://www.mlb.com/data-service/en/videos/${encodeURIComponent(slugOrId)}`,
      { headers: { Accept: "application/json" }, cache: "no-store" },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { playbacks?: MlbContentPlayback[] };
    return pickHighlightMp4Url(data.playbacks);
  } catch {
    return null;
  }
}
