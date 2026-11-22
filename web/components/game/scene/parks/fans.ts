/**
 * What a fan in the stands is wearing. Merch is the clubs' real gear: replica jerseys of
 * every set the club wears (home, road, alternates, City Connect) with real numbers and
 * lettering, team tees and hoodies, and the matching on-field caps; fans in their own
 * clothes wear neutrals, often with a team cap. Pure: `lineup` lists the designs a game
 * needs (merch.ts paints them), `dressFan` picks one outfit from a few random numbers.
 */
import { FAN_STYLE } from "@/components/game/scene/parks/textures";
import { clubSets, KITS, plainKit, type Kit } from "@/components/game/scene/character/uniforms";

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
  /** Design slots (see `lineup`) for the shirt and the cap; -1 without a wardrobe. */
  garment: number;
  cap: number;
}

/** A shirt design for the crowd's design atlas. */
export interface GarmentDesign {
  kind: "jersey" | "tee" | "hoodie" | "own";
  /** MLB team id for marks (0 = none). */
  teamId: number;
  /** Jerseys: the full set, painted the way the players' own is. */
  kit: Kit | null;
  cloth: number;
  ink: number;
  /** Lettering outline, or -1. */
  edge: number;
  /** What the front carries. */
  motif: "set" | "wordmark" | "logo" | "number" | "plain" | "stripes" | "graphic";
  /** Wordmark text for a tee or hoodie (when the club's mark has not loaded). */
  text: string;
  number: string;
  /** Collar and cuff braid colour. */
  trim: number;
  /** Pinstripe or stripe colour, or -1. */
  stripe: number;
}

/** A cap design: crown, front panels, bill, and whether it carries the club's mark (tinted, or -1 for its own colours). */
export interface CapDesign {
  teamId: number;
  crown: number;
  front: number;
  bill: number;
  logo: boolean;
  tint: number;
}

/** Slot lists (indices into the lineup's designs, repeated to weight them) for one club's fans. */
export interface SideWardrobe {
  jersey: number[];
  tee: number[];
  hoodie: number[];
  cap: number[];
}

/** Everything the crowd wears this game. */
export interface Lineup {
  garments: GarmentDesign[];
  caps: CapDesign[];
  home: SideWardrobe;
  away: SideWardrobe | null;
  /** Fans in their own clothes: shirts, and caps (club caps of the home side mixed in). */
  own: SideWardrobe;
}

/** Room in the design atlas (merch.ts): 48 shirt panels, 64 cap panels. */
export const MAX_GARMENTS = 48;
export const MAX_CAPS = 64;

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

const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** Numbers fans wear: mostly the stars' singles and teens, some anything. */
const shirtNumber = (team: number, k: number) => {
  const pool = [2, 3, 5, 7, 8, 9, 10, 12, 13, 17, 18, 19, 22, 23, 24, 25, 27, 28, 29, 31, 34, 35, 44, 50, 99];
  const u = hash(team, k);
  return String(u < 0.8 ? pool[Math.floor(hash(team, k + 50) * pool.length)] : 1 + Math.floor(hash(team, k + 90) * 98));
};

/** A club's sets: its real ones, or a plain pair in its scoreboard colours. */
function setsFor(teamId: number | undefined, colors: FanColors) {
  if (teamId != null && KITS[teamId]) return clubSets(teamId);
  const home = plainKit(colors.home, colors.letter, colors.cap, colors.letter, -1);
  return [
    { id: "home", name: "Home", kit: home },
    { id: "road", name: "Road", kit: { ...home, jersey: colors.road, pants: colors.road } },
  ];
}

/**
 * The designs one game's crowd wears: both clubs' merch and everyday clothes, laid out for
 * the design atlas, and which of them each kind of fan picks from.
 */
