import type { NerdInsight } from "@/lib/mlb/nerdInsights/types";
import { statThemeKey } from "@/lib/mlb/nerdInsights/types";

/**
 * Mini insights rewrite `id` to `${baseId}-mini-N`. Dedup must always key off the
 * base id, otherwise the late-fetch path regenerates a new mini on every poll.
 */
export function baseInsightId(id: string): string {
  return id.replace(/-mini-\d+$/, "");
}

export function miniOccurrenceCount(id: string): number {
  const match = /-mini-(\d+)$/.exec(id);
  return match ? Number(match[1]) : 1;
}

export function markInsightSeen(
  shownIds: Set<string>,
  baseId: string,
  insightId: string,
): void {
  shownIds.add(baseId);
  shownIds.add(insightId);
}

/** Collapse spam rows that share a base id (keep the highest mini occurrence). */
export function dedupeFeedInsights(insights: NerdInsight[]): NerdInsight[] {
  const bestByBase = new Map<string, NerdInsight>();

  for (const insight of insights) {
    const baseId = baseInsightId(insight.id);
    const existing = bestByBase.get(baseId);
    if (!existing || miniOccurrenceCount(insight.id) >= miniOccurrenceCount(existing.id)) {
      bestByBase.set(baseId, insight);
    }
  }

  const seen = new Set<string>();
  const deduped: NerdInsight[] = [];
  for (const insight of insights) {
    const baseId = baseInsightId(insight.id);
    if (seen.has(baseId)) continue;
    seen.add(baseId);
    deduped.push(bestByBase.get(baseId)!);
  }
  return deduped;
}

export function restoreDedupState(insights: NerdInsight[]) {
  const shownIds = new Set<string>();
  const shownStatIds = new Set<string>();
  const toastedIds = new Set<string>();
  const statOccurrence = new Map<string, number>();

  for (const insight of insights) {
    const baseId = baseInsightId(insight.id);
    markInsightSeen(shownIds, baseId, insight.id);
    toastedIds.add(insight.id);
    toastedIds.add(baseId);
    if (insight.statId != null && (insight.playerId != null || insight.teamId != null)) {
      const themeKey = statThemeKey(insight.statId, insight.teamId ?? 0, insight.playerId);
      shownStatIds.add(themeKey);
      const prior = statOccurrence.get(themeKey) ?? 0;
      statOccurrence.set(themeKey, Math.max(prior + 1, miniOccurrenceCount(insight.id)));
    }
  }

  return { shownIds, shownStatIds, toastedIds, statOccurrence };
}
