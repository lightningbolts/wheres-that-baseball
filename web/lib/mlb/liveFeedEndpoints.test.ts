import { describe, expect, it } from "vitest";

import {
  MLB_LIVE_FEED_SUPPORTS_PARTIAL_HYDRATE,
  mlbLiveFeedUrl,
} from "@/lib/mlb/liveFeedEndpoints";
import { SCHEDULE_HYDRATE } from "@/lib/mlb/scheduleApi";

describe("liveFeedEndpoints", () => {
  it("documents no partial hydrate on live feed", () => {
    expect(MLB_LIVE_FEED_SUPPORTS_PARTIAL_HYDRATE).toBe(false);
  });

  it("builds live feed URL", () => {
    expect(mlbLiveFeedUrl(776123)).toBe(
      "https://statsapi.mlb.com/api/v1.1/game/776123/feed/live",
    );
  });
});

describe("schedule hydrate contract", () => {
  it("exposes slate and row presets", () => {
    expect(SCHEDULE_HYDRATE.slate).toContain("probablePitcher");
    expect(SCHEDULE_HYDRATE.row).toContain("venue");
  });
});
