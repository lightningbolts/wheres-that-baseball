/**
 * Club uniforms for Play Ball: home whites (or cream), road grays, cap colour, lettering
 * and trim, pinstripes where the club wears them at home, and the club's cap logo
 * (the same mlbstatic marks the rest of the site uses), loaded once per team.
 */
import { mlbTeamLogoUrl } from "@/lib/mlb/teamAssets";

export interface ClubUniform {
  /** Home jersey (white unless the club wears cream). */
  home: number;
  /** Road jersey. */
  road: number;
  cap: number;
  /** Lettering / numbers. */
  letter: number;
  /** Secondary colour: piping, socks, outline. */
  trim: number;
  /** Home pinstripe colour, if any. */
  stripe?: number;
}

const WHITE = 0xf4f3ee;
const CREAM = 0xf1e9d2;
const GRAY = 0xb1b4b9;
const DARK_GRAY = 0x9a9ea5;

export const CLUBS: Record<number, ClubUniform> = {
  108: { home: WHITE, road: GRAY, cap: 0xba0021, letter: 0xba0021, trim: 0x003263 }, // LAA
  109: { home: WHITE, road: GRAY, cap: 0xa71930, letter: 0xa71930, trim: 0x1a1a1a }, // ARI
  110: { home: WHITE, road: GRAY, cap: 0x1a1a1a, letter: 0xdf4601, trim: 0x1a1a1a }, // BAL
  111: { home: WHITE, road: GRAY, cap: 0x0c2340, letter: 0xbd3039, trim: 0x0c2340 }, // BOS
  112: { home: WHITE, road: GRAY, cap: 0x0e3386, letter: 0x0e3386, trim: 0xcc3433, stripe: 0x0e3386 }, // CHC
  113: { home: WHITE, road: GRAY, cap: 0xc6011f, letter: 0xc6011f, trim: 0x1a1a1a }, // CIN
  114: { home: WHITE, road: GRAY, cap: 0x0c2340, letter: 0x0c2340, trim: 0xe31937 }, // CLE
  115: { home: WHITE, road: GRAY, cap: 0x1a1a1a, letter: 0x33006f, trim: 0x1a1a1a, stripe: 0x33006f }, // COL
  116: { home: WHITE, road: GRAY, cap: 0x0c2340, letter: 0x0c2340, trim: 0xfa4616 }, // DET
  117: { home: WHITE, road: GRAY, cap: 0x002d62, letter: 0x002d62, trim: 0xeb6e1f }, // HOU
  118: { home: WHITE, road: GRAY, cap: 0x004687, letter: 0x004687, trim: 0xbd9b60 }, // KC
  119: { home: WHITE, road: GRAY, cap: 0x005a9c, letter: 0x005a9c, trim: 0xef3e42 }, // LAD
  120: { home: WHITE, road: GRAY, cap: 0xab0003, letter: 0xab0003, trim: 0x14225a }, // WSH
  121: { home: WHITE, road: GRAY, cap: 0x002d72, letter: 0x002d72, trim: 0xff5910, stripe: 0x002d72 }, // NYM
  133: { home: WHITE, road: GRAY, cap: 0x003831, letter: 0x003831, trim: 0xefb21e }, // ATH
  134: { home: WHITE, road: GRAY, cap: 0x27251f, letter: 0x27251f, trim: 0xfdb827 }, // PIT
  135: { home: WHITE, road: GRAY, cap: 0x2f241d, letter: 0x2f241d, trim: 0xffc425, stripe: 0x2f241d }, // SD
  136: { home: WHITE, road: GRAY, cap: 0x0c2c56, letter: 0x0c2c56, trim: 0x005c5c }, // SEA
  137: { home: CREAM, road: GRAY, cap: 0x27251f, letter: 0x27251f, trim: 0xfd5a1e }, // SF
  138: { home: WHITE, road: GRAY, cap: 0xc41e3a, letter: 0xc41e3a, trim: 0x0c2340 }, // STL
  139: { home: WHITE, road: GRAY, cap: 0x092c5c, letter: 0x092c5c, trim: 0x8fbce6 }, // TB
  140: { home: WHITE, road: GRAY, cap: 0x003278, letter: 0xc0111f, trim: 0x003278 }, // TEX
  141: { home: WHITE, road: GRAY, cap: 0x134a8e, letter: 0x134a8e, trim: 0x1d2d5c }, // TOR
  142: { home: WHITE, road: GRAY, cap: 0x002b5c, letter: 0x002b5c, trim: 0xd31145 }, // MIN
  143: { home: WHITE, road: GRAY, cap: 0xe81828, letter: 0xe81828, trim: 0x002d72, stripe: 0xe81828 }, // PHI
  144: { home: WHITE, road: GRAY, cap: 0x13274f, letter: 0xce1141, trim: 0x13274f }, // ATL
  145: { home: WHITE, road: GRAY, cap: 0x1a1a1a, letter: 0x1a1a1a, trim: 0xc4ced4, stripe: 0x1a1a1a }, // CWS
  146: { home: WHITE, road: GRAY, cap: 0x1a1a1a, letter: 0x00a3e0, trim: 0x1a1a1a }, // MIA
  147: { home: WHITE, road: DARK_GRAY, cap: 0x0c2340, letter: 0x0c2340, trim: 0x0c2340, stripe: 0x0c2340 }, // NYY
  158: { home: WHITE, road: GRAY, cap: 0x12284b, letter: 0x12284b, trim: 0xffc52f }, // MIL
};

/** What one side wears this game. */
export interface Uniform {
  teamId: number;
  jersey: number;
  cap: number;
  letter: number;
  trim: number;
  /** Pinstripe colour, or -1. */
  stripe: number;
}

export function uniformFor(teamId: number, home: boolean, fallbackColor: number): Uniform {
  const c = CLUBS[teamId];
  if (!c) return { teamId, jersey: home ? WHITE : GRAY, cap: fallbackColor, letter: fallbackColor, trim: fallbackColor, stripe: -1 };
  return { teamId, jersey: home ? c.home : c.road, cap: c.cap, letter: c.letter, trim: c.trim, stripe: home && c.stripe !== undefined ? c.stripe : -1 };
}

// ---------- cap logos ----------

const logos = new Map<number, HTMLImageElement | null>();
let logoVersion = 0;

/** Bumped whenever a logo finishes loading, so painted caps can be refreshed. */
export const capLogoVersion = () => logoVersion;

/** The club's cap mark if it has loaded (starting the load otherwise); null until then or on failure. */
export function capLogo(teamId: number): HTMLImageElement | null {
  if (!teamId || typeof Image === "undefined") return null;
  if (logos.has(teamId)) {
    const img = logos.get(teamId) ?? null;
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }
  const img = new Image();
  // Painted into a WebGL texture: a tainted canvas would fail to upload.
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  logos.set(teamId, img);
  img.onload = () => {
    logoVersion += 1;
  };
  img.onerror = () => {
    logos.set(teamId, null);
  };
  img.src = mlbTeamLogoUrl(teamId, "dark");
  return null;
}
