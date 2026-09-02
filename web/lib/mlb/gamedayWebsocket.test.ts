import { describe, expect, it } from "vitest";

import {
  mlbGamedayWsUrl,
  parseGamedayWsMessage,
  MLB_GAMEDAY_KEEPALIVE,
  MLB_GAMEDAY_WS_HOST,
} from "@/lib/mlb/gamedayWebsocket";

describe("gamedayWebsocket", () => {
  it("builds the free MLB Gameday subscribe URL", () => {
    expect(mlbGamedayWsUrl(823279)).toBe(
      `wss://${MLB_GAMEDAY_WS_HOST}/api/v1/game/push/subscribe/gameday/823279`,
    );
  });

  it("uses the observed Gameday keepalive token", () => {
    expect(MLB_GAMEDAY_KEEPALIVE).toBe("Gameday5");
  });

  it("parses JSON Patch ops, timecodes, and empty pings", () => {
    expect(parseGamedayWsMessage("")).toEqual({ type: "ping" });
    expect(parseGamedayWsMessage(MLB_GAMEDAY_KEEPALIVE)).toEqual({ type: "ping" });
    expect(parseGamedayWsMessage("20260902_020807")).toEqual({
      type: "timecode",
      timeStamp: "20260902_020807",
    });
    expect(
      parseGamedayWsMessage(
        JSON.stringify([{ diff: [{ op: "replace", path: "/metaData/timeStamp", value: "t2" }] }]),
      ),
    ).toEqual({
      type: "ops",
      ops: [{ op: "replace", path: "/metaData/timeStamp", value: "t2" }],
    });
  });
});
