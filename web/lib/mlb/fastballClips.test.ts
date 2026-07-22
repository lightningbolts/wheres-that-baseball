import { describe, expect, it } from "vitest";

import { fastballClipUrl } from "@/lib/mlb/fastballClips";

describe("fastballClips", () => {
  it("builds deterministic Gameday CDN URLs", () => {
    expect(
      fastballClipUrl(823437, "75805409-bc48-3e9b-b0f3-defce8a6ef92", "home"),
    ).toBe(
      "https://fastball-clips.mlb.com/823437/home/75805409-bc48-3e9b-b0f3-defce8a6ef92.mp4",
    );
    expect(
      fastballClipUrl(823437, "75805409-bc48-3e9b-b0f3-defce8a6ef92", "away"),
    ).toBe(
      "https://fastball-clips.mlb.com/823437/away/75805409-bc48-3e9b-b0f3-defce8a6ef92.mp4",
    );
  });
});
