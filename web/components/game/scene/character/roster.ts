/**
 * Who a player is, for drawing him: the name and number on his back and his build.
 * The roster file is loaded lazily (it is already fetched by the game's setup screen);
 * until it arrives players get a number derived from their id and no name.
 */

import { getTeamById } from "@/lib/mlb/teams";
import type { TeamModel } from "@/lib/game/ratings";

export interface Identity {
  /** Last name as lettered on the jersey (upper case), or "". */
  name: string;
  num: string;
  /** Build: scales the girth of the trunk and limbs (1 = average). */
  girth: number;
  /** Height relative to the 5'11" figure the mesh is built as. */
  stature: number;
  /** Club nickname for the chest wordmark ("Red Sox"), or "" when unknown. */
  team: string;
  /** Skin tone sampled from the player's MLB headshot (0xRRGGBB), or null when unknown. */
  skin: number | null;
}

interface RosterPlayer {
  id: number;
  name?: string;
  num?: string | null;
  heightIn?: number | null;
  weight?: number | null;
  /** "#rrggbb" sampled from the headshot by ml-engine/scripts/sample_skin_tones.py. */
  skin?: string | null;
}

const SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;
const PARTICLE = /^(de|del|la|las|los|van|von|der|den|da|dos|di|st\.?|le|du)$/i;

/** "Bobby Witt Jr." → "WITT JR.", "Elly De La Cruz" → "DE LA CRUZ", "José Ramírez" → "RAMÍREZ". */
export function jerseyName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].toUpperCase();
  let suffix = "";
  if (parts.length > 2 && SUFFIX.test(parts[parts.length - 1])) suffix = ` ${parts.pop()}`;
  let i = parts.length - 1;
  // Pull in particles that belong to the surname, but never the first name.
  while (i > 1 && PARTICLE.test(parts[i - 1])) i -= 1;
  return (parts.slice(i).join(" ") + suffix).toUpperCase();
}

export const fallbackNumber = (id: number) => String((Math.abs(Math.trunc(id)) % 98) + 1);

export function girthOf(heightIn: number | null | undefined, weight: number | null | undefined): number {
  if (!heightIn || !weight) return 1;
  // Ballplayers average about 6'1", 207 lb; girth goes with the square root of mass per height.
  const k = Math.sqrt(weight / heightIn / (207 / 73));
  return Math.min(1.14, Math.max(0.9, k));
}

/** Height as a scale of the figure (the mesh stands 5'11"), kept within what the animation can carry. */
export function statureOf(heightIn: number | null | undefined): number {
  if (!heightIn) return 1.02;
  return Math.min(1.1, Math.max(0.93, heightIn / 71.5));
}

const TWO_WORD = /(Red Sox|White Sox|Blue Jays)$/;

/** "Boston Red Sox" → "Red Sox", "Arizona Diamondbacks" → "Diamondbacks". */
export function nickname(full: string): string {
  const two = TWO_WORD.exec(full);
  if (two) return two[1];
  const parts = full.trim().split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

export function identityOf(p: RosterPlayer, team = ""): Identity {
  const num = p.num != null && String(p.num).trim() !== "" ? String(p.num).trim().slice(0, 2) : fallbackNumber(p.id);
  const skin = typeof p.skin === "string" && /^#[0-9a-f]{6}$/i.test(p.skin) ? parseInt(p.skin.slice(1), 16) : null;
  return { name: p.name ? jerseyName(p.name) : "", num, girth: girthOf(p.heightIn, p.weight), stature: statureOf(p.heightIn), team, skin };
}

const table = new Map<number, Identity>();
/** The players of the game being played, from its own rosters: franchise mode's 40-man extras and generated players are not in rosters.json. */
const live = new Map<number, Identity>();
let version = 0;
let requested = false;

/** Bumped when roster data arrives, so painted uniforms can be refreshed. */
export const rosterVersion = () => version;

export function loadRoster(): void {
  if (requested) return;
  requested = true;
  import("@/data/game/rosters.json")
    .then((mod) => {
      const file = (mod as { default?: unknown }).default ?? mod;
      const teams = (file as { teams?: Record<string, Record<string, unknown>> }).teams ?? {};
      for (const [key, team] of Object.entries(teams)) {
        const club = getTeamById(Number(team.teamId ?? key));
        const word = club ? nickname(club.name) : "";
        for (const group of Object.values(team)) {
          if (!Array.isArray(group)) continue;
          for (const p of group as RosterPlayer[]) {
            if (p && typeof p.id === "number") table.set(p.id, identityOf(p, word));
          }
        }
      }
      version += 1;
    })
    .catch(() => {
      // Names are decoration: without the file everyone keeps a fallback number.
    });
}

/**
 * Register the players of the game about to be played (both clubs, as GameView gets them),
 * so everyone on the field is drawn as himself: name, number, build and skin tone. Real
 * players carry their own sampled tone; generated (franchise) players have none and get
 * the neutral stand-in. Replaces the previous game's players.
 */
export function registerTeams(teams: Iterable<TeamModel>): void {
  live.clear();
  for (const t of teams) {
    const club = getTeamById(t.teamId);
    const word = club ? nickname(club.name) : "";
    for (const m of [...t.lineup, ...t.bench, ...t.rotation, ...t.bullpen]) {
      if (m.raw && typeof m.raw.id === "number" && !live.has(m.raw.id)) live.set(m.raw.id, identityOf(m.raw, word));
    }
  }
  version += 1;
}

/**
 * Stand-in tones for players without a usable headshot (generated players, the generic
 * silhouette, or before the roster has loaded): a narrow band of mid-tones around the
 * roster median, fixed per player, rather than random extremes.
 */
export const NEUTRAL_SKIN = [0xc98f70, 0xbf8466, 0xd29a7c, 0xb77c5e] as const;
export const neutralSkin = (id: number) => NEUTRAL_SKIN[Math.abs(Math.trunc(id) * 7919) % NEUTRAL_SKIN.length];

/** The tone to paint a player's skin (0xRRGGBB): his own when known, else the neutral stand-in. */
export function skinTone(id: number): number {
  return identity(id).skin ?? neutralSkin(id);
}

const fallbacks = new Map<number, Identity>();

export function identity(id: number): Identity {
  const mine = live.get(id);
  const file = table.get(id);
  if (mine) {
    // The game's roster entry wins (current club, current number); the roster file fills a missing tone.
    if (mine.skin === null && file && file.skin !== null) mine.skin = file.skin;
    return mine;
  }
  if (file) return file;
  let f = fallbacks.get(id);
  if (!f) {
    if (fallbacks.size > 500) fallbacks.clear();
    f = { name: "", num: fallbackNumber(id), girth: 1, stature: 1.02, team: "", skin: null };
    fallbacks.set(id, f);
  }
  return f;
}
