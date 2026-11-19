import { describe, expect, it } from "vitest";
import projJson from "@/data/game/franchise-proj.json";
import rosters from "@/data/game/rosters.json";
import type { RosterFile } from "@/lib/game/types";
import { createLeague } from "./league";
import { rosterIndex, rosterPlayerFor } from "./manual";
import type { ProjectionFile } from "./projections";

const file = rosters as unknown as RosterFile;
const proj = projJson as unknown as ProjectionFile;
const league = createLeague(file, { userTeam: 147, seed: 5, proj });
const idx = rosterIndex(file, proj.extras);
const players = Object.values(league.players);

describe("franchise game rosters keep each player's own identity", () => {
  it("a real rosters.json player keeps his own tone and number", () => {
    const p = players.find((x) => x.real && idx.has(x.id))!;
    const own = idx.get(p.id)!;
    const out = rosterPlayerFor(p, idx);
    expect(out.id).toBe(p.id);
    expect(out.skin).toBe(own.skin);
    expect(out.num).toBe(own.num);
  });

  it("a 40-man extra borrows a template's physics but not its skin tone or number", () => {
    const extras = players.filter((x) => x.real && !idx.has(x.id) && x.template != null && x.template !== x.id);
    expect(extras.length).toBeGreaterThan(100);
    for (const p of extras) {
      const own = idx.own.get(p.id)!;
      expect(own, `${p.id} ${p.name}`).toBeTruthy();
      const out = rosterPlayerFor(p, idx);
      expect(out.skin, p.name).toBe(own.skin);
      expect(out.num, p.name).toBe(own.num ?? null);
    }
    const judge = rosterPlayerFor(league.players[592450], idx);
    expect(judge.num).toBe("99");
    expect(judge.skin).toBe(idx.own.get(592450)!.skin);
  });

  it("a generated player gets no borrowed skin tone or number", () => {
    const gen = players.filter((x) => !x.real);
    expect(gen.length).toBeGreaterThan(0);
    for (const p of gen.slice(0, 50)) {
      const out = rosterPlayerFor(p, idx);
      expect(out.skin ?? null).toBeNull();
      expect(out.num).toBeNull();
    }
  });
});
