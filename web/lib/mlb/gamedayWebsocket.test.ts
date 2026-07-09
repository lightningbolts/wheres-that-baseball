import { describe, expect, it } from "vitest";

import {
  mlbGamedayWsUrl,
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
});
