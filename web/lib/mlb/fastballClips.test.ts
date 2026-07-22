import { describe, expect, it } from "vitest";

import {
  fastballClipUrl,
  proxiedFastballClipUrl,
  toPlayableClipUrl,
} from "@/lib/mlb/fastballClips";

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

  it("proxies Fastball CDN URLs for browser playback", () => {
    expect(
      proxiedFastballClipUrl(823437, "75805409-bc48-3e9b-b0f3-defce8a6ef92", "home"),
    ).toBe(
      "/api/plays/video/stream?gamePk=823437&playId=75805409-bc48-3e9b-b0f3-defce8a6ef92&feed=home",
    );
    expect(
      toPlayableClipUrl(
        "https://fastball-clips.mlb.com/823437/away/75805409-bc48-3e9b-b0f3-defce8a6ef92.mp4",
      ),
    ).toBe(
      "/api/plays/video/stream?gamePk=823437&playId=75805409-bc48-3e9b-b0f3-defce8a6ef92&feed=away",
    );
    expect(toPlayableClipUrl("https://sporty-clips.mlb.com/foo.mp4")).toBe(
      "https://sporty-clips.mlb.com/foo.mp4",
    );
  });
});
