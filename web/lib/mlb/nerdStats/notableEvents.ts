import type { NotableNerdEvent } from "@/lib/mlb/nerdStats/types";
import { getNerdStatDefinition } from "@/lib/mlb/nerdStats/statDefinitions";

function dedupeByGame(events: NotableNerdEvent[], sort: "asc" | "desc"): NotableNerdEvent[] {
  const byGame = new Map<number, NotableNerdEvent>();

  for (const event of events) {
    const existing = byGame.get(event.gamePk);
    if (!existing) {
      byGame.set(event.gamePk, event);
      continue;
    }

    if (event.value == null || existing.value == null) {
      if (event.gameDate > existing.gameDate) {
        byGame.set(event.gamePk, event);
      }
      continue;
    }

    const better = sort === "desc" ? event.value > existing.value : event.value < existing.value;
    if (better) {
      byGame.set(event.gamePk, event);
    }
  }

  return [...byGame.values()];
}

export function sortNotableEvents(
  events: NotableNerdEvent[],
  statId: string,
): NotableNerdEvent[] {
  const definition = getNerdStatDefinition(statId);
  const sort = definition?.sort ?? "desc";
  const deduped = dedupeByGame(events, sort);

  const hasValues = deduped.some((event) => event.value != null);
  if (hasValues) {
    deduped.sort((a, b) => {
      if (a.value != null && b.value != null) {
        return sort === "desc" ? b.value - a.value : a.value - b.value;
      }
      if (a.value != null) return -1;
      if (b.value != null) return 1;
      return b.gameDate.localeCompare(a.gameDate);
    });
    return deduped;
  }

  deduped.sort((a, b) => b.gameDate.localeCompare(a.gameDate));
  return deduped;
}
