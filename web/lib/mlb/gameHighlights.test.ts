import { describe, expect, it } from "vitest";

import {
  isPlayHighlightItem,
  parseGameHighlightClips,
  pickHighlightMp4Url,
  type MlbGameContentResponse,
} from "@/lib/mlb/gameHighlights";

describe("gameHighlights", () => {
  it("prefers mp4Avc playback URLs", () => {
    expect(
      pickHighlightMp4Url([
        { name: "hlsCloud", url: "https://example.com/a.m3u8" },
        { name: "mp4Avc", url: "https://bdata-producedclips.mlb.com/clip.mp4" },
      ]),
    ).toBe("https://bdata-producedclips.mlb.com/clip.mp4");
  });

  it("rejects HLS-only playbacks", () => {
    expect(
      pickHighlightMp4Url([{ name: "hlsCloud", url: "https://example.com/a.m3u8" }]),
    ).toBeNull();
  });

  it("keeps in-game clips even when tagged imagen-feed", () => {
    const content: MlbGameContentResponse = {
      highlights: {
        highlights: {
          items: [
            {
              type: "video",
              id: "muncy-hr",
              guid: "70929de6-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              headline: "Max Muncy's two-run home run (19)",
              date: "2026-07-21T23:20:00Z",
              playbacks: [
                { name: "mp4Avc", url: "https://bdata-producedclips.mlb.com/hr.mp4" },
              ],
              keywordsAll: [
                { type: "taxonomy", value: "in-game-highlight" },
                { type: "taxonomy", value: "imagen-feed" },
                { type: "taxonomy", value: "home-run" },
              ],
              image: {
                cuts: [{ width: 640, height: 360, src: "https://img.mlbstatic.com/a.jpg" }],
              },
            },
            {
              type: "video",
              id: "lineups",
              headline: "Starting lineups for Twins at Guardians",
              playbacks: [
                { name: "mp4Avc", url: "https://bdata-producedclips.mlb.com/lineups.mp4" },
              ],
              keywordsAll: [{ type: "taxonomy", value: "in-game-highlight" }],
            },
            {
              type: "video",
              id: "recap",
              headline: "Guardians slug seven home runs",
              playbacks: [
                { name: "mp4Avc", url: "https://bdata-producedclips.mlb.com/recap.mp4" },
              ],
              keywordsAll: [
                { type: "taxonomy", value: "game-recap" },
                { type: "taxonomy", value: "condensed-game" },
              ],
            },
            {
              type: "video",
              id: "rain",
              headline: "Dodgers vs. Phillies starts in a rain delay",
              playbacks: [
                { name: "mp4Avc", url: "https://bdata-producedclips.mlb.com/rain.mp4" },
              ],
              keywordsAll: [{ type: "taxonomy", value: "in-game-highlight" }],
            },
          ],
        },
      },
    };

    const clips = parseGameHighlightClips(content);
    expect(clips).toHaveLength(1);
    expect(clips[0].playId).toBe("70929de6-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(clips[0].url).toContain(".mp4");
    expect(clips[0].thumbnailUrl).toContain("img.mlbstatic.com");
  });

  it("derives progressive MP4 URLs from diamond forge HLS playbacks", () => {
    expect(
      pickHighlightMp4Url([
        {
          name: "hlsCloud",
          url: "https://mlb-cuts-diamond.mlb.com/FORGE/2026/2026-07/21/e37a8689-9f802596-cf239b14-csvm-diamondgcp-asset.m3u8",
        },
      ]),
    ).toBe(
      "https://mlb-cuts-diamond.mlb.com/FORGE/2026/2026-07/21/e37a8689-9f802596-cf239b14-csvm-diamondgcp-asset_1280x720_59_4000K.mp4",
    );
  });

  it("keeps ABS challenge clips", () => {
    expect(
      isPlayHighlightItem({
        type: "video",
        headline: "Strike 3 overturned after ABS challenge",
        playbacks: [{ name: "mp4Avc", url: "https://bdata-producedclips.mlb.com/abs.mp4" }],
        keywordsAll: [{ type: "taxonomy", value: "abs" }],
      }),
    ).toBe(true);
  });
});
