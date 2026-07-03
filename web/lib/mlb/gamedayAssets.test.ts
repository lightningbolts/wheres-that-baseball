import { describe, expect, it } from "vitest";

import {
  GAMEDAY_STADIUM_HEIGHT,
  GAMEDAY_STADIUM_WIDTH,
  gamedayStadiumCdnUrl,
  gamedayStadiumProxyUrl,
} from "@/lib/mlb/gamedayAssets";

describe("gameday stadium frame", () => {
  it("matches the native @2x JPEG aspect ratio", () => {
    expect(GAMEDAY_STADIUM_WIDTH / GAMEDAY_STADIUM_HEIGHT).toBeCloseTo(193 / 74, 2);
  });
});

describe("gamedayStadiumCdnUrl", () => {
  it("builds the prod-gameday night stadium URL for a venue", () => {
    expect(gamedayStadiumCdnUrl(4705)).toBe(
      "https://prod-gameday.mlbstatic.com/responsive-gameday-assets/1.3.0/images/stadiums/night/4705@2x.jpg",
    );
  });

  it("falls back to default when venue is missing", () => {
    expect(gamedayStadiumCdnUrl(null)).toContain("/stadiums/night/default@2x.jpg");
  });
});

describe("gamedayStadiumProxyUrl", () => {
  it("routes through the local proxy", () => {
    expect(gamedayStadiumProxyUrl(4705)).toBe("/api/gameday/stadium?venueId=4705");
    expect(gamedayStadiumProxyUrl(null)).toBe("/api/gameday/stadium?venueId=default");
  });
});
