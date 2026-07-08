import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { NerdStatHistory } from "@/lib/mlb/nerdStats/history";
import {
  listStoredHistoryStatIds,
  loadNerdStatHistory,
  maxStoredHistoryDateCount,
  writeNerdStatHistory,
} from "@/lib/mlb/nerdStats/historyStore";

const TEST_SEASON = 2099;

function historyDir(): string {
  return join(process.cwd(), "data", "nerd-stats", String(TEST_SEASON), "history");
}

function writeFixture(statId: string, dates: string[]): void {
  const history: NerdStatHistory = {
    season: TEST_SEASON,
    statId,
    dates,
    splits: {
      all: { teams: {} },
      home: { teams: {} },
      away: { teams: {} },
    },
    generatedAt: "2026-01-01T00:00:00.000Z",
  };
  writeNerdStatHistory(TEST_SEASON, history);
}

describe("historyStore", () => {
  afterEach(() => {
    const dir = historyDir();
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("returns the longest stored date axis length", () => {
    mkdirSync(historyDir(), { recursive: true });
    writeFixture("walk-off-wins", ["2026-04-01", "2026-04-02"]);
    writeFixture("runs-scored", ["2026-04-01", "2026-04-02", "2026-04-03"]);

    expect(maxStoredHistoryDateCount(TEST_SEASON)).toBe(3);
    expect(listStoredHistoryStatIds(TEST_SEASON).sort()).toEqual(["runs-scored", "walk-off-wins"]);
    expect(loadNerdStatHistory(TEST_SEASON, "runs-scored")?.dates).toHaveLength(3);
  });

  it("returns 0 when no history files exist", () => {
    expect(maxStoredHistoryDateCount(TEST_SEASON)).toBe(0);
  });
});
