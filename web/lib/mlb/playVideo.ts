import type { PlayByPlayEntry, PlayDetail } from "@/types/mlb-live";

export const SAVANT_SPORTY_VIDEOS_BASE = "https://baseballsavant.mlb.com/sporty-videos";

export const SPORTY_CLIP_MP4_RE =
  /https:\/\/sporty-clips\.mlb\.com\/[A-Za-z0-9+/=_-]+\.mp4/g;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function savantSportyVideosUrl(playId: string): string {
  return `${SAVANT_SPORTY_VIDEOS_BASE}?playId=${encodeURIComponent(playId)}`;
}

export function isValidPlayId(playId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    playId.trim(),
  );
}

export interface ResolvedPlayVideo {
  playId: string;
  url: string;
  title: string | null;
  savantUrl: string;
}

export function extractSportyClipMp4(html: string): string | null {
  const matches = html.match(SPORTY_CLIP_MP4_RE);
  return matches?.[0] ?? null;
}

export function extractSportyVideoTitle(html: string): string | null {
  const match = html.match(/<title>([^<]+)<\/title>/i);
  if (!match?.[1]) return null;
  return match[1]
    .replace(/\s*\|\s*Baseball Savant Videos.*$/i, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .trim();
}

export async function fetchSavantSportyVideoHtml(playId: string): Promise<string> {
  const response = await fetch(savantSportyVideosUrl(playId), {
    headers: {
      Accept: "text/html",
      "User-Agent": BROWSER_UA,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Savant sporty-videos failed: ${response.status}`);
  }
  return response.text();
}

export async function resolvePlayVideo(playId: string): Promise<ResolvedPlayVideo | null> {
  const html = await fetchSavantSportyVideoHtml(playId);
  const url = extractSportyClipMp4(html);
  if (!url) return null;
  return {
    playId,
    url,
    title: extractSportyVideoTitle(html),
    savantUrl: savantSportyVideosUrl(playId),
  };
}

/** Map of atBatIndex → terminal playId from a raw MLB feed. */
export function extractPlayIdMapFromFeed(feed: {
  liveData?: {
    plays?: {
      allPlays?: Array<{
        about?: { atBatIndex?: number };
        playEvents?: Array<{ playId?: string }>;
      }>;
    };
  };
}): Record<string, string> {
  const map: Record<string, string> = {};
  const allPlays = feed.liveData?.plays?.allPlays ?? [];

  for (const play of allPlays) {
    const atBatIndex = play.about?.atBatIndex;
    if (atBatIndex == null) continue;
    const events = play.playEvents ?? [];
    let playId: string | undefined;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const id = events[i]?.playId;
      if (id) {
        playId = id;
        break;
      }
    }
    if (playId) {
      map[String(atBatIndex)] = playId;
    }
  }

  return map;
}

export function playsNeedPlayIdEnrichment(plays: PlayByPlayEntry[]): boolean {
  return plays.some(
    (play) =>
      play.isAtBat !== false &&
      !play.playId &&
      !play.detail?.playId,
  );
}

export function mergePlayIdsOntoPlays(
  plays: PlayByPlayEntry[],
  playIdByAtBat: Record<string, string> | Map<number, string> | null | undefined,
): PlayByPlayEntry[] {
  if (!playIdByAtBat) return plays;

  const lookup = (atBatIndex: number): string | undefined => {
    if (playIdByAtBat instanceof Map) return playIdByAtBat.get(atBatIndex);
    return playIdByAtBat[String(atBatIndex)] ?? playIdByAtBat[atBatIndex as unknown as string];
  };

  let changed = false;
  const next = plays.map((play) => {
    // Never stamp the at-bat terminal GUID onto non-PA rows (timeouts, mound visits, etc.).
    if (play.isAtBat === false) return play;
    const existing = play.playId ?? play.detail?.playId;
    if (existing) return play;
    const playId = lookup(play.atBatIndex);
    if (!playId) return play;
    changed = true;
    const detail: PlayDetail = { ...play.detail, playId };
    return { ...play, playId, detail };
  });

  return changed ? next : plays;
}

export function playHasVideo(play: Pick<PlayByPlayEntry, "playId" | "detail" | "isAtBat">): boolean {
  if (play.isAtBat === false) return false;
  return Boolean(play.playId ?? play.detail?.playId);
}

/** Non-plate-appearance actions that should never be treated as clip rows. */
const NON_VIDEO_GAME_EVENT_RE =
  /mound visit|batter timeout|pickoff attempt|step\s*off|stepoff|substitution|ejection|timeout|warmup|advisory|challenge|review/i;

export function isVideoEligiblePlay(play: PlayByPlayEntry): boolean {
  const playId = play.playId ?? play.detail?.playId;
  if (!playId) return false;
  if (play.isAtBat === false) {
    return !NON_VIDEO_GAME_EVENT_RE.test(`${play.event} ${play.description}`);
  }
  return true;
}

/**
 * One card per Savant clip. Prefers hits, then scoring plays, then plate appearances.
 */
export function uniqueHighlightPlays(plays: PlayByPlayEntry[]): PlayByPlayEntry[] {
  const byPlayId = new Map<string, PlayByPlayEntry>();

  const rank = (play: PlayByPlayEntry): number => {
    let score = 0;
    if (play.isAtBat !== false) score += 4;
    if (play.isScoringPlay) score += 2;
    if (/^(Single|Double|Triple|Home Run)$/.test(play.event)) score += 3;
    return score;
  };

  for (const play of plays) {
    if (!isVideoEligiblePlay(play)) continue;
    const playId = play.playId ?? play.detail.playId;
    if (!playId) continue;
    const existing = byPlayId.get(playId);
    if (!existing || rank(play) > rank(existing)) {
      byPlayId.set(playId, play);
    }
  }

  return [...byPlayId.values()].sort((a, b) => {
    const aHit = /^(Single|Double|Triple|Home Run)$/.test(a.event);
    const bHit = /^(Single|Double|Triple|Home Run)$/.test(b.event);
    if (aHit !== bHit) return aHit ? -1 : 1;
    return a.atBatIndex - b.atBatIndex;
  });
}
