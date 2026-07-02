import { describe, expect, it } from "vitest";

import {
  gamedayBatterCdnUrl,
  gamedayBatterHand,
  jerseyCodeForTeam,
  pickJerseyAssetCode,
  yearFromUniformAssetCode,
} from "@/lib/mlb/gamedayBatter";

describe("gamedayBatterHand", () => {
  it("maps bat side to Gameday silhouette handedness", () => {
    expect(gamedayBatterHand("L")).toBe("left");
    expect(gamedayBatterHand("R")).toBe("right");
  });
});

describe("gamedayBatterCdnUrl", () => {
  it("builds the prod-gameday batter silhouette URL", () => {
    expect(gamedayBatterCdnUrl("119_jersey_4_2024", "right")).toBe(
      "https://prod-gameday.mlbstatic.com/responsive-gameday-assets/1.3.0/images/batters/2024/right/119_jersey_4_2024.png",
    );
  });
});

describe("pickJerseyAssetCode", () => {
  it("prefers the active jersey asset", () => {
    expect(
      pickJerseyAssetCode([
        {
          uniformAssetCode: "145_jersey_2_2024",
          active: false,
          uniformAssetType: { uniformAssetTypeCode: "J" },
        },
        {
          uniformAssetCode: "145_jersey_1_2024",
          active: true,
          uniformAssetType: { uniformAssetTypeCode: "J" },
        },
      ]),
    ).toBe("145_jersey_1_2024");
  });
});

describe("jerseyCodeForTeam", () => {
  it("finds the jersey for the matching team in a game uniforms payload", () => {
    const code = jerseyCodeForTeam(
      {
        uniforms: [
          {
            home: {
              id: 145,
              uniformAssets: [
                {
                  uniformAssetCode: "145_jersey_1_2024",
                  active: true,
                  uniformAssetType: { uniformAssetTypeCode: "J" },
                },
              ],
            },
            away: {
              id: 110,
              uniformAssets: [
                {
                  uniformAssetCode: "110_jersey_2_2024",
                  active: true,
                  uniformAssetType: { uniformAssetTypeCode: "J" },
                },
              ],
            },
          },
        ],
      },
      110,
    );

    expect(code).toBe("110_jersey_2_2024");
    expect(yearFromUniformAssetCode(code!)).toBe("2024");
  });
});
