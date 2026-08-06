import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { listJsonBasenames, readDataJson } from "@/lib/dataFile";
import type { NerdStatHistory } from "@/lib/mlb/nerdStats/history";
import { resolveNerdStatId } from "@/lib/mlb/nerdStats/statDefinitions";

function historyDir(season: number): string {
  return join(process.cwd(), "data", "nerd-stats", String(season), "history");
}

function historyPath(season: number, statId: string): string {
  return join(historyDir(season), `${statId}.json`);
}

export function writeNerdStatHistory(season: number, history: NerdStatHistory): void {
  const dir = historyDir(season);
  mkdirSync(dir, { recursive: true });
  writeFileSync(historyPath(season, history.statId), `${JSON.stringify(history)}\n`, "utf8");
}

export function writeNerdStatHistories(
  season: number,
  histories: Iterable<NerdStatHistory>,
): number {
  let count = 0;
  for (const history of histories) {
    writeNerdStatHistory(season, history);
    count += 1;
  }
  return count;
}

export function loadNerdStatHistory(season: number, statId: string): NerdStatHistory | null {
  return readDataJson<NerdStatHistory>(historyPath(season, resolveNerdStatId(statId)));
}

export function listStoredHistoryStatIds(season: number): string[] {
  return listJsonBasenames(historyDir(season));
}

/** Longest date axis among stored history files for a season (0 when none). */
export function maxStoredHistoryDateCount(season: number): number {
  let max = 0;
  for (const statId of listStoredHistoryStatIds(season)) {
    const history = loadNerdStatHistory(season, statId);
    if (history && history.dates.length > max) max = history.dates.length;
  }
  return max;
}
