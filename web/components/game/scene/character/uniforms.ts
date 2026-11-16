/**
 * Club uniforms for Play Ball. Every club's 2026 home and road set is written out as a
 * kit: cloth, lettering and its outline, what the chest carries (script, block capitals,
 * an arch, the club's own wordmark or its cap mark), where the numbers go and in what
 * colour, placket piping, collar and sleeve-end braid, trouser piping, pinstripes, socks,
 * undershirt, belt, and the cap's crown and bill. Checked against the uniform diagrams on
 * each club's Wikipedia page (see docs in the lab page).
 */
import { mlbTeamLogoUrl } from "@/lib/mlb/teamAssets";

/** How the chest is lettered. */
export type ChestStyle =
  /** The club's own wordmark image (mlbstatic). */
  | "mark"
  /** Script, climbing, optionally with a tail swept back under it. */
  | "script"
  /** Block capitals set straight, or on an arch. */
  | "block"
  | "arch"
  /** Slab-serif capitals (Rays, Texas). */
  | "serif"
  /** The cap mark on the wearer's left chest. */
  | "logo"
  /** Cincinnati's wishbone C with REDS inside it. */
  | "reds"
  /** St. Louis: script over two birds perched on a bat. */
  | "birds";

/** One jersey-and-trousers set. Colours are 0xRRGGBB; -1 means "none". */
export interface Kit {
  jersey: number;
  pants: number;
  /** Chest lettering and its outline. */
  ink: number;
  edge: number;
  chest: ChestStyle;
  text: string;
  /** Script only: a tail under the word. */
  tail: boolean;
  /** The cap mark worn small under the lettering (Toronto). */
  badge: boolean;
  /** Front number colour and outline, and the side it sits on: 1 the wearer's left, -1 the right. */
  num: number;
  numEdge: number;
  numSide: 1 | -1;
  /** Back number, its outline, and the name over it. */
  back: number;
  backEdge: number;
  name: number;
  /** Piping down both sides of the placket, outermost first. */
  placket: number[];
  /** Braid round the collar and round the sleeve ends, outermost (hem) first. */
  collar: number[];
  cuff: number[];
  /** Piping down the trouser seam. */
  pipe: number[];
  stripe: number;
  sock: number;
  /** Stripes on the socks of players who wear them striped. */
  sockBand: number;
  under: number;
  belt: number;
  cap: number;
  bill: number;
  /** Front panel of the cap where it differs from the crown. */
  capFront: number;
  /** Club accent for wristbands, batting gloves and catcher's gear. */
  accent: number;
}

const WHITE = 0xf4f3ee;
const CREAM = 0xf1e9d2;
const GRAY = 0xb1b4b9;
const DARK_GRAY = 0x9a9ea5;
const SAND = 0xb7a98c;
const POWDER = 0x6ea6d8;
const BLACK = 0x1a1a1a;
const PURE = 0xffffff;
const SILVER = 0xc4ced4;

type Spec = Partial<Kit> & { chest: ChestStyle };

/** Fill in a kit: unlisted parts follow the lettering colour, as most clubs' do. */
function kit(jersey: number, ink: number, s: Spec): Kit {
  const edge = s.edge ?? -1;
  const cap = s.cap ?? ink;
  const dark = s.under ?? cap;
  return {
    jersey,
    pants: jersey,
    ink,
    edge,
    text: "",
    tail: false,
    badge: false,
    num: ink,
    numEdge: edge,
    numSide: 1,
    back: s.num !== undefined && s.num >= 0 ? s.num : ink,
    backEdge: s.numEdge ?? edge,
    name: ink,
    placket: [],
    collar: [],
    cuff: [],
    pipe: [],
    stripe: -1,
    sock: dark,
    sockBand: -1,
    under: dark,
    belt: dark,
    cap,
    bill: cap,
    capFront: -1,
    accent: edge >= 0 && edge !== PURE ? edge : ink,
    ...s,
  };
}

/** Both sets from one description: the road set is the home one with its differences. */
function club(home: Kit, road: Partial<Kit>): [Kit, Kit] {
  return [home, { ...home, jersey: GRAY, pants: road.jersey ?? GRAY, stripe: -1, ...road }];
}

