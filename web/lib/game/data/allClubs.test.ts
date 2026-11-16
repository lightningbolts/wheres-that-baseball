/**
 * Every one of the 30 clubs gets the full treatment: its own colour, uniform, home park
 * with real dimensions and a stadium layout, so no team falls back to a generic look.
 */
import { describe, expect, it } from "vitest";
import rosters from "@/data/game/rosters.json";
import { MLB_TEAM_COLORS } from "@/lib/mlb/teamColors";
import { CLUBS } from "@/components/game/scene/character/uniforms";
import { buildPark, homeVenueForTeam } from "@/lib/game/physics/park";
import { PARK_LAYOUTS } from "@/lib/game/data/parkLayouts";
import { MLB_TEAMS } from "@/lib/mlb/teams";
import type { RosterFile } from "@/lib/game/types";

const teams = Object.values((rosters as unknown as RosterFile).teams);

describe("all 30 clubs", () => {
  it("has 30 teams in the rosters", () => {
    expect(new Set(teams.map((t) => t.teamId)).size).toBe(30);
  });

  it.each(teams.map((t) => [MLB_TEAMS.find((m) => m.id === t.teamId)?.abbrev ?? String(t.teamId), t.teamId] as const))("%s has a colour, uniform, park and stadium", (_abbrev, id) => {
    expect(MLB_TEAM_COLORS[id], "team colour").toMatch(/^#[0-9a-f]{6}$/i);
    const u = CLUBS[id];
    expect(u, "uniform").toBeDefined();
    expect(u.letter).not.toBe(u.home);
    const venue = homeVenueForTeam(id);
    expect(venue, "home venue").not.toBeNull();
    expect(PARK_LAYOUTS[venue!], "stadium layout").toBeDefined();
    const park = buildPark(venue);
    expect(park.venueId).toBe(venue);
    // Real fences: somewhere between 300 and 440 ft down the lines and to center.
    for (const spray of [-45, 0, 45]) {
      expect(park.fence(spray)).toBeGreaterThan(300);
      expect(park.fence(spray)).toBeLessThan(440);
    }
  });

  it("gives every club a home park of its own", () => {
    const venues = teams.map((t) => homeVenueForTeam(t.teamId));
    expect(new Set(venues).size).toBe(30);
  });
});
