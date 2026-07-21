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

  it("keeps in-game clips with play GUIDs and drops lineups/recaps", () => {
    const content: MlbGameContentResponse = {
      highlights: {
        highlights: {
          items: [
            {
              type: "video",
              id: "rocchio-rbi",
              guid: "85d03d72-3cb3-33de-84bd-c5f90734ae4e",
              headline: "Brayan Rocchio's RBI single",
              date: "2026-07-21T23:20:00Z",
              playbacks: [
                { name: "mp4Avc", url: "https://bdata-producedclips.mlb.com/a.mp4" },
              ],
              keywordsAll: [
                { type: "taxonomy", value: "in-game-highlight" },
                { type: "taxonomy", value: "game-action-tracking" },
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
          ],
        },
      },
    };

    const clips = parseGameHighlightClips(content);
    expect(clips).toHaveLength(1);
    expect(clips[0].playId).toBe("85d03d72-3cb3-33de-84bd-c5f90734ae4e");
    expect(clips[0].url).toContain(".mp4");
    expect(clips[0].thumbnailUrl).toContain("img.mlbstatic.com");
  });

  it("accepts in-game highlights even without a guid", () => {
    expect(
      isPlayHighlightItem({
        type: "video",
        headline: "Strikeout confirmed after ABS challenge",
        playbacks: [{ name: "mp4Avc", url: "https://bdata-producedclips.mlb.com/abs.mp4" }],
        keywordsAll: [{ type: "taxonomy", value: "in-game-highlight" }],
      }),
    ).toBe(true);
  });
});
