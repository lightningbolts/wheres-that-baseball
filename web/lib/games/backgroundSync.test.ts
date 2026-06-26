import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetBackgroundSlateSyncForTest,
  scheduleBackgroundSlateSync,
} from "@/lib/games/backgroundSync";

vi.mock("@/lib/games/scheduleSync", () => ({
  syncScheduleDates: vi.fn().mockResolvedValue({ synced: 1 }),
}));

vi.mock("@/lib/games/reconcileFeeds", () => ({
  reconcileFinalFeedsForGames: vi.fn().mockResolvedValue(undefined),
}));

describe("scheduleBackgroundSlateSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBackgroundSlateSyncForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetBackgroundSlateSyncForTest();
  });

  it("debounces follow-up calls within the window", async () => {
    const { syncScheduleDates } = await import("@/lib/games/scheduleSync");

    scheduleBackgroundSlateSync("2026-06-26", [{ game_pk: 1, status: "Final" }]);
    await Promise.resolve();
    expect(syncScheduleDates).toHaveBeenCalledTimes(1);

    scheduleBackgroundSlateSync("2026-06-26", [{ game_pk: 2, status: "Final" }]);
    expect(syncScheduleDates).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(syncScheduleDates).toHaveBeenCalledTimes(2);
  });
});
