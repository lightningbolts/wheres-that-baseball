import { describe, expect, it } from "vitest";

import { parseSavantExpectedBatterCsv } from "@/lib/mlb/playerHitting";

describe("parseSavantExpectedBatterCsv", () => {
  it("maps player_id to est_woba as broadcast-style xwOBA", () => {
    const csv = [
      `"last_name, first_name","player_id","year","pa","bip","ba","est_ba","slg","est_slg","woba","est_woba"`,
      `"Ohtani, Shohei","660271","2025","700","450",0.282,0.27,0.622,0.6,0.418,0.401`,
    ].join("\n");

    const map = parseSavantExpectedBatterCsv(csv);
    expect(map.get(660271)).toBe(".401");
  });
});
