import { afterEach, describe, expect, it, vi } from "vitest";

import { clearScheduleCache, cachedScheduleFetch } from "@/lib/mlb/scheduleCache";

describe("scheduleCache", () => {
  afterEach(() => {
    clearScheduleCache();
    vi.restoreAllMocks();
  });

  it("returns cached value within TTL", async () => {
    const fetcher = vi.fn().mockResolvedValue(["game-a"]);

    const first = await cachedScheduleFetch("k1", fetcher);
    const second = await cachedScheduleFetch("k1", fetcher);

    expect(first).toEqual(["game-a"]);
    expect(second).toEqual(["game-a"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
