import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { NerdStatHistory } from "@/lib/mlb/nerdStats/history";

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
  const path = historyPath(season, statId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as NerdStatHistory;
}

export function listStoredHistoryStatIds(season: number): string[] {
  const dir = historyDir(season);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""));
}
