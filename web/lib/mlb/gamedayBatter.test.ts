import { describe, expect, it } from "vitest";

import {
  gamedayBatterCdnUrl,
  gamedayBatterHand,
  gamedayPantsCodeFromJersey,
  gamedayPantsCdnUrl,
  jerseyCodeForTeam,
  pantsCandidatesForJersey,
  pickJerseyAssetCode,
  pickPantsAssetCode,
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

describe("gamedayPantsCodeFromJersey", () => {
  it("derives the pants asset code from a jersey code", () => {
    expect(gamedayPantsCodeFromJersey("114_jersey_1_2026")).toBe("114_pants_1_2026");
    expect(gamedayPantsCdnUrl("114_jersey_1_2026", "left")).toContain("/left/114_pants_1_2026.png");
  });
});

describe("pickPantsAssetCode", () => {
  it("matches pants variant to jersey variant when available", () => {
    const assets = [
      {
        uniformAssetCode: "108_jersey_3_2026",
        active: true,
        uniformAssetType: { uniformAssetTypeCode: "J" },
      },
      {
        uniformAssetCode: "108_pants_1_2026",
        active: true,
        uniformAssetType: { uniformAssetTypeCode: "P" },
      },
      {
        uniformAssetCode: "108_pants_4_2026",
        active: false,
        uniformAssetType: { uniformAssetTypeCode: "P" },
      },
    ];

    expect(pickPantsAssetCode(assets, "108_jersey_3_2026")).toBe("108_pants_1_2026");
    expect(pickPantsAssetCode(assets, "108_jersey_4_2026")).toBe("108_pants_4_2026");
  });
});

describe("pantsCandidatesForJersey", () => {
  it("includes derived and fallback pants codes", () => {
    const candidates = pantsCandidatesForJersey(
      [
        {
          uniformAssetCode: "108_pants_2_2026",
          active: true,
          uniformAssetType: { uniformAssetTypeCode: "P" },
        },
      ],
      "108_jersey_3_2026",
    );

    expect(candidates).toContain("108_pants_3_2026");
    expect(candidates).toContain("108_pants_2_2026");
    expect(candidates).toContain("108_pants_1_2026");
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
