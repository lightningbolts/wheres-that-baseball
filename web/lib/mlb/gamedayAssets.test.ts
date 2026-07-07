import { describe, expect, it } from "vitest";

import {
  GAMEDAY_PITCH_FX_ASPECT,
  GAMEDAY_STADIUM_HEIGHT,
  GAMEDAY_STADIUM_WIDTH,
  gamedayInfieldCdnUrl,
  gamedayInfieldProxyUrl,
  gamedayStadiumCdnUrl,
  gamedayStadiumProxyUrl,
  resolveGamedayStadiumVariant,
} from "@/lib/mlb/gamedayAssets";

describe("gameday stadium frame", () => {
  it("matches the native @2x JPEG aspect ratio", () => {
    expect(GAMEDAY_STADIUM_WIDTH / GAMEDAY_STADIUM_HEIGHT).toBeCloseTo(193 / 74, 2);
  });
});

describe("gameday pitch-fx", () => {
  it("uses a 4:3 field aspect like MLB responsive-pitch-fx", () => {
    expect(GAMEDAY_PITCH_FX_ASPECT).toBeCloseTo(4 / 3, 5);
  });
});

describe("gamedayStadiumCdnUrl", () => {
  it("builds the prod-gameday night stadium URL for a venue", () => {
    expect(gamedayStadiumCdnUrl(4705)).toBe(
      "https://prod-gameday.mlbstatic.com/responsive-gameday-assets/1.3.0/images/stadiums/night/4705@2x.jpg",
    );
  });

  it("builds the day stadium URL when requested", () => {
    expect(gamedayStadiumCdnUrl(4705, "day")).toBe(
      "https://prod-gameday.mlbstatic.com/responsive-gameday-assets/1.3.0/images/stadiums/day/4705@2x.jpg",
    );
  });

  it("falls back to default when venue is missing", () => {
    expect(gamedayStadiumCdnUrl(null)).toContain("/stadiums/night/default@2x.jpg");
  });
});

describe("resolveGamedayStadiumVariant", () => {
  it("maps MLB dayNight values to stadium variants", () => {
    expect(resolveGamedayStadiumVariant("day")).toBe("day");
    expect(resolveGamedayStadiumVariant("night")).toBe("night");
    expect(resolveGamedayStadiumVariant(null)).toBe("night");
  });
});

describe("gamedayInfieldCdnUrl", () => {
  it("builds the infield-full layer URL for a venue", () => {
    expect(gamedayInfieldCdnUrl(5)).toBe(
      "https://prod-gameday.mlbstatic.com/responsive-gameday-assets/1.3.0/images/stadiums/infield-full/5@2x.jpg",
    );
  });
});

describe("gamedayStadiumProxyUrl", () => {
  it("routes through the local proxy", () => {
    expect(gamedayStadiumProxyUrl(4705)).toBe("/api/gameday/stadium?venueId=4705&variant=night");
    expect(gamedayStadiumProxyUrl(4705, "day")).toBe(
      "/api/gameday/stadium?venueId=4705&variant=day",
    );
    expect(gamedayStadiumProxyUrl(null)).toBe("/api/gameday/stadium?venueId=default&variant=night");
  });
});

describe("gamedayInfieldProxyUrl", () => {
  it("routes through the local infield proxy", () => {
    expect(gamedayInfieldProxyUrl(5)).toBe("/api/gameday/infield?venueId=5");
    expect(gamedayInfieldProxyUrl(null)).toBe("/api/gameday/infield?venueId=default");
  });
});
