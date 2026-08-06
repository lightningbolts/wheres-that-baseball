import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { dataFileExists, readDataJson } from "@/lib/dataFile";
import type { GameNerdSourceRow } from "@/lib/mlb/nerdStats/types";

/** Local-only game_state archive for zero-egress counter backfills (not committed). */
function sourcesDir(season: number): string {
  return join(process.cwd(), "data", "nerd-stats-local", String(season), "sources");
}

function sourcePath(season: number, gamePk: number): string {
  return join(sourcesDir(season), `${gamePk}.json`);
}

export function writeGameSourceRow(season: number, row: GameNerdSourceRow): void {
  const dir = sourcesDir(season);
  mkdirSync(dir, { recursive: true });
  writeFileSync(sourcePath(season, row.game_pk), `${JSON.stringify(row)}\n`, "utf8");
}

export function loadGameSourceRow(season: number, gamePk: number): GameNerdSourceRow | null {
  return readDataJson<GameNerdSourceRow>(sourcePath(season, gamePk));
}

export function hasGameSourceRow(season: number, gamePk: number): boolean {
  return dataFileExists(sourcePath(season, gamePk));
}
