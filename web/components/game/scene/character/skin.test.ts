import { describe, expect, it } from "vitest";
import rostersFile from "@/data/game/rosters.json";
import projFile from "@/data/game/franchise-proj.json";
import { NEUTRAL_SKIN, identity, identityOf, loadRoster, neutralSkin, registerTeams, rosterVersion, skinTone } from "@/components/game/scene/character/roster";
import { skinFor } from "@/components/game/scene/playback";
import { teamModel } from "@/lib/game/ratings";
import type { RosterFile, RosterPlayer, RosterTeam } from "@/lib/game/types";

const HEX = /^#[0-9a-f]{6}$/i;
const rosters = rostersFile as unknown as RosterFile;
const extras = (projFile as unknown as { extras: Record<string, RosterPlayer[]> }).extras;
const rosterPlayers = Object.values(rosters.teams).flatMap((t) => [...t.lineup, ...t.bench, ...t.rotation, ...t.bullpen]);
const extraPlayers = Object.values(extras).flat();
const lum = (hex: number) => 0.2126 * ((hex >> 16) & 255) + 0.7152 * ((hex >> 8) & 255) + 0.0722 * (hex & 255);

describe("skin tone data coverage", () => {
  it("every rosters.json player has a sampled tone", () => {
    const missing = rosterPlayers.filter((p) => !(typeof p.skin === "string" && HEX.test(p.skin)));
    expect(missing.map((p) => `${p.id} ${p.name}`)).toEqual([]);
  });

  it("every franchise 40-man extra (players rosters.json lacks) has a sampled tone", () => {
    expect(extraPlayers.length).toBeGreaterThan(0);
    const missing = extraPlayers.filter((p) => !(typeof p.skin === "string" && HEX.test(p.skin)));
    expect(missing.map((p) => `${p.id} ${p.name}`)).toEqual([]);
  });
});

describe("skin tone lookup", () => {
  it("parses the sampled tone and rejects malformed ones", () => {
    expect(identityOf({ id: 1, skin: "#a1b2c3" }).skin).toBe(0xa1b2c3);
    expect(identityOf({ id: 1, skin: "a1b2c3" }).skin).toBeNull();
    expect(identityOf({ id: 1, skin: null }).skin).toBeNull();
    expect(identityOf({ id: 1 }).skin).toBeNull();
  });

  it("falls back to a neutral mid-tone fixed per player, never an extreme", () => {
    for (const id of [9_000_000, 9_000_001, 9_123_457, 123456]) {
      const t = skinTone(id);
      expect(NEUTRAL_SKIN).toContain(t);
      expect(skinTone(id)).toBe(t);
      expect(neutralSkin(id)).toBe(t);
    }
    for (const t of NEUTRAL_SKIN) {
      expect(lum(t)).toBeGreaterThan(125);
      expect(lum(t)).toBeLessThan(170);
    }
  });

  it("resolves every rosters.json player to his own tone once the file loads", async () => {
    loadRoster();
    for (let i = 0; i < 200 && rosterVersion() === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
    expect(rosterVersion()).toBeGreaterThan(0);
    for (const p of rosterPlayers) expect(skinTone(p.id)).toBe(parseInt(p.skin!.slice(1), 16));
  });

  it("registered game rosters cover franchise extras and generated players", () => {
    const real = rosterPlayers[0];
    const extra = extraPlayers[0];
    // A generated player cloned from a template, as manual.ts does: his own id, no tone of his own.
    const generated: RosterPlayer = { ...structuredClone(rosterPlayers.find((p) => p.pitch?.arsenal?.length)!), id: 9_000_077, name: "Gen Erated", num: null, skin: null };
    const batterOf = (p: RosterPlayer): RosterPlayer => ({ ...p, bat: p.bat ?? rosterPlayers.find((x) => x.bat)!.bat, pos: "1B" });
    const team: RosterTeam = { teamId: 147, lineup: [batterOf(real), batterOf(extra)], bench: [], rotation: [generated], bullpen: [] };
    const before = rosterVersion();
    registerTeams([teamModel(team)]);
    expect(rosterVersion()).toBe(before + 1);
    expect(skinTone(extra.id)).toBe(parseInt(extra.skin!.slice(1), 16));
    expect(identity(extra.id).name).not.toBe("");
    expect(identity(extra.id).team).toBe("Yankees");
    expect(skinTone(real.id)).toBe(parseInt(real.skin!.slice(1), 16));
    expect(identity(generated.id).name).toBe("ERATED");
    expect(skinTone(generated.id)).toBe(neutralSkin(generated.id));
  });
});

describe("skinFor colour cache", () => {
  it("keys each player's colour by his own id and tone", () => {
    const [a, b] = rosterPlayers.filter((p, i, all) => all.findIndex((x) => x.skin === p.skin) === i).slice(0, 2);
    const ca = skinFor(a.id);
    const cb = skinFor(b.id);
    expect(ca).not.toBe(cb);
    expect(ca.getHexString()).toBe(a.skin!.slice(1).toLowerCase());
    expect(cb.getHexString()).toBe(b.skin!.slice(1).toLowerCase());
    // Stable object per player (no per-frame allocation), still his tone after another lookup.
    expect(skinFor(a.id)).toBe(ca);
    expect(skinFor(a.id).getHexString()).toBe(a.skin!.slice(1).toLowerCase());
  });

  it("follows a player's tone when it changes (roster arrives, new game registered)", () => {
    const id = 9_000_555;
    expect(skinFor(id).getHex()).toBe(neutralSkin(id));
    const p = { ...rosterPlayers.find((x) => x.pitch?.arsenal?.length)!, id, skin: "#123456" };
    registerTeams([teamModel({ teamId: 111, lineup: [], bench: [], rotation: [p], bullpen: [] })]);
    expect(skinFor(id).getHex()).toBe(0x123456);
  });

  it("keeps umpires and coaches on their own stand-in tones", () => {
    expect(skinFor(3)).toBe(skinFor(3));
    expect(skinFor(-82).getHex()).not.toBe(0);
  });
});
