import { describe, expect, it } from "vitest";
import { CLUBS } from "@/components/game/scene/character/uniforms";
import { dressFan } from "@/components/game/scene/parks/fans";
import { CROWD, FAN_STYLE } from "@/components/game/scene/parks/textures";

const palette = [0xf2f0ea, 0x20283a, 0x8c9299, 0xb32a33, 0x1f4f9a, 0x2f6a43];

function crowd(teamId: number, share: number, n = 4000) {
  const u = CLUBS[teamId];
  const kit = { home: u.home, road: u.road, cap: u.cap, letter: u.letter };
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return { kit, fits: Array.from({ length: n }, () => dressFan(kit, palette, share, r(), r(), r(), r())) };
}

describe("fan merch", () => {
  const ids = Object.keys(CLUBS).map(Number);
  it("has real club colours for every club", () => {
    expect(ids.length).toBe(30);
  });

  it("dresses about the asked share in club gear, in the club's own colours", () => {
    for (const id of ids) {
      const { kit, fits } = crowd(id, 0.66);
      const merch = fits.filter((f) => f.merch);
      expect(merch.length / fits.length).toBeGreaterThan(0.6);
      expect(merch.length / fits.length).toBeLessThan(0.72);
      const jerseys = merch.filter((f) => f.style === FAN_STYLE.jersey);
      expect(jerseys.length).toBeGreaterThan(merch.length * 0.25);
      // Replica jerseys are home whites, road greys or the cap-colour alternate.
      for (const j of jerseys) expect([kit.home, kit.road, kit.cap]).toContain(j.body);
      // Home whites are the most common jersey.
      expect(jerseys.filter((j) => j.body === kit.home).length).toBeGreaterThan(jerseys.length * 0.45);
      // Fans in their own clothes still show up, and some of them wear the club's cap.
      const own = fits.filter((f) => !f.merch);
      expect(own.some((f) => f.trim === kit.cap || f.trim === kit.letter)).toBe(true);
    }
  });

  it("puts the club's colours on nearly every fan at the share the stands use", () => {
    for (const id of ids) {
      const { kit, fits } = crowd(id, 0.86);
      const club = [kit.home, kit.road, kit.cap, kit.letter];
      // Club colour on the body: merch tops in the cap or lettering colour, not plain white or grey.
      const coloured = fits.filter((f) => f.body === kit.cap || f.body === kit.letter);
      expect(coloured.length / fits.length, `${id}`).toBeGreaterThan(0.45);
      // Everyone else at least shows the club on their cap, logo or lettering, bar a few.
      const shows = fits.filter((f) => club.includes(f.body) || f.trim === kit.cap || f.trim === kit.letter);
      expect(shows.length / fits.length, `${id}`).toBeGreaterThan(0.88);
    }
  });

  it("keeps lettering and logos legible against the cloth", () => {
    for (const id of ids) {
      for (const f of crowd(id, 1).fits) {
        expect(f.trim, `${id}`).not.toBe(f.body);
      }
    }
  });

  it("uses only outfit styles the atlas has, with a cheering cell for each", () => {
    for (const f of crowd(ids[0], 0.5).fits) {
      expect(f.style).toBeGreaterThanOrEqual(0);
      expect(f.style).toBeLessThan(FAN_STYLE.count);
    }
    expect(CROWD.seated % FAN_STYLE.count).toBe(0);
    expect((CROWD.cols * CROWD.rows - CROWD.seated) % FAN_STYLE.count).toBe(0);
  });
});