export function lineup(home: { teamId?: number; colors: FanColors }, away: { teamId?: number; colors: FanColors } | null, palette: number[]): Lineup {
  const garments: GarmentDesign[] = [];
  const caps: CapDesign[] = [];
  const g = (d: GarmentDesign, weight: number, into: number[]) => {
    if (garments.length >= MAX_GARMENTS) return;
    garments.push(d);
    for (let i = 0; i < weight; i += 1) into.push(garments.length - 1);
  };
  const c = (d: CapDesign, weight: number, into: number[]) => {
    if (caps.length >= MAX_CAPS) return;
    caps.push(d);
    for (let i = 0; i < weight; i += 1) into.push(caps.length - 1);
  };
  const side = (teamId: number | undefined, colors: FanColors, share: number): SideWardrobe => {
    const w: SideWardrobe = { jersey: [], tee: [], hoodie: [], cap: [] };
    const id = teamId ?? 0;
    const sets = setsFor(teamId, colors);
    const extra = sets.length - 2;
    sets.forEach((set, si) => {
      const k = set.kit;
      // Home whites are the most worn, then the City Connect and alternates, then road greys.
      const copies = si === 0 ? Math.round(3 * share) || 1 : set.id === "cc" ? 2 : 1;
      const weight = si === 0 ? 4 : set.id === "cc" ? 3 : si === 1 ? 2 : Math.max(1, Math.round(4 / Math.max(1, extra)));
      for (let j = 0; j < copies; j += 1) {
        g({ kind: "jersey", teamId: id, kit: k, cloth: k.jersey, ink: k.ink, edge: k.edge, motif: "set", text: k.text, number: shirtNumber(id, si * 10 + j), trim: k.cuff[0] ?? k.ink, stripe: k.stripe }, weight, w.jersey);
      }
      // Each set's cap.
      c({ teamId: id, crown: k.cap, front: k.capFront >= 0 ? k.capFront : k.cap, bill: k.bill, logo: true, tint: -1 }, si === 0 ? 5 : si === 1 ? 1 : 2, w.cap);
    });
    const h = sets[0].kit;
    const cc = sets.find((x) => x.id === "cc")?.kit;
    const cap = colors.cap;
    const light = (x: number) => luma(x) > 0.55;
    const on = (cloth: number, ...inks: number[]) => against(cloth, inks[0], ...inks.slice(1), WHITE);
    const nick = h.text || "";
    // Tees: the club colour with the wordmark or a big number, a white tee with the cap mark, a grey one.
    g({ kind: "tee", teamId: id, kit: null, cloth: cap, ink: on(cap, light(cap) ? colors.letter : WHITE, colors.letter), edge: -1, motif: "wordmark", text: nick, number: "", trim: cap, stripe: -1 }, 4, w.tee);
    g({ kind: "tee", teamId: id, kit: null, cloth: cap, ink: on(cap, WHITE, colors.letter), edge: -1, motif: "number", text: nick, number: shirtNumber(id, 77), trim: cap, stripe: -1 }, 2, w.tee);
    g({ kind: "tee", teamId: id, kit: null, cloth: WHITE, ink: on(WHITE, colors.letter, cap), edge: -1, motif: "logo", text: nick, number: "", trim: WHITE, stripe: -1 }, 2, w.tee);
    g({ kind: "tee", teamId: id, kit: null, cloth: HEATHER, ink: on(HEATHER, cap, colors.letter), edge: -1, motif: "wordmark", text: nick, number: "", trim: HEATHER, stripe: -1 }, 1, w.tee);
    if (cc) g({ kind: "tee", teamId: id, kit: null, cloth: cc.jersey, ink: on(cc.jersey, cc.ink), edge: -1, motif: "wordmark", text: cc.text || nick, number: "", trim: cc.jersey, stripe: -1 }, 2, w.tee);
    // Hoodies and jackets.
    g({ kind: "hoodie", teamId: id, kit: null, cloth: cap, ink: on(cap, WHITE, colors.letter), edge: -1, motif: "wordmark", text: nick, number: "", trim: cap, stripe: -1 }, 3, w.hoodie);
    const alt = colors.letter !== cap ? colors.letter : HEATHER;
    g({ kind: "hoodie", teamId: id, kit: null, cloth: alt, ink: on(alt, cap, WHITE), edge: -1, motif: "logo", text: nick, number: "", trim: alt, stripe: -1 }, 2, w.hoodie);
    // A white-crowned fashion cap.
    c({ teamId: id, crown: WHITE, front: WHITE, bill: cap, logo: true, tint: -1 }, 1, w.cap);
    return w;
  };
  const homeW = side(home.teamId, home.colors, 1);
  const awayW = away ? side(away.teamId, away.colors, 0.67) : null;
  // Everyday clothes: plain neutrals, striped and printed tees; neutral caps, or the home club's.
  const own: SideWardrobe = { jersey: [], tee: [], hoodie: [], cap: [] };
  const neutrals = palette.length ? palette : [WHITE, HEATHER, BLACK];
  const room = MAX_GARMENTS - garments.length;
  for (let i = 0; i < Math.min(room, 10); i += 1) {
    const cloth = neutrals[i % neutrals.length];
    const motif = i < 6 ? "plain" : i < 8 ? "stripes" : "graphic";
    const stripe = motif === "stripes" ? (luma(cloth) > 0.5 ? 0x20283a : WHITE) : motif === "graphic" ? neutrals[(i * 3 + 1) % neutrals.length] : -1;
    g({ kind: "own", teamId: 0, kit: null, cloth, ink: against(cloth, BLACK, WHITE), edge: -1, motif, text: "", number: "", trim: cloth, stripe }, 1, own.tee);
  }
  own.jersey = own.hoodie = own.tee;
  for (const crown of [0x20283a, BLACK, 0xb7a98c, WHITE, 0x5b6470]) c({ teamId: 0, crown, front: crown, bill: crown, logo: false, tint: -1 }, 1, own.cap);
  own.cap.push(...homeW.cap, ...homeW.cap);
  return { garments, caps, home: homeW, away: awayW, own };
}

