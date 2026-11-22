import { describe, expect, it } from "vitest";
import { clothDistance, clubSets, gameSet, KITS, setVenue, uniformFor } from "@/components/game/scene/character/uniforms";

const ids = Object.keys(KITS).map(Number);

describe("a club's set for a game", () => {
  it("is the same every time for a game's seed", () => {
    for (const id of ids) for (let seed = 1; seed < 40; seed += 1) expect(gameSet(id, true, seed)!.id).toBe(gameSet(id, true, seed)!.id);
  });

  it("is mostly the home whites at home, with the City Connect and alternates on their nights", () => {
    const n = 4000;
    for (const id of ids) {
      const sets = clubSets(id);
      const count = new Map<string, number>();
      for (let seed = 0; seed < n; seed += 1) {
        const s = gameSet(id, true, seed * 7919 + 13)!;
        count.set(s.id, (count.get(s.id) ?? 0) + 1);
        expect(setVenue(s)).not.toBe("road");
      }
      const home = (count.get("home") ?? 0) / n;
      const hasCC = sets.some((s) => s.id.startsWith("cc"));
      const hasAlt = sets.slice(2).some((s) => !s.id.startsWith("cc") && setVenue(s) !== "road");
      expect(home).toBeGreaterThan(hasCC || hasAlt ? 0.45 : 0.99);
      if (hasCC) expect([...count].filter(([k]) => k.startsWith("cc")).reduce((a, [, v]) => a + v, 0) / n).toBeGreaterThan(0.15);
    }
  });

  it("never brings the City Connect on the road, and wears the greys when an alternate would clash", () => {
    for (const id of ids)
      for (let seed = 0; seed < 600; seed += 1) {
        const s = gameSet(id, false, seed)!;
        expect(s.id.startsWith("cc")).toBe(false);
        expect(setVenue(s)).not.toBe("home");
        for (const against of [0xf4f2ec, 0x0c2c56, 0xc6011f]) {
          const t = gameSet(id, false, seed, against)!;
          if (t.id !== "road") expect(clothDistance(t.kit.jersey, against)).toBeGreaterThanOrEqual(120);
        }
      }
  });

  it("dresses the players in the chosen set", () => {
    let alternates = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const u = uniformFor(136, true, 0, { seed });
      expect(u.kit).toBe(gameSet(136, true, seed)!.kit);
      if (u.kit !== KITS[136][0]) alternates += 1;
    }
    expect(alternates).toBeGreaterThan(50);
    expect(uniformFor(136, true, 0).kit).toBe(KITS[136][0]);
  });
});