/** [home, road] for every club. */
export const KITS: Record<number, [Kit, Kit]> = (() => {
  const K = BLACK;
  const t: Record<number, [Kit, Kit]> = {};
  {
    // Angels: block ANGELS in red edged navy on both, red braid and socks.
    const R = 0xba0021, N = 0x003263;
    t[108] = club(kit(WHITE, R, { edge: N, chest: "block", text: "ANGELS", collar: [R], cuff: [R], pipe: [R], cap: R, accent: R }), {});
  }
  {
    // D-backs: the A on a cream home shirt; ARIZONA on the grays with black socks and cap.
    const R = 0xa71930, T = 0x30ced8;
    t[109] = club(kit(CREAM, R, { edge: T, chest: "logo", num: -1, back: R, cap: R, bill: K, belt: K, accent: T }), { chest: "block", text: "ARIZONA", cap: K, bill: K, sock: K, under: K, cuff: [K] });
  }
  {
    // Orioles: orange script edged black; white-fronted cap at home.
    const O = 0xdf4601;
    t[110] = club(kit(WHITE, O, { edge: K, chest: "mark", cuff: [O, K], pipe: [K, O, K], cap: K, bill: O, capFront: WHITE, sockBand: O, accent: O }), { chest: "script", text: "Baltimore", tail: true, capFront: -1 });
  }
  {
    // Red Sox: red piping and no name at home; arched BOSTON on the road; no front numbers.
    const R = 0xbd3039, N = 0x0c2340;
    t[111] = club(kit(WHITE, R, { edge: N, chest: "mark", num: -1, back: R, backEdge: N, name: -1, placket: [R], collar: [R], cap: N, under: R, sock: R, belt: N, accent: R }), { chest: "arch", text: "BOSTON", name: R, placket: [], collar: [] });
  }
  {
    // Cubs: pinstripes and the cub roundel at home; CHICAGO with red numbers on the road.
    const B = 0x0e3386, R = 0xcc3433;
    t[112] = club(kit(WHITE, B, { chest: "logo", num: -1, back: B, backEdge: R, stripe: B, accent: R }), { chest: "block", text: "CHICAGO", edge: PURE, num: R, numEdge: PURE, back: R, backEdge: PURE });
  }
  {
    // Reds: wishbone C opposite the number, red piping at home; arched CINCINNATI, black bill on the road.
    const R = 0xc6011f;
    t[113] = club(kit(WHITE, R, { chest: "reds", numSide: -1, placket: [R], collar: [R], cuff: [R], pipe: [R], belt: K, accent: R }), { chest: "arch", text: "CINCINNATI", edge: PURE, numEdge: PURE, backEdge: PURE, numSide: 1, placket: [], collar: [], bill: K, sockBand: K });
  }
  {
    // Guardians: red script at home, block CLEVELAND on the road, red-and-navy braid, navy socks.
    const N = 0x0c2340, R = 0xe31937;
    t[114] = club(kit(WHITE, R, { edge: N, chest: "mark", num: -1, back: R, collar: [R, N], cuff: [R, N], cap: R, bill: N, under: N, sock: N, belt: N, sockBand: R, accent: R }), { chest: "block", text: "CLEVELAND", cap: N, bill: R });
  }
  {
    // Rockies: purple pinstripes and black lettering at home; purple-piped grays.
    const P = 0x33006f;
    t[115] = club(kit(WHITE, K, { edge: SILVER, chest: "arch", text: "ROCKIES", numEdge: -1, backEdge: -1, stripe: P, accent: P }), { ink: P, edge: PURE, text: "COLORADO", num: P, numEdge: PURE, back: P, backEdge: PURE, name: P, placket: [P], pipe: [P], cuff: [P], bill: P });
  }
  {
    // Tigers: Old English D and navy piping at home; orange-edged script on the road.
    const N = 0x0c2340, O = 0xfa4616;
    t[116] = club(kit(WHITE, N, { chest: "logo", num: -1, back: N, placket: [N], collar: [N], sockBand: PURE, accent: O }), { chest: "script", text: "Detroit", edge: O, num: N, numEdge: O, backEdge: O, sockBand: O });
  }
  {
    // Astros: arched block, orange piping at home and navy on the road.
    const N = 0x002d62, O = 0xeb6e1f;
    t[117] = club(kit(WHITE, N, { edge: O, chest: "arch", text: "ASTROS", placket: [O], collar: [O], cuff: [O], pipe: [O], accent: O }), { text: "HOUSTON", placket: [N], collar: [N], cuff: [N], pipe: [N] });
  }
  {
    // Royals: plain royal script and number at home; arched KANSAS CITY with nothing under it.
    const B = 0x004687;
    t[118] = club(kit(WHITE, B, { chest: "mark", cuff: [B, PURE, B], accent: B }), { chest: "arch", text: "KANSAS CITY", num: -1 });
  }
  {
    // Dodgers: royal script, red front number, nothing else.
    const B = 0x005a9c, R = 0xd62432;
    t[119] = club(kit(WHITE, B, { chest: "mark", num: R, back: B, accent: B }), { chest: "script", text: "Los Angeles", tail: true, cuff: [B] });
  }
  {
    // Nationals: navy script edged red and no front number at home; block WASHINGTON on the road.
    const R = 0xab0003, N = 0x14225a;
    t[120] = club(kit(WHITE, N, { edge: R, chest: "mark", num: -1, back: N, collar: [R, N], cuff: [R], pipe: [N, R], cap: R, belt: N, sockBand: PURE, accent: R }), { chest: "block", text: "WASHINGTON", num: R, numEdge: N, cap: N, bill: R, sockBand: N });
  }
  {
    // Mets: blue script edged orange on pinstripes; arched NEW YORK with striped collar and cuffs.
    const B = 0x002d72, O = 0xff5910;
    t[121] = club(kit(WHITE, B, { edge: O, chest: "mark", stripe: B, sockBand: O, accent: O }), { chest: "arch", text: "NEW YORK", collar: [B, O, B], cuff: [B, O, B], pipe: [B, O, B] });
  }
  {
    // Athletics: green script edged gold on both; gold bill at home.
    const G = 0x003831, Y = 0xefb21e;
    t[133] = club(kit(WHITE, G, { edge: Y, chest: "script", text: "Athletics", tail: true, bill: Y, sockBand: Y, accent: Y }), { bill: G });
  }
  {
    // Pirates: black edged gold; block at home, script on the road.
    const P = 0x27251f, Y = 0xfdb827;
    t[134] = club(kit(WHITE, P, { edge: Y, chest: "mark", collar: [P, Y], cuff: [Y, P], pipe: [P, Y, P], accent: Y }), { chest: "script", text: "Pittsburgh" });
  }
  {
    // Padres: brown pinstripes on white at home and on sand on the road; no front numbers.
    const B = 0x2f241d, Y = 0xffc425;
    t[135] = club(kit(WHITE, B, { edge: Y, chest: "mark", num: -1, back: B, stripe: B, collar: [Y, B], cuff: [Y, B], accent: Y }), { jersey: SAND, chest: "arch", text: "SAN DIEGO", stripe: B });
  }
  {
    // Mariners: navy edged green at home; the road set is a navy shirt over gray trousers.
    const N = 0x0c2c56, T = 0x00685e;
    t[136] = club(kit(WHITE, N, { edge: T, chest: "mark", num: -1, back: N, placket: [N], accent: T }), { jersey: N, pants: GRAY, ink: SILVER, chest: "arch", text: "SEATTLE", num: SILVER, numEdge: T, back: SILVER, backEdge: T, name: PURE, placket: [], bill: T });
  }
  {
    // Giants: black edged orange on cream; arched SAN FRANCISCO and black piping on the road.
    const P = 0x27251f, O = 0xfd5a1e;
    t[137] = club(kit(CREAM, P, { edge: O, chest: "mark", num: -1, back: P, cuff: [O, P], pipe: [P, O, P], accent: O }), { chest: "arch", text: "SAN FRANCISCO", placket: [P] });
  }
  {
    // Cardinals: birds on the bat over the script on both; navy cap on the road.
    const R = 0xc41e3a, N = 0x0c2340;
    t[138] = club(kit(WHITE, R, { edge: N, chest: "birds", text: "Cardinals", sockBand: N, accent: R }), { cap: N, bill: N });
  }
  {
    // Rays: navy RAYS with a light-blue shadow and navy piping; the road set is the navy shirt.
    const N = 0x092c5c, L = 0x8fbce6;
    t[139] = club(kit(WHITE, N, { edge: L, chest: "serif", text: "RAYS", num: -1, back: N, placket: [N], sockBand: L, accent: L }), { jersey: N, pants: GRAY, ink: PURE, back: PURE, name: PURE, placket: [L], cuff: [L] });
  }
  {
    // Rangers: script at home, TEXAS on the road, red-and-blue cuffs, no front numbers.
    const B = 0x003278, R = 0xc0111f;
    t[140] = club(kit(WHITE, B, { edge: R, chest: "script", text: "Rangers", tail: true, num: -1, back: B, cuff: [R, B], pipe: [B], accent: R }), { chest: "serif", text: "TEXAS", tail: false });
  }
  {
    // Blue Jays: split block over the bird, blue braid on sleeves and trousers.
    const B = 0x134a8e;
    t[141] = club(kit(WHITE, B, { chest: "block", text: "BLUE JAYS", badge: true, num: -1, back: B, cuff: [B, PURE, B], pipe: [B], accent: B }), { chest: "arch", text: "TORONTO" });
  }
  {
    // Twins: red script and navy number at home; navy-pinstriped grays with MINNESOTA and red numbers.
    const N = 0x002b5c, R = 0xd31145;
    t[142] = club(kit(WHITE, R, { edge: N, chest: "mark", num: N, numEdge: -1, back: R, backEdge: N, name: N, cuff: [R, PURE, N], pipe: [R], cap: N, sockBand: R, accent: R }), { ink: N, edge: -1, chest: "arch", text: "MINNESOTA", num: R, back: R, backEdge: -1, stripe: N });
  }
  {
    // Phillies: red script on red pinstripes; red-and-white cuffs on the road. No front number.
    const R = 0xe81828;
    t[143] = club(kit(WHITE, R, { chest: "mark", num: -1, back: R, stripe: R, accent: R }), { edge: PURE, backEdge: PURE, cuff: [R, PURE, R], pipe: [R] });
  }
  {
    // Braves: red script edged navy over the tomahawk, navy-red-navy piping; red bill at home.
    const N = 0x13274f, R = 0xce1141;
    t[144] = club(kit(WHITE, R, { edge: N, chest: "script", text: "Braves", tail: true, num: -1, back: N, backEdge: R, name: N, placket: [N, R, N], collar: [N, R, N], cuff: [N, R, N], pipe: [N, R, N], cap: N, bill: R, accent: R }), { text: "Atlanta", bill: N });
  }
  {
    // White Sox: black pinstripes with the Sox mark; script Chicago edged white on the road.
    t[145] = club(kit(WHITE, K, { chest: "logo", numSide: -1, stripe: K, sockBand: PURE, accent: SILVER }), { chest: "script", text: "Chicago", edge: PURE, numEdge: PURE, backEdge: PURE, numSide: 1, cuff: [PURE, K, PURE] });
  }
  {
    // Marlins: black script Miami edged blue on both, blue-and-red cuffs.
    const B = 0x00a3e0, R = 0xef3340;
    t[146] = club(kit(WHITE, K, { edge: B, chest: "script", text: "Miami", num: -1, back: K, cuff: [B, R], pipe: [B], accent: B }), {});
  }
  {
    // Yankees: pinstripes and the NY at home, plain NEW YORK grays, never a name.
    const N = 0x0c2340;
    t[147] = club(kit(WHITE, N, { chest: "logo", num: -1, back: N, name: -1, stripe: N, accent: N }), { jersey: DARK_GRAY, chest: "arch", text: "NEW YORK", backEdge: PURE });
  }
  {
    // Brewers: navy edged yellow on cream; powder-blue road shirt over gray trousers.
    const N = 0x12284b, Y = 0xffc52f;
    t[158] = club(kit(CREAM, N, { edge: Y, chest: "mark", cuff: [Y, N], pipe: [N, Y, N], sockBand: Y, accent: Y }), { jersey: POWDER, pants: GRAY, chest: "arch", text: "MILWAUKEE" });
  }
  return t;
})();

