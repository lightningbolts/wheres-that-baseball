import type { NerdInsight } from "@/lib/mlb/nerdInsights/types";

const STORAGE_PREFIX = "nerd-insights-feed:";
const MAX_AGE_MS = 1000 * 60 * 60 * 18; // keep through a long doubleheader day

interface StoredFeedInsights {
  gamePk: number;
  updatedAt: number;
  insights: NerdInsight[];
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function nerdInsightsFeedStorageKey(gamePk: number): string {
  return `${STORAGE_PREFIX}${gamePk}`;
}

export function loadNerdInsightsFeed(gamePk: number): NerdInsight[] {
  const localStorage = storage();
  if (!localStorage) return [];
  try {
    const raw = localStorage.getItem(nerdInsightsFeedStorageKey(gamePk));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredFeedInsights;
    if (parsed.gamePk !== gamePk || !Array.isArray(parsed.insights)) return [];
    if (Date.now() - (parsed.updatedAt ?? 0) > MAX_AGE_MS) {
      localStorage.removeItem(nerdInsightsFeedStorageKey(gamePk));
      return [];
    }
    return parsed.insights.filter(
      (insight): insight is NerdInsight =>
        Boolean(insight) &&
        typeof insight.id === "string" &&
        insight.anchor != null,
    );
  } catch {
    return [];
  }
}

export function saveNerdInsightsFeed(gamePk: number, insights: NerdInsight[]): void {
  const localStorage = storage();
  if (!localStorage) return;
  try {
    const payload: StoredFeedInsights = {
      gamePk,
      updatedAt: Date.now(),
      insights,
    };
    localStorage.setItem(nerdInsightsFeedStorageKey(gamePk), JSON.stringify(payload));
  } catch {
    // Quota / private mode — feed still works for the current session.
  }
}

export function clearNerdInsightsFeed(gamePk: number): void {
  const localStorage = storage();
  if (!localStorage) return;
  try {
    localStorage.removeItem(nerdInsightsFeedStorageKey(gamePk));
  } catch {
    // ignore
  }
}
