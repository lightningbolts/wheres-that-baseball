/**
 * Who a player is, for drawing him: the name and number on his back and his build.
 * The roster file is loaded lazily (it is already fetched by the game's setup screen);
 * until it arrives players get a number derived from their id and no name.
 */

import { getTeamById } from "@/lib/mlb/teams";

export interface Identity {
  /** Last name as lettered on the jersey (upper case), or "". */
  name: string;
  num: string;
  /** Build: scales the girth of the trunk and limbs (1 = average). */
  girth: number;
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
  return { name: p.name ? jerseyName(p.name) : "", num, girth: girthOf(p.heightIn, p.weight), team, skin };
}

const table = new Map<number, Identity>();
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

const fallbacks = new Map<number, Identity>();

export function identity(id: number): Identity {
  const hit = table.get(id);
  if (hit) return hit;
  let f = fallbacks.get(id);
  if (!f) {
    if (fallbacks.size > 500) fallbacks.clear();
    f = { name: "", num: fallbackNumber(id), girth: 1, team: "", skin: null };
    fallbacks.set(id, f);
  }
  return f;
}