/** One line per club: home and road cloth, cap, lettering, trim and home pinstripe. */
export interface ClubUniform {
  home: number;
  road: number;
  cap: number;
  letter: number;
  trim: number;
  stripe?: number;
}
export const CLUBS: Record<number, ClubUniform> = Object.fromEntries(
  Object.entries(KITS).map(([id, [h, r]]) => [id, { home: h.jersey, road: r.jersey, cap: h.cap, letter: h.ink, trim: h.accent, ...(h.stripe >= 0 ? { stripe: h.stripe } : {}) }]),
);

/** What one side wears this game. */
export interface Uniform {
  teamId: number;
  home: boolean;
  jersey: number;
  cap: number;
  letter: number;
  trim: number;
  /** Pinstripe colour, or -1. */
  stripe: number;
  /** The full set; null for a club we have no kit for. */
  kit: Kit | null;
}

export function uniformFor(teamId: number, home: boolean, fallbackColor: number): Uniform {
  const pair = KITS[teamId];
  if (!pair) return { teamId, home, jersey: home ? WHITE : GRAY, cap: fallbackColor, letter: fallbackColor, trim: fallbackColor, stripe: -1, kit: null };
  const k = pair[home ? 0 : 1];
  return { teamId, home, jersey: k.jersey, cap: k.cap, letter: k.ink, trim: k.accent, stripe: k.stripe, kit: k };
}