/**
 * Dress one fan. `merchShare` is the chance he is in his club's gear at all; `a`..`d` are
 * uniform randoms in [0, 1). `palette` is everyday clothes (whites, greys, navy, denim,
 * khaki), kept neutral so the club colours are what the stands read as.
 */
export function dressFan(kit: FanColors, palette: number[], merchShare: number, a: number, b: number, c: number, d: number, wardrobe?: { side: SideWardrobe; own: SideWardrobe }): FanFit {
  const fit = dressColors(kit, palette, merchShare, a, b, c, d);
  if (!wardrobe) return { ...fit, garment: -1, cap: -1 };
  const w = fit.merch ? wardrobe.side : wardrobe.own;
  const list = fit.style === FAN_STYLE.jersey ? w.jersey : fit.style === FAN_STYLE.hoodie ? w.hoodie : w.tee;
  const from = (l: number[], u: number) => (l.length ? l[Math.floor(u * l.length) % l.length] : -1);
  return { ...fit, garment: from(list.length ? list : wardrobe.own.tee, hash(c * 997, d * 991)), cap: from(w.cap.length ? w.cap : wardrobe.own.cap, hash(d * 613, a * 787)) };
}

function dressColors(kit: FanColors, palette: number[], merchShare: number, a: number, b: number, c: number, d: number): Omit<FanFit, "garment" | "cap"> {
  const pick = (u: number) => palette[Math.floor(u * palette.length) % palette.length];
  if (a < merchShare) {
    if (b < 0.4) {
      // Replica jersey: home whites, road greys, and alternates in the cap colour.
      if (c < 0.5) return { body: kit.home, trim: against(kit.home, kit.cap, kit.letter), style: FAN_STYLE.jersey, merch: true };
      if (c < 0.68) return { body: kit.road, trim: against(kit.road, kit.letter, kit.cap), style: FAN_STYLE.jersey, merch: true };
      return { body: kit.cap, trim: against(kit.cap, kit.letter, WHITE), style: FAN_STYLE.jersey, merch: true };
    }
    if (b < 0.76) {
      // Team tee: mostly the club colour with a white or lettering logo; some white or grey
      // tees with the club logo across the chest.
      const body = c < 0.72 ? kit.cap : c < 0.86 ? kit.letter : c < 0.94 ? WHITE : HEATHER;
      const trim = body === kit.cap || body === kit.letter ? against(body, d < 0.5 ? WHITE : kit.letter, kit.cap, WHITE) : against(body, kit.cap, kit.letter);
      return { body, trim, style: FAN_STYLE.tee, merch: true };
    }
    // Team hoodie or jacket.
    const body = c < 0.62 ? kit.cap : c < 0.9 ? kit.letter : HEATHER;
    return { body, trim: against(body, kit.cap, kit.letter, WHITE), style: FAN_STYLE.hoodie, merch: true };
  }
  // His own clothes; about half still have the club's cap or colours on.
  const style = b < 0.55 ? FAN_STYLE.plain : b < 0.8 ? FAN_STYLE.tee : FAN_STYLE.hoodie;
  const body = pick(c);
  const trim = d < 0.5 ? against(body, kit.cap, kit.letter) : against(body, pick((d * 7.31) % 1), pick((d * 3.17) % 1));
  return { body, trim, style, merch: false };
}
