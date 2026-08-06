import { describe, expect, it } from "vitest";

import {
  fastballClipUrl,
  hasRegionalFeedChoice,
  preferFastballFeed,
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
    expect(
      fastballClipUrl(823600, "bf45d21a-3031-31e2-ad36-03e9e42cce3a", "network"),
    ).toBe(
      "https://fastball-clips.mlb.com/823600/network/bf45d21a-3031-31e2-ad36-03e9e42cce3a.mp4",
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
    expect(
      toPlayableClipUrl(
        "https://fastball-clips.mlb.com/823600/network/bf45d21a-3031-31e2-ad36-03e9e42cce3a.mp4",
      ),
    ).toBe(
      "/api/plays/video/stream?gamePk=823600&playId=bf45d21a-3031-31e2-ad36-03e9e42cce3a&feed=network",
    );
    expect(toPlayableClipUrl("https://sporty-clips.mlb.com/foo.mp4")).toBe(
      "https://sporty-clips.mlb.com/foo.mp4",
    );
  });

  it("prefers regional home feed before away/network", () => {
    expect(preferFastballFeed(["network", "away", "home"])).toBe("home");
    expect(preferFastballFeed(["network", "away"])).toBe("away");
    expect(preferFastballFeed(["network"])).toBe("network");
    expect(preferFastballFeed([])).toBeNull();
  });

  it("detects regional home/away choice vs national-only", () => {
    expect(hasRegionalFeedChoice(["home", "away"])).toBe(true);
    expect(hasRegionalFeedChoice(["home", "away", "network"])).toBe(true);
    expect(hasRegionalFeedChoice(["network"])).toBe(false);
    expect(hasRegionalFeedChoice(["home"])).toBe(false);
    expect(hasRegionalFeedChoice([])).toBe(false);
  });
});
