/**
 * What a fan in the stands is wearing. Merch comes in a club's real colours: home whites
 * with the club's lettering, road greys, alternates in the cap colour, team tees and hoodies,
 * and team caps on fans in their own clothes. Pure: picks colours from four random numbers.
 */
import { FAN_STYLE } from "@/components/game/scene/parks/textures";

/** A club's merch colours (hex): home and road jersey cloth, cap, lettering. */
export interface FanColors {
  home: number;
  road: number;
  cap: number;
  letter: number;
}

/** One fan's outfit: the top's colour, the trim colour (lettering, logo, stripes, cap) and the atlas style. */
export interface FanFit {
  body: number;
  trim: number;
  style: number;
  merch: boolean;
}

const WHITE = 0xf4f2ec;
const HEATHER = 0x9a9ea4;
const BLACK = 0x23252a;

const rgb = (h: number) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const luma = (h: number) => {
  const [r, g, b] = rgb(h);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};
/** Colour distance, 0..~1.7. */
const dist = (a: number, b: number) => {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2) / 255;
};
/** `want` on `body`, or the first of `alts` that reads against it. */
const against = (body: number, want: number, ...alts: number[]) => {
  for (const c of [want, ...alts]) if (dist(body, c) > 0.32) return c;
  return luma(body) > 0.5 ? BLACK : WHITE;
};

/**
 * Dress one fan. `merchShare` is the chance he is in his club's gear at all; `a`..`d` are
 * uniform randoms in [0, 1).
 */
export function dressFan(kit: FanColors, palette: number[], merchShare: number, a: number, b: number, c: number, d: number): FanFit {
  const pick = (u: number) => palette[Math.floor(u * palette.length) % palette.length];
  if (a < merchShare) {
    if (b < 0.36) {
      // Replica jersey: mostly home whites, some road greys, some alternates in the cap colour.
      if (c < 0.58) return { body: kit.home, trim: against(kit.home, kit.cap, kit.letter), style: FAN_STYLE.jersey, merch: true };
      if (c < 0.8) return { body: kit.road, trim: against(kit.road, kit.letter, kit.cap), style: FAN_STYLE.jersey, merch: true };
      return { body: kit.cap, trim: against(kit.cap, kit.letter, WHITE), style: FAN_STYLE.jersey, merch: true };
    }
    if (b < 0.74) {
      // Team tee: club colour with a white or lettering logo, or a white/grey/black tee with a club logo.
      const body = c < 0.6 ? kit.cap : c < 0.75 ? WHITE : c < 0.88 ? HEATHER : BLACK;
      const trim = body === kit.cap ? against(body, d < 0.5 ? WHITE : kit.letter, WHITE) : against(body, kit.cap, kit.letter);
      return { body, trim, style: FAN_STYLE.tee, merch: true };
    }
    // Team hoodie or jacket.
    const body = c < 0.55 ? kit.cap : c < 0.8 ? kit.letter : HEATHER;
    return { body, trim: against(body, kit.cap, kit.letter, WHITE), style: FAN_STYLE.hoodie, merch: true };
  }
  // His own clothes; about one in three still has the club's cap on.
  const style = b < 0.55 ? FAN_STYLE.plain : b < 0.8 ? FAN_STYLE.tee : FAN_STYLE.hoodie;
  const body = pick(c);
  const trim = d < 0.33 ? against(body, kit.cap, kit.letter) : against(body, pick((d * 7.31) % 1), pick((d * 3.17) % 1));
  return { body, trim, style, merch: false };
}