/** A kit for somebody without a club set: plain cloth with everything in one trim colour. */
export function plainKit(jersey: number, ink: number, cap: number, accent: number, stripe: number): Kit {
  return kit(jersey, ink, { chest: "script", cap, stripe, accent, sock: accent });
}

// ---------- script face ----------

let scriptFamily = "";
/** The loaded web script face for chest lettering, or "" while only system fallbacks are available. */
export const scriptFont = () => scriptFamily;
/** Called once the bundled script face is ready: uniforms repaint with it. */
export function setScriptFont(family: string): void {
  if (family === scriptFamily) return;
  scriptFamily = family;
  logoVersion += 1;
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

// ---------- chest marks ----------

/** A club mark ready to be drawn on a jersey: the image (or a crop of it) and its size. */
export interface Mark {
  src: CanvasImageSource;
  w: number;
  h: number;
}

const marks = new Map<string, Mark | null>();

/**
 * Cut a wordmark down to its main line: league wordmarks often stack the city over the
 * nickname, and a chest carries one of them. Rows of ink are grouped into lines; the line
 * with the most ink wins, cropped to its own width.
 */
function mainLine(img: HTMLImageElement): Mark | null {
  const ar = img.naturalWidth / Math.max(1, img.naturalHeight);
  const W = 512;
  const H = Math.max(8, Math.min(1024, Math.round(W / Math.max(0.2, ar))));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0, W, H);
  let data: Uint8ClampedArray;
  try {
    data = g.getImageData(0, 0, W, H).data;
  } catch {
    return null;
  }
  const row = new Float32Array(H);
  for (let y = 0; y < H; y += 1) {
    let n = 0;
    for (let x = 0; x < W; x += 1) n += data[(y * W + x) * 4 + 3] > 40 ? 1 : 0;
    row[y] = n;
  }
  // Lines: runs of inked rows, allowing hairline gaps.
  const gap = Math.max(2, Math.round(H * 0.012));
  let best: [number, number] | null = null;
  let bestInk = 0;
  let y = 0;
  while (y < H) {
    while (y < H && row[y] === 0) y += 1;
    if (y >= H) break;
    const y0 = y;
    let ink = 0;
    let blank = 0;
    let y1 = y;
    while (y < H && blank <= gap) {
      if (row[y] > 0) {
        ink += row[y];
        blank = 0;
        y1 = y;
      } else blank += 1;
      y += 1;
    }
    if (ink > bestInk) {
      bestInk = ink;
      best = [y0, y1 + 1];
    }
  }
  if (!best) return null;
  let x0 = W;
  let x1 = 0;
  for (let yy = best[0]; yy < best[1]; yy += 1) {
    for (let x = 0; x < W; x += 1) {
      if (data[(yy * W + x) * 4 + 3] > 40) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
  }
  if (x1 <= x0) return null;
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = best[1] - best[0];
  const og = out.getContext("2d");
  if (!og) return null;
  og.drawImage(c, x0, best[0], out.width, out.height, 0, 0, out.width, out.height);
  return { src: out, w: out.width, h: out.height };
}

function loadMark(key: string, url: string, crop: boolean): Mark | null {
  if (typeof Image === "undefined" || typeof document === "undefined") return null;
  if (marks.has(key)) return marks.get(key) ?? null;
  marks.set(key, null);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.onload = () => {
    if (!img.naturalWidth) return;
    const m = crop ? mainLine(img) : { src: img, w: img.naturalWidth, h: img.naturalHeight };
    if (m) {
      marks.set(key, m);
      logoVersion += 1;
    }
  };
  img.src = url;
  return null;
}

/** The club's wordmark for a light or dark jersey, once loaded (null until then, on failure, or if the club has none that fits). */
export function chestWordmark(teamId: number, darkJersey: boolean): Mark | null {
  if (!teamId) return null;
  const surface = darkJersey ? "on-dark" : "on-light";
  return loadMark(`w${surface}${teamId}`, `https://www.mlbstatic.com/team-logos/team-wordmark-${surface}/${teamId}.svg`, true);
}

/** The club's cap mark in its light-background colours, for the left chest. */
export function chestLogo(teamId: number, darkJersey: boolean): Mark | null {
  if (!teamId) return null;
  return loadMark(`l${darkJersey ? "d" : "l"}${teamId}`, mlbTeamLogoUrl(teamId, darkJersey ? "dark" : "light"), false);
}
