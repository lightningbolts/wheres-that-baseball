import { describe, expect, it } from "vitest";

import {
  applyJsonPatch,
  JsonPatchError,
  parseMlbDiffPatchBody,
} from "@/lib/mlb/jsonPatch";

const FEED = {
  metaData: { timeStamp: "t1" },
  gameData: { status: { abstractGameState: "Live" } },
  liveData: {
    linescore: { teams: { away: { runs: 0 }, home: { runs: 1 } } },
    plays: {
      currentPlay: {
        result: { event: "" },
        count: { balls: 0, strikes: 0, outs: 0 },
      },
    },
  },
};

describe("applyJsonPatch", () => {
  it("applies replace/add ops onto a cloned live feed", () => {
    const next = applyJsonPatch(FEED, [
      { op: "replace", path: "/metaData/timeStamp", value: "t2" },
      { op: "replace", path: "/liveData/plays/currentPlay/result/event", value: "Single" },
      { op: "replace", path: "/liveData/plays/currentPlay/count/balls", value: 1 },
      { op: "replace", path: "/liveData/linescore/teams/away/runs", value: 2 },
    ]);

    expect(next.metaData.timeStamp).toBe("t2");
    expect(next.liveData.plays.currentPlay.result.event).toBe("Single");
    expect(next.liveData.plays.currentPlay.count.balls).toBe(1);
    expect(next.liveData.linescore.teams.away.runs).toBe(2);
    expect(FEED.metaData.timeStamp).toBe("t1");
    expect(FEED.liveData.plays.currentPlay.result.event).toBe("");
  });

  it("throws when a replace targets a missing path", () => {
    expect(() =>
      applyJsonPatch(FEED, [{ op: "replace", path: "/liveData/plays/missing", value: 1 }]),
    ).toThrow(JsonPatchError);
  });
});

describe("parseMlbDiffPatchBody", () => {
  it("unwraps MLB {diff: ops} lists", () => {
    const parsed = parseMlbDiffPatchBody([
      { diff: [{ op: "replace", path: "/metaData/timeStamp", value: "t2" }] },
    ]);
    expect(parsed).toEqual({
      kind: "ops",
      ops: [{ op: "replace", path: "/metaData/timeStamp", value: "t2" }],
    });
  });

  it("treats a full GUMBO object as a full snapshot", () => {
    expect(parseMlbDiffPatchBody(FEED)).toEqual({ kind: "full" });
  });

  it("treats empty lists as no-ops", () => {
    expect(parseMlbDiffPatchBody([])).toEqual({ kind: "empty" });
  });
});
