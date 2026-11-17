import { describe, expect, it } from "vitest";
import projFile from "@/data/game/franchise-proj.json";
import rosters from "@/data/game/rosters.json";
import type { RosterFile } from "@/lib/game/types";
import { awardTags, GLOVE_POS, LEAGUES, SLUGGER_POS } from "./awards";
import { createLeague } from "./league";
import type { ProjectionFile } from "./projections";
import { simUntil } from "./season";

describe("season honors", () => {
  it("picks All-Stars at the break and the full slate of awards at season's end", () => {
    const league = createLeague(rosters as unknown as RosterFile, { userTeam: 147, seed: 11, proj: projFile as unknown as ProjectionFile });
    simUntil(league, "season");
    const as = league.allStars?.[2027];
    expect(as).toBeDefined();
    for (const lg of LEAGUES) {
      const r = as![lg];
      expect(r.starters.length).toBe(9);
      expect(r.pitchers.length).toBeGreaterThanOrEqual(12);
      const teams = new Set([...r.starters.map((s) => s.id), ...r.reserves, ...r.pitchers].map((id) => league.players[id].team));
      // Every club is represented; a deadline trade can move an All-Star to the other league.
      expect(teams.size).toBeGreaterThanOrEqual(15);
    }
    const a = league.awards.at(-1)!;
    const n = (id?: number) => (id ? `${league.players[id].name}` : "—");
    for (const lg of LEAGUES) {
      expect(a.ballots!.mvp[lg].length).toBeGreaterThanOrEqual(10);
      expect(a.ballots!.mvp[lg][0].pts).toBeGreaterThan(200);
      expect(a.relief![lg]).toBeDefined();
      expect(a.aaron![lg]).toBeDefined();
      expect(Object.keys(a.silver![lg]).length).toBeGreaterThanOrEqual(SLUGGER_POS.length - 1);
      expect(Object.keys(a.gold![lg]).length).toBeGreaterThanOrEqual(GLOVE_POS.length - 1);
      console.log(
        lg,
        "MVP",
        a.ballots!.mvp[lg].slice(0, 5).map((x) => `${n(x.id)} ${x.pts} (${x.line})`).join(" | "),
        "\n CY",
        a.ballots!.cy[lg].slice(0, 3).map((x) => `${n(x.id)} ${x.pts} (${x.line})`).join(" | "),
        "\n ROY",
        a.ballots!.roy[lg].map((x) => `${n(x.id)} ${x.pts}`).join(" | "),
        "\n REL",
        n(a.relief![lg]!.id),
        a.relief![lg]!.line,
        "\n HA",
        n(a.aaron![lg]!.id),
        "\n SS",
        Object.entries(a.silver![lg]).map(([p, x]) => `${p} ${n(x!.id)}`).join(", "),
        "\n GG",
        Object.entries(a.gold![lg]).map(([p, x]) => `${p} ${n(x!.id)}`).join(", "),
      );
    }
    expect(awardTags(league, 2027, a.mvp.AL)).toContain("MVP-1");
  });
});
