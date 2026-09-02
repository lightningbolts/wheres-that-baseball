import { describe, expect, it } from "vitest";

import {
  MLB_LIVE_FEED_HOT_FIELDS,
  MLB_LIVE_FEED_SUPPORTS_PARTIAL_HYDRATE,
  mlbLiveFeedDiffPatchUrl,
  mlbLiveFeedFieldsUrl,
  mlbLiveFeedTimestampsUrl,
  mlbLiveFeedUrl,
} from "@/lib/mlb/liveFeedEndpoints";
import { SCHEDULE_HYDRATE } from "@/lib/mlb/scheduleApi";

describe("liveFeedEndpoints", () => {
  it("documents no usable partial hydrate on live feed", () => {
    expect(MLB_LIVE_FEED_SUPPORTS_PARTIAL_HYDRATE).toBe(false);
  });

  it("builds live feed URL", () => {
    expect(mlbLiveFeedUrl(776123)).toBe(
      "https://statsapi.mlb.com/api/v1.1/game/776123/feed/live",
    );
  });

  it("builds fields, timestamps, and diffPatch URLs", () => {
    expect(mlbLiveFeedFieldsUrl(776123)).toBe(
      `https://statsapi.mlb.com/api/v1.1/game/776123/feed/live?fields=${encodeURIComponent(MLB_LIVE_FEED_HOT_FIELDS)}`,
    );
    expect(mlbLiveFeedTimestampsUrl(776123)).toBe(
      "https://statsapi.mlb.com/api/v1.1/game/776123/feed/live/timestamps",
    );
    expect(mlbLiveFeedDiffPatchUrl(776123, "20260902_020807")).toBe(
      "https://statsapi.mlb.com/api/v1.1/game/776123/feed/live/diffPatch?startTimecode=20260902_020807",
    );
  });
});

describe("schedule hydrate contract", () => {
  it("exposes slate and row presets", () => {
    expect(SCHEDULE_HYDRATE.slate).toContain("probablePitcher");
    expect(SCHEDULE_HYDRATE.row).toContain("venue");
  });
});
