import { describe, expect, it } from "vitest";

import {
  extractPlayIdMapFromFeed,
  extractSportyClipMp4,
  extractSportyVideoTitle,
  enrichPlayDetailWithPlayId,
  isValidPlayId,
  mergePlayIdsOntoPlays,
  playsNeedPlayIdEnrichment,
  uniqueHighlightPlays,
} from "@/lib/mlb/playVideo";
import type { PlayByPlayEntry, PlayDetail } from "@/types/mlb-live";

function stubDetail(overrides: Partial<PlayDetail> = {}): PlayDetail {
  return {
    atBatIndex: 0,
    batterId: 1,
    batterName: "Batter",
    batterHits: 0,
    batterAtBats: 1,
    pitcherName: "Pitcher",
    pitcherId: 2,
    event: "Single",
    description: "Batter singles",
    inning: 1,
    halfInning: "top",
    awayScore: 0,
    homeScore: 0,
    isScoringPlay: false,
    pitches: [],
    hit: null,
    ...overrides,
  };
}

function stubPlay(overrides: Partial<PlayByPlayEntry> = {}): PlayByPlayEntry {
  const detail = stubDetail(overrides.detail ?? {});
  return {
    atBatIndex: detail.atBatIndex,
    inning: detail.inning,
    halfInning: detail.halfInning,
    batterId: detail.batterId,
    batterName: detail.batterName,
    batterHits: detail.batterHits,
    batterAtBats: detail.batterAtBats,
    event: detail.event,
    description: detail.description,
    awayScore: detail.awayScore,
    homeScore: detail.homeScore,
    outs: 0,
    bases: {},
    onFirst: false,
    onSecond: false,
    onThird: false,
    situationBefore: {
      awayScore: 0,
      homeScore: 0,
      outs: 0,
      bases: {},
      onFirst: false,
      onSecond: false,
      onThird: false,
    },
    isScoringPlay: false,
    isAtBat: true,
    detail,
    ...overrides,
  };
}

describe("playVideo helpers", () => {
  it("validates playId shape", () => {
    expect(isValidPlayId("4e93d4da-e482-3098-b157-01fe0f7811df")).toBe(true);
    expect(isValidPlayId("not-a-guid")).toBe(false);
  });

  it("extracts sporty clip mp4 and title from html", () => {
    const html = `
      <title>Michael Helman&#x27;s grand slam | Baseball Savant Videos | baseballsavant.com</title>
      <source src="https://sporty-clips.mlb.com/TkE5MDVfWGw0TUFRPT1fQWxSWVZ3.mp4" type="video/mp4" />
    `;
    expect(extractSportyClipMp4(html)).toBe(
      "https://sporty-clips.mlb.com/TkE5MDVfWGw0TUFRPT1fQWxSWVZ3.mp4",
    );
    expect(extractSportyVideoTitle(html)).toBe("Michael Helman's grand slam");
  });

  it("extracts playId map from feed", () => {
    const map = extractPlayIdMapFromFeed({
      liveData: {
        plays: {
          allPlays: [
            {
              about: { atBatIndex: 7 },
              playEvents: [
                { playId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
                { playId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
              ],
            },
          ],
        },
      },
    });
    expect(map["7"]).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
  });

  it("merges missing playIds onto plays", () => {
    const plays = [stubPlay({ atBatIndex: 3, detail: stubDetail({ atBatIndex: 3 }) })];
    expect(playsNeedPlayIdEnrichment(plays)).toBe(true);
    const merged = mergePlayIdsOntoPlays(plays, {
      "3": "cccccccc-cccc-cccc-cccc-cccccccccccc",
    });
    expect(merged[0].playId).toBe("cccccccc-cccc-cccc-cccc-cccccccccccc");
    expect(merged[0].detail.playId).toBe("cccccccc-cccc-cccc-cccc-cccccccccccc");
    expect(playsNeedPlayIdEnrichment(merged)).toBe(false);
  });

  it("does not stamp at-bat playIds onto non-at-bat rows", () => {
    const plays = [
      stubPlay({
        atBatIndex: 3,
        isAtBat: false,
        event: "Batter Timeout",
        description: "Batter Timeout",
        detail: stubDetail({ atBatIndex: 3, event: "Batter Timeout", description: "Batter Timeout" }),
      }),
    ];
    const merged = mergePlayIdsOntoPlays(plays, {
      "3": "cccccccc-cccc-cccc-cccc-cccccccccccc",
    });
    expect(merged[0].playId).toBeUndefined();
  });

  it("dedupes highlight candidates by playId", () => {
    const shared = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const plays = [
      stubPlay({
        atBatIndex: 71,
        isAtBat: false,
        event: "Batter Timeout",
        description: "Batter Timeout",
        playId: shared,
        detail: stubDetail({
          atBatIndex: 71,
          event: "Batter Timeout",
          description: "Batter Timeout",
          playId: shared,
        }),
      }),
      stubPlay({
        atBatIndex: 71,
        event: "Groundout",
        description: "Cal Raleigh grounds out",
        playId: shared,
        detail: stubDetail({
          atBatIndex: 71,
          event: "Groundout",
          description: "Cal Raleigh grounds out",
          playId: shared,
        }),
      }),
      stubPlay({
        atBatIndex: 32,
        event: "Home Run",
        description: "Cal Raleigh hits a grand slam",
        playId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        detail: stubDetail({
          atBatIndex: 32,
          event: "Home Run",
          description: "Cal Raleigh hits a grand slam",
          playId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        }),
      }),
    ];
    const unique = uniqueHighlightPlays(plays);
    expect(unique).toHaveLength(2);
    expect(unique.map((p) => p.event)).toEqual(["Home Run", "Groundout"]);
  });

  it("enrichPlayDetailWithPlayId is a no-op when playId already set", async () => {
    const detail = stubDetail({
      playId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
    });
    const enriched = await enrichPlayDetailWithPlayId(detail, 42, 3);
    expect(enriched).toBe(detail);
  });
});
