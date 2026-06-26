import { afterEach, describe, expect, it, vi } from "vitest";

import { clearStatsCache, cachedStatsFetch } from "@/lib/mlb/statsCache";

describe("statsCache", () => {
  afterEach(() => {
    clearStatsCache();
    vi.restoreAllMocks();
  });

  it("deduplicates stats fetches by key", async () => {
    const fetcher = vi.fn().mockResolvedValue({ avg: ".300" });

    await cachedStatsFetch(["matchup", "1", "2"], fetcher);
    await cachedStatsFetch(["matchup", "1", "2"], fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
