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
  return [
    home,
    { ...home, jersey: GRAY, pants: road.jersey ?? GRAY, stripe: -1, ...road },
  ];
}

/** [home, road] for every club. */
export const KITS: Record<number, [Kit, Kit]> = (() => {
  const K = BLACK;
  const t: Record<number, [Kit, Kit]> = {};
  {
    // Angels: block ANGELS in red edged navy on both, red braid and socks.
    const R = 0xba0021,
      N = 0x003263;
    t[108] = club(
      kit(WHITE, R, {
        edge: N,
        chest: "block",
        text: "ANGELS",
        collar: [R],
        cuff: [R],
        pipe: [R],
        cap: R,
        accent: R,
      }),
      {},
    );
  }
  {
    // D-backs: the A on a cream home shirt; ARIZONA on the grays with black socks and cap.
    const R = 0xa71930,
      T = 0x30ced8;
    t[109] = club(
      kit(CREAM, R, {
        edge: T,
        chest: "logo",
        num: -1,
        back: R,
        cap: R,
        bill: K,
        belt: K,
        accent: T,
      }),
      {
        chest: "block",
        text: "ARIZONA",
        cap: K,
        bill: K,
        sock: K,
        under: K,
        cuff: [K],
      },
    );
  }
  {
    // Orioles: orange script edged black; white-fronted cap at home.
    const O = 0xdf4601;
    t[110] = club(
      kit(WHITE, O, {
        edge: K,
        chest: "mark",
        cuff: [O, K],
        pipe: [K, O, K],
        cap: K,
        bill: O,
        capFront: WHITE,
        sockBand: O,
        accent: O,
      }),
      { chest: "script", text: "Baltimore", tail: true, capFront: -1 },
    );
  }
  {
    // Red Sox: red piping and no name at home; arched BOSTON on the road; no front numbers.
    const R = 0xbd3039,
      N = 0x0c2340;
    t[111] = club(
      kit(WHITE, R, {
        edge: N,
        chest: "mark",
        num: -1,
        back: R,
        backEdge: N,
        name: -1,
        placket: [R],
        collar: [R],
        cap: N,
        under: R,
        sock: R,
        belt: N,
        accent: R,
      }),
      { chest: "arch", text: "BOSTON", name: R, placket: [], collar: [] },
    );
  }
  {
    // Cubs: pinstripes and the cub roundel at home; CHICAGO with red numbers on the road.
    const B = 0x0e3386,
      R = 0xcc3433;
    t[112] = club(
      kit(WHITE, B, {
        chest: "logo",
        num: -1,
        back: B,
        backEdge: R,
        stripe: B,
        accent: R,
      }),
      {
        chest: "block",
        text: "CHICAGO",
        edge: PURE,
        num: R,
        numEdge: PURE,
        back: R,
        backEdge: PURE,
      },
    );
  }
  {
    // Reds: wishbone C opposite the number, red piping at home; arched CINCINNATI, black bill on the road.
    const R = 0xc6011f;
    t[113] = club(
      kit(WHITE, R, {
        chest: "reds",
        numSide: -1,
        placket: [R],
        collar: [R],
        cuff: [R],
        pipe: [R],
        belt: K,
        accent: R,
      }),
      {
        chest: "arch",
        text: "CINCINNATI",
        edge: PURE,
        numEdge: PURE,
        backEdge: PURE,
        numSide: 1,
        placket: [],
        collar: [],
        bill: K,
        sockBand: K,
      },
    );
  }
  {
    // Guardians: red script at home, block CLEVELAND on the road, red-and-navy braid, navy socks.
    const N = 0x0c2340,
      R = 0xe31937;
    t[114] = club(
      kit(WHITE, R, {
        edge: N,
        chest: "mark",
        num: -1,
        back: R,
        collar: [R, N],
        cuff: [R, N],
        cap: R,
        bill: N,
        under: N,
        sock: N,
        belt: N,
        sockBand: R,
        accent: R,
      }),
      { chest: "block", text: "CLEVELAND", cap: N, bill: R },
    );
  }
  {
    // Rockies: purple pinstripes and black lettering at home; purple-piped grays.
    const P = 0x33006f;
    t[115] = club(
      kit(WHITE, K, {
        edge: SILVER,
        chest: "arch",
        text: "ROCKIES",
        numEdge: -1,
        backEdge: -1,
        stripe: P,
        accent: P,
      }),
      {
        ink: P,
        edge: PURE,
        text: "COLORADO",
        num: P,
        numEdge: PURE,
        back: P,
        backEdge: PURE,
        name: P,
        placket: [P],
        pipe: [P],
        cuff: [P],
        bill: P,
      },
    );
  }
  {
    // Tigers: Old English D and navy piping at home; orange-edged script on the road.
    const N = 0x0c2340,
      O = 0xfa4616;
    t[116] = club(
      kit(WHITE, N, {
        chest: "logo",
        num: -1,
        back: N,
        placket: [N],
        collar: [N],
        sockBand: PURE,
        accent: O,
      }),
      {
        chest: "script",
        text: "Detroit",
        edge: O,
        num: N,
        numEdge: O,
        backEdge: O,
        sockBand: O,
      },
    );
  }
  {
    // Astros: arched block, orange piping at home and navy on the road.
    const N = 0x002d62,
      O = 0xeb6e1f;
    t[117] = club(
      kit(WHITE, N, {
        edge: O,
        chest: "arch",
        text: "ASTROS",
        placket: [O],
        collar: [O],
        cuff: [O],
        pipe: [O],
        accent: O,
      }),
      { text: "HOUSTON", placket: [N], collar: [N], cuff: [N], pipe: [N] },
    );
  }
  {
    // Royals: plain royal script and number at home; arched KANSAS CITY with nothing under it.
    const B = 0x004687;
    t[118] = club(
      kit(WHITE, B, { chest: "mark", cuff: [B, PURE, B], accent: B }),
      { chest: "arch", text: "KANSAS CITY", num: -1 },
    );
  }
  {
    // Dodgers: royal script, red front number, nothing else.
    const B = 0x005a9c,
      R = 0xd62432;
    t[119] = club(
      kit(WHITE, B, { chest: "mark", num: R, back: B, accent: B }),
      { chest: "script", text: "Los Angeles", tail: true, cuff: [B] },
    );
  }
  {
    // Nationals: navy script edged red and no front number at home; block WASHINGTON on the road.
    const R = 0xab0003,
      N = 0x14225a;
    t[120] = club(
      kit(WHITE, N, {
        edge: R,
        chest: "mark",
        num: -1,
        back: N,
        collar: [R, N],
        cuff: [R],
        pipe: [N, R],
        cap: R,
        belt: N,
        sockBand: PURE,
        accent: R,
      }),
      {
        chest: "block",
        text: "WASHINGTON",
        num: R,
        numEdge: N,
        cap: N,
        bill: R,
        sockBand: N,
      },
    );
  }
  {
    // Mets: blue script edged orange on pinstripes; arched NEW YORK with striped collar and cuffs.
    const B = 0x002d72,
      O = 0xff5910;
    t[121] = club(
      kit(WHITE, B, {
        edge: O,
        chest: "mark",
        stripe: B,
        sockBand: O,
        accent: O,
      }),
      {
        chest: "arch",
        text: "NEW YORK",
        collar: [B, O, B],
        cuff: [B, O, B],
        pipe: [B, O, B],
      },
    );
  }
  {
    // Athletics: green script edged gold on both; gold bill at home.
    const G = 0x003831,
      Y = 0xefb21e;
    t[133] = club(
      kit(WHITE, G, {
        edge: Y,
        chest: "script",
        text: "Athletics",
        tail: true,
        bill: Y,
        sockBand: Y,
        accent: Y,
      }),
      { bill: G },
    );
  }
  {
    // Pirates: black edged gold; block at home, script on the road.
    const P = 0x27251f,
      Y = 0xfdb827;
    t[134] = club(
      kit(WHITE, P, {
        edge: Y,
        chest: "mark",
        collar: [P, Y],
        cuff: [Y, P],
        pipe: [P, Y, P],
        accent: Y,
      }),
      { chest: "script", text: "Pittsburgh" },
    );
  }
  {
    // Padres: brown pinstripes on white at home and on sand on the road; no front numbers.
    const B = 0x2f241d,
      Y = 0xffc425;
    t[135] = club(
      kit(WHITE, B, {
        edge: Y,
        chest: "mark",
        num: -1,
        back: B,
        stripe: B,
        collar: [Y, B],
        cuff: [Y, B],
        accent: Y,
      }),
      { jersey: SAND, chest: "arch", text: "SAN DIEGO", stripe: B },
    );
  }
  {
    // Mariners: navy edged green at home; the road set is a navy shirt over gray trousers.
    const N = 0x0c2c56,
      T = 0x00685e;
    t[136] = club(
      kit(WHITE, N, {
        edge: T,
        chest: "mark",
        num: -1,
        back: N,
        placket: [N],
        accent: T,
      }),
      {
        jersey: N,
        pants: GRAY,
        ink: SILVER,
        chest: "arch",
        text: "SEATTLE",
        num: SILVER,
        numEdge: T,
        back: SILVER,
        backEdge: T,
        name: PURE,
        placket: [],
        bill: T,
      },
    );
  }
  {
    // Giants: black edged orange on cream; arched SAN FRANCISCO and black piping on the road.
    const P = 0x27251f,
      O = 0xfd5a1e;
    t[137] = club(
      kit(CREAM, P, {
        edge: O,
        chest: "mark",
        num: -1,
        back: P,
        cuff: [O, P],
        pipe: [P, O, P],
        accent: O,
      }),
      { chest: "arch", text: "SAN FRANCISCO", placket: [P] },
    );
  }
  {
    // Cardinals: birds on the bat over the script on both; navy cap on the road.
    const R = 0xc41e3a,
      N = 0x0c2340;
    t[138] = club(
      kit(WHITE, R, {
        edge: N,
        chest: "birds",
        text: "Cardinals",
        sockBand: N,
        accent: R,
      }),
      { cap: N, bill: N },
    );
  }
  {
    // Rays: navy RAYS with a light-blue shadow and navy piping; the road set is the navy shirt.
    const N = 0x092c5c,
      L = 0x8fbce6;
    t[139] = club(
      kit(WHITE, N, {
        edge: L,
        chest: "serif",
        text: "RAYS",
        num: -1,
        back: N,
        placket: [N],
        sockBand: L,
        accent: L,
      }),
      {
        jersey: N,
        pants: GRAY,
        ink: PURE,
        back: PURE,
        name: PURE,
        placket: [L],
        cuff: [L],
      },
    );
  }
  {
    // Rangers: script at home, TEXAS on the road, red-and-blue cuffs, no front numbers.
    const B = 0x003278,
      R = 0xc0111f;
    t[140] = club(
      kit(WHITE, B, {
        edge: R,
        chest: "script",
        text: "Rangers",
        tail: true,
        num: -1,
        back: B,
        cuff: [R, B],
        pipe: [B],
        accent: R,
      }),
      { chest: "serif", text: "TEXAS", tail: false },
    );
  }
  {
    // Blue Jays: split block over the bird, blue braid on sleeves and trousers.
    const B = 0x134a8e;
    t[141] = club(
      kit(WHITE, B, {
        chest: "block",
        text: "BLUE JAYS",
        badge: true,
        num: -1,
        back: B,
        cuff: [B, PURE, B],
        pipe: [B],
        accent: B,
      }),
      { chest: "arch", text: "TORONTO" },
    );
  }
  {
    // Twins: red script and navy number at home; navy-pinstriped grays with MINNESOTA and red numbers.
    const N = 0x002b5c,
      R = 0xd31145;
    t[142] = club(
      kit(WHITE, R, {
        edge: N,
        chest: "mark",
        num: N,
        numEdge: -1,
        back: R,
        backEdge: N,
        name: N,
        cuff: [R, PURE, N],
        pipe: [R],
        cap: N,
        sockBand: R,
        accent: R,
      }),
      {
        ink: N,
        edge: -1,
        chest: "arch",
        text: "MINNESOTA",
        num: R,
        back: R,
        backEdge: -1,
        stripe: N,
      },
    );
  }
  {
    // Phillies: red script on red pinstripes; red-and-white cuffs on the road. No front number.
    const R = 0xe81828;
    t[143] = club(
      kit(WHITE, R, { chest: "mark", num: -1, back: R, stripe: R, accent: R }),
      { edge: PURE, backEdge: PURE, cuff: [R, PURE, R], pipe: [R] },
    );
  }
  {
    // Braves: red script edged navy over the tomahawk, navy-red-navy piping; red bill at home.
    const N = 0x13274f,
      R = 0xce1141;
    t[144] = club(
      kit(WHITE, R, {
        edge: N,
        chest: "script",
        text: "Braves",
        tail: true,
        num: -1,
        back: N,
        backEdge: R,
        name: N,
        placket: [N, R, N],
        collar: [N, R, N],
        cuff: [N, R, N],
        pipe: [N, R, N],
        cap: N,
        bill: R,
        accent: R,
      }),
      { text: "Atlanta", bill: N },
    );
  }
  {
    // White Sox: black pinstripes with the Sox mark; script Chicago edged white on the road.
    t[145] = club(
      kit(WHITE, K, {
        chest: "logo",
        numSide: -1,
        stripe: K,
        sockBand: PURE,
        accent: SILVER,
      }),
      {
        chest: "script",
        text: "Chicago",
        edge: PURE,
        numEdge: PURE,
        backEdge: PURE,
        numSide: 1,
        cuff: [PURE, K, PURE],
      },
    );
  }
  {
    // Marlins: black script Miami edged blue on both, blue-and-red cuffs.
    const B = 0x00a3e0,
      R = 0xef3340;
    t[146] = club(
      kit(WHITE, K, {
        edge: B,
        chest: "script",
        text: "Miami",
        num: -1,
        back: K,
        cuff: [B, R],
        pipe: [B],
        accent: B,
      }),
      {},
    );
  }
  {
    // Yankees: pinstripes and the NY at home, plain NEW YORK grays, never a name.
    const N = 0x0c2340;
    t[147] = club(
      kit(WHITE, N, {
        chest: "logo",
        num: -1,
        back: N,
        name: -1,
        stripe: N,
        accent: N,
      }),
      { jersey: DARK_GRAY, chest: "arch", text: "NEW YORK", backEdge: PURE },
    );
  }
  {
    // Brewers: navy edged yellow on cream; powder-blue road shirt over gray trousers.
    const N = 0x12284b,
      Y = 0xffc52f;
    t[158] = club(
      kit(CREAM, N, {
        edge: Y,
        chest: "mark",
        cuff: [Y, N],
        pipe: [N, Y, N],
        sockBand: Y,
        accent: Y,
      }),
      { jersey: POWDER, pants: GRAY, chest: "arch", text: "MILWAUKEE" },
    );
  }
  return t;
})();

/** One of a club's sets, by name: "home", "road", "alt1"…, "cc" (City Connect). */
export interface KitSet {
  id: string;
  name: string;
  kit: Kit;
}

/** Alternates and City Connect sets, per club (built from their home kit with the differences). */
export const EXTRA_KITS: Record<number, KitSet[]> = (() => {
  const t: Record<number, KitSet[]> = {};
  // EXTRA_SETS: researched from club announcements and press coverage (2026 season); colours
  // the sources didn't give are the club palette.
  {
    const H = KITS[108][0];
    t[108] = [
      // Red alternate
      {
        id: "alt1",
        name: "Red alternate",
        kit: {
          ...H,
          jersey: 0xba0021,
          pants: 0xffffff,
          chest: "script",
          text: "Angels",
          tail: true,
          badge: false,
          ink: 0xffffff,
          edge: 0x003263,
          num: 0xffffff,
          numEdge: 0x003263,
          numSide: 1,
          back: 0xffffff,
          backEdge: 0x003263,
          name: 0xffffff,
          placket: [],
          collar: [0x003263],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0xba0021,
          sockBand: -1,
          under: 0xba0021,
          cap: 0xba0021,
          bill: 0xba0021,
          capFront: -1,
        },
      },
      // City Connect (2022 sand)
      {
        id: "cc",
        name: "City Connect (2022 sand)",
        kit: {
          ...H,
          jersey: 0xd8c9a6,
          pants: 0xd8c9a6,
          chest: "script",
          text: "Angels",
          tail: true,
          badge: false,
          ink: 0xba0021,
          edge: -1,
          num: 0x003263,
          numEdge: -1,
          numSide: 1,
          back: 0x003263,
          backEdge: -1,
          name: 0xba0021,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [0xba0021],
          stripe: -1,
          sock: 0xba0021,
          sockBand: -1,
          under: 0xba0021,
          cap: 0xba0021,
          bill: 0xba0021,
          capFront: 0xd8c9a6,
        },
      },
    ];
  }
  {
    const H = KITS[109][0];
    t[109] = [
      // Black alternate
      {
        id: "alt1",
        name: "Black alternate",
        kit: {
          ...H,
          jersey: 0x000000,
          pants: 0xffffff,
          chest: "logo",
          text: "A",
          tail: false,
          badge: false,
          ink: 0xa71930,
          edge: 0x30ced8,
          num: 0xa71930,
          numEdge: 0x30ced8,
          numSide: 1,
          back: 0xa71930,
          backEdge: 0x30ced8,
          name: 0xa71930,
          placket: [0x30ced8],
          collar: [0x30ced8],
          cuff: [0x30ced8],
          pipe: [],
          stripe: -1,
          sock: 0x000000,
          sockBand: -1,
          under: 0x000000,
          cap: 0x000000,
          bill: 0x000000,
          capFront: -1,
        },
      },
      // Sedona red alternate
      {
        id: "alt2",
        name: "Sedona red alternate",
        kit: {
          ...H,
          jersey: 0xa71930,
          pants: 0xffffff,
          chest: "script",
          text: "Diamondbacks",
          tail: true,
          badge: false,
          ink: 0x000000,
          edge: 0x30ced8,
          num: 0x30ced8,
          numEdge: 0x30ced8,
          numSide: 1,
          back: 0x30ced8,
          backEdge: 0x30ced8,
          name: 0x000000,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0xa71930,
          sockBand: -1,
          under: 0x000000,
          cap: 0xa71930,
          bill: 0xa71930,
          capFront: -1,
        },
      },
      // City Connect 2.0 'Serpientes' (2025)
      {
        id: "cc",
        name: "City Connect 2.0 'Serpientes' (2025)",
        kit: {
          ...H,
          jersey: 0x5f259f,
          pants: 0xffffff,
          chest: "script",
          text: "Serpientes",
          tail: true,
          badge: false,
          ink: 0x30ced8,
          edge: -1,
          num: 0x30ced8,
          numEdge: -1,
          numSide: 1,
          back: 0x30ced8,
          backEdge: -1,
          name: 0x30ced8,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [0x5f259f],
          stripe: -1,
          sock: 0x5f259f,
          sockBand: -1,
          under: 0x3c1a6e,
          cap: 0x5f259f,
          bill: 0x5f259f,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[110][0];
    t[110] = [
      // Black alternate
      {
        id: "alt1",
        name: "Black alternate",
        kit: {
          ...H,
          jersey: 0x000000,
          pants: 0xffffff,
          chest: "script",
          text: "Orioles",
          tail: true,
          badge: false,
          ink: 0xdf4601,
          edge: 0xffffff,
          num: 0xdf4601,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0xdf4601,
          backEdge: 0xffffff,
          name: 0xdf4601,
          placket: [0xdf4601],
          collar: [0xdf4601],
          cuff: [0xdf4601],
          pipe: [0x000000, 0xdf4601],
          stripe: -1,
          sock: 0x000000,
          sockBand: -1,
          under: 0x000000,
          cap: 0x000000,
          bill: 0xdf4601,
          capFront: -1,
        },
      },
      // Orange alternate
      {
        id: "alt2",
        name: "Orange alternate",
        kit: {
          ...H,
          jersey: 0xdf4601,
          pants: 0xffffff,
          chest: "script",
          text: "Orioles",
          tail: true,
          badge: false,
          ink: 0x000000,
          edge: 0xffffff,
          num: 0x000000,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0x000000,
          backEdge: 0xffffff,
          name: 0x000000,
          placket: [0x000000],
          collar: [0x000000],
          cuff: [0x000000],
          pipe: [0xdf4601, 0x000000],
          stripe: -1,
          sock: 0x000000,
          sockBand: -1,
          under: 0x000000,
          cap: 0x000000,
          bill: 0xdf4601,
          capFront: -1,
        },
      },
      // City Connect 2026 BMORE (approximate)
      {
        id: "cc",
        name: "City Connect 2026 BMORE",
        kit: {
          ...H,
          jersey: 0xf2ebd9,
          pants: 0xf2ebd9,
          chest: "block",
          text: "BMORE",
          tail: false,
          badge: false,
          ink: 0x1f3d2c,
          edge: 0xdf4601,
          num: 0x1f3d2c,
          numEdge: 0xdf4601,
          numSide: 1,
          back: 0x1f3d2c,
          backEdge: 0xdf4601,
          name: 0x1f3d2c,
          placket: [0xdf4601],
          collar: [0xdf4601],
          cuff: [0xdf4601],
          pipe: [0xdf4601],
          stripe: -1,
          sock: 0x1f3d2c,
          sockBand: -1,
          under: 0x1f3d2c,
          cap: 0x1f3d2c,
          bill: 0x1f3d2c,
          capFront: 0xf2ebd9,
        },
      },
      // Black 'B' cap night alternate (2026) (approximate)
      {
        id: "alt3",
        name: "Black 'B' cap night alternate (2026)",
        kit: {
          ...H,
          jersey: 0x000000,
          pants: 0xffffff,
          chest: "script",
          text: "Orioles",
          tail: true,
          badge: false,
          ink: 0xdf4601,
          edge: 0xffffff,
          num: 0xdf4601,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0xdf4601,
          backEdge: 0xffffff,
          name: 0xdf4601,
          placket: [0xdf4601],
          collar: [0xdf4601],
          cuff: [0xdf4601],
          pipe: [0x000000, 0xdf4601],
          stripe: -1,
          sock: 0x000000,
          sockBand: -1,
          under: 0x000000,
          cap: 0x000000,
          bill: 0xdf4601,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[111][0];
    t[111] = [
      // Red alternate
      {
        id: "alt1",
        name: "Red alternate",
        kit: {
          ...H,
          jersey: 0xbd3039,
          pants: 0xbec3c6,
          chest: "block",
          text: "RED SOX",
          tail: false,
          badge: false,
          ink: 0x0c2340,
          edge: 0xffffff,
          num: 0x0c2340,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0x0c2340,
          backEdge: 0xffffff,
          name: 0x0c2340,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0xbd3039,
          sockBand: -1,
          under: 0x0c2340,
          cap: 0x0c2340,
          bill: 0x0c2340,
          capFront: -1,
        },
      },
      // City Connect 'Fenway Greens'
      {
        id: "cc",
        name: "City Connect 'Fenway Greens'",
        kit: {
          ...H,
          jersey: 0x2f5d47,
          pants: 0x2f5d47,
          chest: "block",
          text: "RED SOX",
          tail: false,
          badge: false,
          ink: 0xffffff,
          edge: -1,
          num: 0xffc72c,
          numEdge: -1,
          numSide: 1,
          back: 0xffc72c,
          backEdge: -1,
          name: 0xffffff,
          placket: [],
          collar: [0x9a9a93],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x2f5d47,
          sockBand: -1,
          under: 0x2f5d47,
          cap: 0x2f5d47,
          bill: 0x2f5d47,
          capFront: -1,
        },
      },
      // City Connect 2021 Marathon
      {
        id: "cc2",
        name: "City Connect 2021 Marathon",
        kit: {
          ...H,
          jersey: 0xffc72c,
          pants: 0xffffff,
          chest: "block",
          text: "BOSTON",
          tail: false,
          badge: false,
          ink: 0x418fde,
          edge: -1,
          num: 0x418fde,
          numEdge: -1,
          numSide: 1,
          back: 0x418fde,
          backEdge: -1,
          name: 0x418fde,
          placket: [],
          collar: [0x418fde],
          cuff: [0x418fde, 0xffffff],
          pipe: [],
          stripe: -1,
          sock: 0xffc72c,
          sockBand: -1,
          under: 0x418fde,
          cap: 0x418fde,
          bill: 0x418fde,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[112][0];
    t[112] = [
      // Royal blue alternate (walking cub)
      {
        id: "alt1",
        name: "Royal blue alternate (walking cub)",
        kit: {
          ...H,
          jersey: 0x0e3386,
          pants: 0xa2aaad,
          chest: "logo",
          text: "walking-cub 'C' crest, left chest",
          tail: false,
          badge: false,
          ink: 0xcc3433,
          edge: 0xffffff,
          num: 0xcc3433,
          numEdge: 0xffffff,
          numSide: -1,
          back: 0xcc3433,
          backEdge: 0xffffff,
          name: 0xcc3433,
          placket: [],
          collar: [0x0e3386],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x0e3386,
          sockBand: -1,
          under: 0x0e3386,
          cap: 0x0e3386,
          bill: 0x0e3386,
          capFront: -1,
        },
      },
      // Chicago Blues powder blue alternate
      {
        id: "alt2",
        name: "Chicago Blues powder blue alternate",
        kit: {
          ...H,
          jersey: 0x8db9e3,
          pants: 0xffffff,
          chest: "logo",
          text: "Cubs",
          tail: false,
          badge: false,
          ink: 0xcc3433,
          edge: 0x0e3386,
          num: 0xcc3433,
          numEdge: 0x0e3386,
          numSide: -1,
          back: 0xcc3433,
          backEdge: 0x0e3386,
          name: 0xcc3433,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x0e3386,
          sockBand: -1,
          under: 0x0e3386,
          cap: 0x0e3386,
          bill: 0x0e3386,
          capFront: 0xffffff,
        },
      },
    ];
  }
  {
    const H = KITS[113][0];
    t[113] = [
      // Red script 'Reds' alternate
      {
        id: "alt1",
        name: "Red script 'Reds' alternate",
        kit: {
          ...H,
          jersey: 0xc6011f,
          pants: 0xffffff,
          chest: "script",
          text: "Reds",
          tail: true,
          badge: false,
          ink: 0xffffff,
          edge: 0x000000,
          num: 0xffffff,
          numEdge: 0x000000,
          numSide: 1,
          back: 0xffffff,
          backEdge: 0x000000,
          name: 0xffffff,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0xc6011f,
          sockBand: -1,
          under: 0xc6011f,
          cap: 0xc6011f,
          bill: 0xc6011f,
          capFront: -1,
        },
      },
      // City Connect 2.0 (2026) all-red
      {
        id: "cc",
        name: "City Connect 2.0 (2026) all-red",
        kit: {
          ...H,
          jersey: 0xc6011f,
          pants: 0xc6011f,
          chest: "logo",
          text: "modern diamond 'C'",
          tail: false,
          badge: false,
          ink: 0xffffff,
          edge: 0x000000,
          num: 0x000000,
          numEdge: 0x000000,
          numSide: 1,
          back: 0x000000,
          backEdge: 0x000000,
          name: 0xffffff,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: 0x9e0b1e,
          sock: 0xc6011f,
          sockBand: -1,
          under: 0x8b0a1a,
          cap: 0xc6011f,
          bill: 0x8b0a1a,
          capFront: -1,
        },
      },
      // City Connect 1.0 (2023) black CINCY (approximate)
      {
        id: "cc2",
        name: "City Connect 1.0 (2023) black CINCY",
        kit: {
          ...H,
          jersey: 0x000000,
          pants: 0x000000,
          chest: "block",
          text: "CINCY",
          tail: false,
          badge: false,
          ink: 0xc6011f,
          edge: 0xffffff,
          num: 0xc6011f,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0xc6011f,
          backEdge: 0xffffff,
          name: 0xc6011f,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x000000,
          sockBand: -1,
          under: 0x000000,
          cap: 0x000000,
          bill: 0x000000,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[114][0];
    t[114] = [
      // Red home alternate
      {
        id: "alt1",
        name: "Red home alternate",
        kit: {
          ...H,
          jersey: 0xe50022,
          pants: 0xffffff,
          chest: "block",
          text: "Guardians",
          tail: false,
          badge: false,
          ink: 0x00385d,
          edge: 0xffffff,
          num: 0x00385d,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0x00385d,
          backEdge: 0xffffff,
          name: 0x00385d,
          placket: [],
          collar: [0x00385d, 0xffffff, 0x00385d],
          cuff: [0x00385d, 0xffffff, 0x00385d],
          pipe: [],
          stripe: -1,
          sock: 0x00385d,
          sockBand: -1,
          under: 0x00385d,
          cap: 0x00385d,
          bill: 0xe50022,
          capFront: -1,
        },
      },
      // Navy road alternate
      {
        id: "alt2",
        name: "Navy road alternate",
        kit: {
          ...H,
          jersey: 0x00385d,
          pants: 0xa2aaad,
          chest: "logo",
          text: "C",
          tail: false,
          badge: false,
          ink: 0xe50022,
          edge: 0xffffff,
          num: 0xe50022,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0xe50022,
          backEdge: 0xffffff,
          name: 0xe50022,
          placket: [],
          collar: [0xe50022, 0xffffff, 0xe50022],
          cuff: [0xe50022, 0xffffff, 0xe50022],
          pipe: [],
          stripe: -1,
          sock: 0x00385d,
          sockBand: -1,
          under: 0x00385d,
          cap: 0x00385d,
          bill: 0xe50022,
          capFront: -1,
        },
      },
      // City Connect (CLE)
      {
        id: "cc",
        name: "City Connect (CLE)",
        kit: {
          ...H,
          jersey: 0x0c2340,
          pants: 0xc8b79a,
          chest: "block",
          text: "CLE",
          tail: false,
          badge: false,
          ink: 0xc8b79a,
          edge: -1,
          num: 0xc8b79a,
          numEdge: -1,
          numSide: 1,
          back: 0xc8b79a,
          backEdge: -1,
          name: 0xc8b79a,
          placket: [],
          collar: [],
          cuff: [0xe50022, 0xffffff, 0xe50022],
          pipe: [],
          stripe: -1,
          sock: 0xe50022,
          sockBand: -1,
          under: 0x0c2340,
          cap: 0x0c2340,
          bill: 0xe50022,
          capFront: 0xffffff,
        },
      },
    ];
  }
  {
    const H = KITS[115][0];
    t[115] = [
      // Purple alternate (Purple Mondays)
      {
        id: "alt1",
        name: "Purple alternate (Purple Mondays)",
        kit: {
          ...H,
          jersey: 0x33006f,
          pants: 0xffffff,
          chest: "script",
          text: "Colorado",
          tail: true,
          badge: false,
          ink: 0xc4ced4,
          edge: 0x000000,
          num: 0x000000,
          numEdge: 0x000000,
          numSide: 1,
          back: 0x000000,
          backEdge: 0x000000,
          name: 0xc4ced4,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x000000,
          sockBand: -1,
          under: 0x000000,
          cap: 0x000000,
          bill: 0x33006f,
          capFront: -1,
        },
      },
      // City Connect 2.0 'Sunrise to Sunset' (2025) (approximate)
      {
        id: "cc",
        name: "City Connect 2.0 'Sunrise to Sunset' (2025)",
        kit: {
          ...H,
          jersey: 0x6cace4,
          pants: 0xffffff,
          chest: "logo",
          text: "",
          tail: false,
          badge: false,
          ink: 0xfdb827,
          edge: 0x5a2d82,
          num: 0xfdb827,
          numEdge: 0x5a2d82,
          numSide: 1,
          back: 0xfdb827,
          backEdge: 0x5a2d82,
          name: 0xfdb827,
          placket: [],
          collar: [0x5a2d82],
          cuff: [0x5a2d82],
          pipe: [0xf26722, 0xe8509a, 0xfdb827],
          stripe: -1,
          sock: 0x5a2d82,
          sockBand: -1,
          under: 0x5a2d82,
          cap: 0x6cace4,
          bill: 0x5a2d82,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[116][0];
    t[116] = [
      // Orange home alternate
      {
        id: "alt1",
        name: "Orange home alternate",
        kit: {
          ...H,
          jersey: 0xfa4616,
          pants: 0xffffff,
          chest: "logo",
          text: "D",
          tail: false,
          badge: false,
          ink: 0x0c2340,
          edge: 0xffffff,
          num: 0x0c2340,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0x0c2340,
          backEdge: 0xffffff,
          name: 0x0c2340,
          placket: [],
          collar: [0x0c2340, 0xffffff, 0x0c2340],
          cuff: [0x0c2340, 0xffffff, 0x0c2340],
          pipe: [0x0c2340, 0xffffff, 0x0c2340],
          stripe: -1,
          sock: 0x0c2340,
          sockBand: -1,
          under: 0x0c2340,
          cap: 0x0c2340,
          bill: 0xfa4616,
          capFront: -1,
        },
      },
      // Navy road alternate
      {
        id: "alt2",
        name: "Navy road alternate",
        kit: {
          ...H,
          jersey: 0x0c2340,
          pants: 0xa2aaad,
          chest: "script",
          text: "Detroit",
          tail: true,
          badge: false,
          ink: 0xfa4616,
          edge: 0xffffff,
          num: 0xfa4616,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0xfa4616,
          backEdge: 0xffffff,
          name: 0xfa4616,
          placket: [],
          collar: [0xfa4616, 0xffffff, 0xfa4616],
          cuff: [0xfa4616, 0xffffff, 0xfa4616],
          pipe: [0x0c2340, 0xffffff, 0xfa4616],
          stripe: -1,
          sock: 0x0c2340,
          sockBand: -1,
          under: 0x0c2340,
          cap: 0x0c2340,
          bill: 0xfa4616,
          capFront: -1,
        },
      },
      // City Connect (Motor City)
      {
        id: "cc",
        name: "City Connect (Motor City)",
        kit: {
          ...H,
          jersey: 0x0c2340,
          pants: 0x13294b,
          chest: "block",
          text: "MOTOR CITY",
          tail: false,
          badge: false,
          ink: 0xffffff,
          edge: -1,
          num: 0xffffff,
          numEdge: -1,
          numSide: 1,
          back: 0xffffff,
          backEdge: -1,
          name: 0xffffff,
          placket: [],
          collar: [],
          cuff: [0x0072ce, 0x000000],
          pipe: [0x0072ce],
          stripe: -1,
          sock: 0x0c2340,
          sockBand: -1,
          under: 0x0c2340,
          cap: 0x0c2340,
          bill: 0x0c2340,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[117][0];
    t[117] = [
      // Orange alternate
      {
        id: "alt1",
        name: "Orange alternate",
        kit: {
          ...H,
          jersey: 0xeb6e1f,
          pants: 0xffffff,
          chest: "script",
          text: "Astros",
          tail: true,
          badge: false,
          ink: 0x002d62,
          edge: 0xffffff,
          num: 0x002d62,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0x002d62,
          backEdge: 0xffffff,
          name: 0x002d62,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [0x002d62],
          stripe: -1,
          sock: 0x002d62,
          sockBand: -1,
          under: 0x002d62,
          cap: 0x002d62,
          bill: 0xeb6e1f,
          capFront: -1,
        },
      },
      // Navy alternate
      {
        id: "alt2",
        name: "Navy alternate",
        kit: {
          ...H,
          jersey: 0x002d62,
          pants: 0xffffff,
          chest: "script",
          text: "Astros",
          tail: true,
          badge: false,
          ink: 0xeb6e1f,
          edge: 0xffffff,
          num: 0xeb6e1f,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0xeb6e1f,
          backEdge: 0xffffff,
          name: 0xeb6e1f,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [0xeb6e1f],
          stripe: -1,
          sock: 0x002d62,
          sockBand: -1,
          under: 0x002d62,
          cap: 0x002d62,
          bill: 0x002d62,
          capFront: -1,
        },
      },
      // City Connect 2.0 'Stros' (2025)
      {
        id: "cc",
        name: "City Connect 2.0 'Stros' (2025)",
        kit: {
          ...H,
          jersey: 0xffffff,
          pants: 0xffffff,
          chest: "block",
          text: "STROS",
          tail: false,
          badge: false,
          ink: 0x002d62,
          edge: -1,
          num: 0x002d62,
          numEdge: -1,
          numSide: 1,
          back: 0x002d62,
          backEdge: -1,
          name: 0x002d62,
          placket: [],
          collar: [],
          cuff: [0xeb6e1f, 0xf4b223],
          pipe: [0xeb6e1f, 0xf4b223, 0x002d62],
          stripe: -1,
          sock: 0xeb6e1f,
          sockBand: -1,
          under: 0x002d62,
          cap: 0x002d62,
          bill: 0x002d62,
          capFront: 0xffffff,
        },
      },
    ];
  }
  {
    const H = KITS[118][0];
    t[118] = [
      // Powder blue alternate (approximate)
      {
        id: "alt1",
        name: "Powder blue alternate",
        kit: {
          ...H,
          jersey: 0x7bb2dd,
          pants: 0x7bb2dd,
          chest: "script",
          text: "Royals",
          tail: true,
          badge: false,
          ink: 0x004687,
          edge: 0xffffff,
          num: 0x004687,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0x004687,
          backEdge: 0xffffff,
          name: 0x004687,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x004687,
          sockBand: -1,
          under: 0x004687,
          cap: 0x004687,
          bill: 0x004687,
          capFront: -1,
        },
      },
      // Royal blue alternate
      {
        id: "alt2",
        name: "Royal blue alternate",
        kit: {
          ...H,
          jersey: 0x004687,
          pants: 0xa2aaad,
          chest: "block",
          text: "KANSAS CITY",
          tail: false,
          badge: false,
          ink: 0xffffff,
          edge: 0x7bb2dd,
          num: 0xffffff,
          numEdge: 0x7bb2dd,
          numSide: 1,
          back: 0xffffff,
          backEdge: 0x7bb2dd,
          name: 0xffffff,
          placket: [0x7bb2dd],
          collar: [0x7bb2dd],
          cuff: [0x7bb2dd],
          pipe: [],
          stripe: -1,
          sock: 0x004687,
          sockBand: -1,
          under: 0x004687,
          cap: 0x004687,
          bill: 0x004687,
          capFront: -1,
        },
      },
      // City Connect (Forever Fountains) (approximate)
      {
        id: "cc",
        name: "City Connect (Forever Fountains)",
        kit: {
          ...H,
          jersey: 0xffffff,
          pants: 0xffffff,
          chest: "logo",
          text: "R",
          tail: false,
          badge: false,
          ink: 0xd6338a,
          edge: -1,
          num: 0xd6338a,
          numEdge: -1,
          numSide: 1,
          back: 0xd6338a,
          backEdge: -1,
          name: 0xd6338a,
          placket: [],
          collar: [0x1e73be],
          cuff: [0xd6338a, 0xffffff, 0x1e73be],
          pipe: [],
          stripe: -1,
          sock: 0x1e73be,
          sockBand: -1,
          under: 0x1e73be,
          cap: 0xd6338a,
          bill: 0x1e73be,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[119][0];
    t[119] = [
      // Blue road alternate (2026)
      {
        id: "alt1",
        name: "Blue road alternate (2026)",
        kit: {
          ...H,
          jersey: 0x005a9c,
          pants: 0xa5acaf,
          chest: "script",
          text: "Los Angeles",
          tail: true,
          badge: false,
          ink: 0xffffff,
          edge: 0xa5acaf,
          num: 0xef3e42,
          numEdge: 0xa5acaf,
          numSide: 1,
          back: 0xef3e42,
          backEdge: 0xa5acaf,
          name: 0xffffff,
          placket: [],
          collar: [],
          cuff: [0xa5acaf],
          pipe: [],
          stripe: -1,
          sock: 0x005a9c,
          sockBand: -1,
          under: 0x005a9c,
          cap: 0x005a9c,
          bill: 0x005a9c,
          capFront: -1,
        },
      },
      // City Connect 2.0 'City of Dreams' (2024)
      {
        id: "cc",
        name: "City Connect 2.0 'City of Dreams' (2024)",
        kit: {
          ...H,
          jersey: 0xf3ebdc,
          pants: 0xf3ebdc,
          chest: "script",
          text: "Los Angeles",
          tail: true,
          badge: false,
          ink: 0x005a9c,
          edge: 0x1e4fc4,
          num: 0x005a9c,
          numEdge: 0x1e4fc4,
          numSide: 1,
          back: 0x005a9c,
          backEdge: 0x1e4fc4,
          name: 0x005a9c,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x005a9c,
          sockBand: -1,
          under: 0x005a9c,
          cap: 0x1e4fc4,
          bill: 0x1e4fc4,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[120][0];
    t[120] = [
      // Navy script alternate
      {
        id: "alt1",
        name: "Navy script alternate",
        kit: {
          ...H,
          jersey: 0x14225a,
          pants: 0xbec0c2,
          chest: "script",
          text: "Nationals",
          tail: true,
          badge: false,
          ink: 0xffffff,
          edge: 0xab0003,
          num: 0xffffff,
          numEdge: 0xab0003,
          numSide: -1,
          back: 0xffffff,
          backEdge: 0xab0003,
          name: 0xffffff,
          placket: [0xab0003, 0xffffff],
          collar: [0xab0003, 0xffffff],
          cuff: [0xab0003, 0xffffff],
          pipe: [],
          stripe: -1,
          sock: 0x14225a,
          sockBand: -1,
          under: 0x14225a,
          cap: 0x14225a,
          bill: 0x14225a,
          capFront: -1,
        },
      },
      // Red Curly W alternate
      {
        id: "alt2",
        name: "Red Curly W alternate",
        kit: {
          ...H,
          jersey: 0xab0003,
          pants: 0xffffff,
          chest: "logo",
          text: "W",
          tail: false,
          badge: false,
          ink: 0xffffff,
          edge: 0x14225a,
          num: 0xffffff,
          numEdge: 0x14225a,
          numSide: -1,
          back: 0xffffff,
          backEdge: 0x14225a,
          name: 0xffffff,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [0x14225a, 0xab0003],
          stripe: -1,
          sock: 0xab0003,
          sockBand: -1,
          under: 0xab0003,
          cap: 0xab0003,
          bill: 0xab0003,
          capFront: -1,
        },
      },
      // City Connect 'District Blueprint' (approximate)
      {
        id: "cc",
        name: "City Connect 'District Blueprint'",
        kit: {
          ...H,
          jersey: 0x8db9e2,
          pants: 0xffffff,
          chest: "logo",
          text: "DC",
          tail: false,
          badge: false,
          ink: 0x14225a,
          edge: 0xffffff,
          num: 0x14225a,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0x14225a,
          backEdge: 0xffffff,
          name: 0x14225a,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [0x8db9e2],
          stripe: -1,
          sock: 0x8db9e2,
          sockBand: -1,
          under: 0x8db9e2,
          cap: 0x8db9e2,
          bill: 0x14225a,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[121][0];
    t[121] = [
      // Black alternate
      {
        id: "alt1",
        name: "Black alternate",
        kit: {
          ...H,
          jersey: 0x000000,
          pants: 0xffffff,
          chest: "script",
          text: "Mets",
          tail: true,
          badge: false,
          ink: 0x002d72,
          edge: 0xff5910,
          num: 0x002d72,
          numEdge: 0xff5910,
          numSide: 1,
          back: 0x002d72,
          backEdge: 0xff5910,
          name: 0x002d72,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [0x002d72],
          stripe: -1,
          sock: 0x000000,
          sockBand: -1,
          under: 0x000000,
          cap: 0x000000,
          bill: 0x000000,
          capFront: -1,
        },
      },
      // Blue 'New York' pullover alternate
      {
        id: "alt2",
        name: "Blue 'New York' pullover alternate",
        kit: {
          ...H,
          jersey: 0x002d72,
          pants: 0xbec0c2,
          chest: "script",
          text: "New York",
          tail: true,
          badge: false,
          ink: 0xffffff,
          edge: 0xff5910,
          num: 0xffffff,
          numEdge: 0xff5910,
          numSide: 1,
          back: 0xffffff,
          backEdge: 0xff5910,
          name: 0xffffff,
          placket: [],
          collar: [0xff5910],
          cuff: [0xff5910],
          pipe: [],
          stripe: -1,
          sock: 0x002d72,
          sockBand: -1,
          under: 0x002d72,
          cap: 0x002d72,
          bill: 0x002d72,
          capFront: -1,
        },
      },
      // City Connect 'NYC'
      {
        id: "cc",
        name: "City Connect 'NYC'",
        kit: {
          ...H,
          jersey: 0x8c8f91,
          pants: 0xffffff,
          chest: "arch",
          text: "NYC",
          tail: false,
          badge: false,
          ink: 0x000000,
          edge: 0xffffff,
          num: 0x000000,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0x000000,
          backEdge: 0xffffff,
          name: 0x000000,
          placket: [],
          collar: [],
          cuff: [0x5f3a8c],
          pipe: [0x000000],
          stripe: 0x000000,
          sock: 0x000000,
          sockBand: -1,
          under: 0x5f3a8c,
          cap: 0x000000,
          bill: 0x000000,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[133][0];
    t[133] = [
      // Kelly green alternate
      {
        id: "alt1",
        name: "Kelly green alternate",
        kit: {
          ...H,
          jersey: 0x00843d,
          pants: 0xffffff,
          chest: "script",
          text: "Athletics",
          tail: true,
          badge: false,
          ink: 0xffffff,
          edge: 0xefb21e,
          num: 0xffffff,
          numEdge: 0xefb21e,
          numSide: 1,
          back: 0xffffff,
          backEdge: 0xefb21e,
          name: 0xffffff,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x00843d,
          sockBand: -1,
          under: 0x00843d,
          cap: 0x00843d,
          bill: 0x00843d,
          capFront: -1,
        },
      },
      // Gold 'Sacramento' alternate (2026)
      {
        id: "alt2",
        name: "Gold 'Sacramento' alternate (2026)",
        kit: {
          ...H,
          jersey: 0xefb21e,
          pants: 0xffffff,
          chest: "script",
          text: "Sacramento",
          tail: true,
          badge: false,
          ink: 0x003831,
          edge: 0xffffff,
          num: 0x003831,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0x003831,
          backEdge: 0xffffff,
          name: 0x003831,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x003831,
          sockBand: -1,
          under: 0x003831,
          cap: 0x003831,
          bill: 0xefb21e,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[134][0];
    t[134] = [
      // Black home alternate 'PIRATES' (approximate)
      {
        id: "alt1",
        name: "Black home alternate 'PIRATES'",
        kit: {
          ...H,
          jersey: 0x27251f,
          pants: 0xffffff,
          chest: "arch",
          text: "PIRATES",
          tail: false,
          badge: false,
          ink: 0xfdb827,
          edge: 0xffffff,
          num: 0xfdb827,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0xfdb827,
          backEdge: 0xffffff,
          name: 0xfdb827,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x27251f,
          sockBand: -1,
          under: 0x27251f,
          cap: 0x27251f,
          bill: 0x27251f,
          capFront: -1,
        },
      },
      // Black road alternate 'Pittsburgh' script
      {
        id: "alt2",
        name: "Black road alternate 'Pittsburgh' script",
        kit: {
          ...H,
          jersey: 0x27251f,
          pants: 0xa2aaad,
          chest: "script",
          text: "Pittsburgh",
          tail: true,
          badge: false,
          ink: 0xfdb827,
          edge: -1,
          num: 0xfdb827,
          numEdge: -1,
          numSide: 1,
          back: 0xfdb827,
          backEdge: -1,
          name: 0xfdb827,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x27251f,
          sockBand: -1,
          under: 0x27251f,
          cap: 0x27251f,
          bill: 0x27251f,
          capFront: -1,
        },
      },
      // City Connect 2.0 (2026) all-black
      {
        id: "cc",
        name: "City Connect 2.0 (2026) all-black",
        kit: {
          ...H,
          jersey: 0x27251f,
          pants: 0x27251f,
          chest: "block",
          text: "PIRATES",
          tail: false,
          badge: false,
          ink: 0xfdb827,
          edge: -1,
          num: 0xfdb827,
          numEdge: -1,
          numSide: 1,
          back: 0xfdb827,
          backEdge: -1,
          name: 0xfdb827,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x27251f,
          sockBand: -1,
          under: 0x27251f,
          cap: 0x27251f,
          bill: 0xfdb827,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[135][0];
    t[135] = [
      // Brown alternate
      {
        id: "alt1",
        name: "Brown alternate",
        kit: {
          ...H,
          jersey: 0x2f241d,
          pants: 0xe3d4ad,
          chest: "script",
          text: "San Diego",
          tail: true,
          badge: false,
          ink: 0xffc425,
          edge: 0xffffff,
          num: 0xffc425,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0xffc425,
          backEdge: 0xffffff,
          name: 0xffc425,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x2f241d,
          sockBand: -1,
          under: 0x2f241d,
          cap: 0x2f241d,
          bill: 0x2f241d,
          capFront: -1,
        },
      },
      // City Connect 2.0 Dia de los Muertos (2026)
      {
        id: "cc",
        name: "City Connect 2.0 Dia de los Muertos (2026)",
        kit: {
          ...H,
          jersey: 0x122231,
          pants: 0xf2e5d1,
          chest: "script",
          text: "San Diego",
          tail: true,
          badge: false,
          ink: 0xf2e5d1,
          edge: 0xee7316,
          num: 0xf2e5d1,
          numEdge: 0xee7316,
          numSide: 1,
          back: 0xf2e5d1,
          backEdge: 0xee7316,
          name: 0xf2e5d1,
          placket: [],
          collar: [],
          cuff: [0xf6bf31, 0xd12a72],
          pipe: [],
          stripe: -1,
          sock: 0x122231,
          sockBand: -1,
          under: 0x122231,
          cap: 0xf2e5d1,
          bill: 0x122231,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[136][0];
    t[136] = [
      // Northwest Green alternate
      {
        id: "alt1",
        name: "Northwest Green alternate",
        kit: {
          ...H,
          jersey: 0x005c5c,
          pants: 0xffffff,
          chest: "script",
          text: "Mariners",
          tail: true,
          badge: false,
          ink: 0xc4ced4,
          edge: 0x0c2c56,
          num: 0xc4ced4,
          numEdge: 0x0c2c56,
          numSide: 1,
          back: 0xc4ced4,
          backEdge: 0x0c2c56,
          name: 0xc4ced4,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x0c2c56,
          sockBand: -1,
          under: 0x0c2c56,
          cap: 0x0c2c56,
          bill: 0x005c5c,
          capFront: -1,
        },
      },
      // Navy road alternate
      {
        id: "alt2",
        name: "Navy road alternate",
        kit: {
          ...H,
          jersey: 0x0c2c56,
          pants: 0xc4ced4,
          chest: "block",
          text: "SEATTLE",
          tail: false,
          badge: false,
          ink: 0xc4ced4,
          edge: 0x005c5c,
          num: 0xc4ced4,
          numEdge: 0x005c5c,
          numSide: 1,
          back: 0xc4ced4,
          backEdge: 0x005c5c,
          name: 0xc4ced4,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x0c2c56,
          sockBand: -1,
          under: 0x0c2c56,
          cap: 0x0c2c56,
          bill: 0x0c2c56,
          capFront: -1,
        },
      },
      // Seattle Steelheads Sunday alternate (2026) (approximate)
      {
        id: "alt3",
        name: "Seattle Steelheads Sunday alternate (2026)",
        kit: {
          ...H,
          jersey: 0xefe6d2,
          pants: 0xefe6d2,
          chest: "script",
          text: "Steelheads",
          tail: true,
          badge: false,
          ink: 0x111111,
          edge: -1,
          num: 0x111111,
          numEdge: -1,
          numSide: 1,
          back: 0x111111,
          backEdge: -1,
          name: 0x111111,
          placket: [0x111111],
          collar: [],
          cuff: [0x111111],
          pipe: [],
          stripe: -1,
          sock: 0x111111,
          sockBand: -1,
          under: 0x111111,
          cap: 0x111111,
          bill: 0x111111,
          capFront: -1,
        },
      },
      // City Connect (2023 royal)
      {
        id: "cc",
        name: "City Connect (2023 royal)",
        kit: {
          ...H,
          jersey: 0x0e4c92,
          pants: 0x111111,
          chest: "script",
          text: "Seattle",
          tail: true,
          badge: false,
          ink: 0xf6b21a,
          edge: 0xe04e2a,
          num: 0xf6b21a,
          numEdge: 0xe04e2a,
          numSide: 1,
          back: 0xf6b21a,
          backEdge: 0xe04e2a,
          name: 0xf6b21a,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x0e4c92,
          sockBand: -1,
          under: 0x0e4c92,
          cap: 0x0e4c92,
          bill: 0x111111,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[137][0];
    t[137] = [
      // Orange alternate (Fridays)
      {
        id: "alt1",
        name: "Orange alternate (Fridays)",
        kit: {
          ...H,
          jersey: 0xfd5a1e,
          pants: 0xefd19f,
          chest: "script",
          text: "Giants",
          tail: true,
          badge: false,
          ink: 0x27251f,
          edge: 0xefd19f,
          num: 0x27251f,
          numEdge: 0xefd19f,
          numSide: 1,
          back: 0x27251f,
          backEdge: 0xefd19f,
          name: 0x27251f,
          placket: [0x27251f],
          collar: [0x27251f],
          cuff: [0x27251f],
          pipe: [0x27251f],
          stripe: -1,
          sock: 0x27251f,
          sockBand: -1,
          under: 0x27251f,
          cap: 0x27251f,
          bill: 0xfd5a1e,
          capFront: -1,
        },
      },
      // Black 'Gigantes' alternate (2026, Saturdays)
      {
        id: "alt2",
        name: "Black 'Gigantes' alternate (2026, Saturdays)",
        kit: {
          ...H,
          jersey: 0x27251f,
          pants: 0xefd19f,
          chest: "arch",
          text: "GIGANTES",
          tail: false,
          badge: false,
          ink: 0x8a8d8f,
          edge: 0xfd5a1e,
          num: 0x8a8d8f,
          numEdge: 0xfd5a1e,
          numSide: 1,
          back: 0x8a8d8f,
          backEdge: 0xfd5a1e,
          name: 0x8a8d8f,
          placket: [0xfd5a1e],
          collar: [0xfd5a1e],
          cuff: [0xfd5a1e],
          pipe: [],
          stripe: -1,
          sock: 0x27251f,
          sockBand: -1,
          under: 0x27251f,
          cap: 0x27251f,
          bill: 0x27251f,
          capFront: 0x8a8d8f,
        },
      },
      // City Connect 2.0 'The Remix' (2025)
      {
        id: "cc",
        name: "City Connect 2.0 'The Remix' (2025)",
        kit: {
          ...H,
          jersey: 0x1a1a1a,
          pants: 0xffffff,
          chest: "script",
          text: "Giants",
          tail: true,
          badge: false,
          ink: 0xffffff,
          edge: 0x7b3fa0,
          num: 0xfd5a1e,
          numEdge: 0x7b3fa0,
          numSide: 1,
          back: 0xfd5a1e,
          backEdge: 0x7b3fa0,
          name: 0xffffff,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [0xfd5a1e, 0x7b3fa0],
          stripe: -1,
          sock: 0x1a1a1a,
          sockBand: -1,
          under: 0x1a1a1a,
          cap: 0x1a1a1a,
          bill: 0xfd5a1e,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[138][0];
    t[138] = [
      // Cream Saturday home alternate
      {
        id: "alt1",
        name: "Cream Saturday home alternate",
        kit: {
          ...H,
          jersey: 0xf5efdc,
          pants: 0xf5efdc,
          chest: "script",
          text: "St. Louis",
          tail: true,
          badge: false,
          ink: 0xc41e3a,
          edge: 0x0c2340,
          num: 0xc41e3a,
          numEdge: 0x0c2340,
          numSide: 1,
          back: 0xc41e3a,
          backEdge: 0x0c2340,
          name: 0xc41e3a,
          placket: [0xc41e3a],
          collar: [0xc41e3a],
          cuff: [0xc41e3a],
          pipe: [],
          stripe: -1,
          sock: 0xc41e3a,
          sockBand: -1,
          under: 0xc41e3a,
          cap: 0x0c2340,
          bill: 0xc41e3a,
          capFront: -1,
        },
      },
      // Powder blue Saturday road alternate (approximate)
      {
        id: "alt2",
        name: "Powder blue Saturday road alternate",
        kit: {
          ...H,
          jersey: 0x92c1e9,
          pants: 0xa2aaad,
          chest: "script",
          text: "St. Louis",
          tail: true,
          badge: false,
          ink: 0xc41e3a,
          edge: 0x0c2340,
          num: 0xc41e3a,
          numEdge: 0x0c2340,
          numSide: 1,
          back: 0xc41e3a,
          backEdge: 0x0c2340,
          name: 0xc41e3a,
          placket: [0xc41e3a],
          collar: [0xc41e3a],
          cuff: [0xc41e3a],
          pipe: [0xc41e3a],
          stripe: -1,
          sock: 0xc41e3a,
          sockBand: -1,
          under: 0x0c2340,
          cap: 0x0c2340,
          bill: 0xc41e3a,
          capFront: -1,
        },
      },
      // City Connect (2024) red 'The Lou'
      {
        id: "cc",
        name: "City Connect (2024) red 'The Lou'",
        kit: {
          ...H,
          jersey: 0xc41e3a,
          pants: 0xffffff,
          chest: "script",
          text: "The Lou",
          tail: true,
          badge: false,
          ink: 0xffffff,
          edge: 0x0c2340,
          num: 0xffffff,
          numEdge: 0x0c2340,
          numSide: 1,
          back: 0xffffff,
          backEdge: 0x0c2340,
          name: 0xffffff,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: 0x9e1b32,
          sock: 0xc41e3a,
          sockBand: -1,
          under: 0xc41e3a,
          cap: 0xc41e3a,
          bill: 0xc41e3a,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[139][0];
    t[139] = [
      // Navy alternate
      {
        id: "alt1",
        name: "Navy alternate",
        kit: {
          ...H,
          jersey: 0x092c5c,
          pants: 0xbec3c6,
          chest: "script",
          text: "Rays",
          tail: true,
          badge: false,
          ink: 0xffffff,
          edge: 0x8fbce6,
          num: 0xffffff,
          numEdge: 0x8fbce6,
          numSide: 1,
          back: 0xffffff,
          backEdge: 0x8fbce6,
          name: 0xffffff,
          placket: [0x8fbce6],
          collar: [0x8fbce6],
          cuff: [0x8fbce6],
          pipe: [],
          stripe: -1,
          sock: 0x092c5c,
          sockBand: -1,
          under: 0x092c5c,
          cap: 0x092c5c,
          bill: 0x092c5c,
          capFront: -1,
        },
      },
      // Columbia blue alternate
      {
        id: "alt2",
        name: "Columbia blue alternate",
        kit: {
          ...H,
          jersey: 0x8fbce6,
          pants: 0xffffff,
          chest: "logo",
          text: "Rays",
          tail: false,
          badge: false,
          ink: 0x092c5c,
          edge: 0xffffff,
          num: 0x092c5c,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0x092c5c,
          backEdge: 0xffffff,
          name: 0x092c5c,
          placket: [0x092c5c],
          collar: [0x092c5c],
          cuff: [0x092c5c],
          pipe: [],
          stripe: -1,
          sock: 0x092c5c,
          sockBand: -1,
          under: 0x092c5c,
          cap: 0x092c5c,
          bill: 0x092c5c,
          capFront: -1,
        },
      },
      // Devil Rays rainbow throwback (home)
      {
        id: "alt3",
        name: "Devil Rays rainbow throwback (home)",
        kit: {
          ...H,
          jersey: 0xffffff,
          pants: 0xffffff,
          chest: "script",
          text: "Devil Rays",
          tail: true,
          badge: false,
          ink: 0x5b2c83,
          edge: 0x000000,
          num: 0x000000,
          numEdge: 0x000000,
          numSide: 1,
          back: 0x000000,
          backEdge: 0x000000,
          name: 0x5b2c83,
          placket: [],
          collar: [0x000000],
          cuff: [0x000000],
          pipe: [],
          stripe: -1,
          sock: 0x000000,
          sockBand: -1,
          under: 0x000000,
          cap: 0x000000,
          bill: 0x000000,
          capFront: -1,
        },
      },
      // New Tampa Bay rainbow road gray
      {
        id: "alt4",
        name: "New Tampa Bay rainbow road gray",
        kit: {
          ...H,
          jersey: 0xbec3c6,
          pants: 0xbec3c6,
          chest: "script",
          text: "Tampa Bay",
          tail: true,
          badge: false,
          ink: 0x5b2c83,
          edge: 0x092c5c,
          num: 0x092c5c,
          numEdge: 0x092c5c,
          numSide: 1,
          back: 0x092c5c,
          backEdge: 0x092c5c,
          name: 0x5b2c83,
          placket: [],
          collar: [0x092c5c],
          cuff: [0x092c5c],
          pipe: [],
          stripe: -1,
          sock: 0x092c5c,
          sockBand: -1,
          under: 0x092c5c,
          cap: 0x092c5c,
          bill: 0x092c5c,
          capFront: -1,
        },
      },
      // City Connect 'Grit x Glow'
      {
        id: "cc",
        name: "City Connect 'Grit x Glow'",
        kit: {
          ...H,
          jersey: 0x2b2b2b,
          pants: 0x2b2b2b,
          chest: "script",
          text: "Tampa Bay",
          tail: true,
          badge: false,
          ink: 0x000000,
          edge: 0x39ff6a,
          num: 0x000000,
          numEdge: 0x39ff6a,
          numSide: 1,
          back: 0x000000,
          backEdge: 0x39ff6a,
          name: 0x000000,
          placket: [0x8a3ffc],
          collar: [0x8a3ffc],
          cuff: [0x2ec4c4],
          pipe: [0x8a3ffc],
          stripe: -1,
          sock: 0x000000,
          sockBand: -1,
          under: 0x000000,
          cap: 0x000000,
          bill: 0x8a3ffc,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[140][0];
    t[140] = [
      // Royal blue road alternate
      {
        id: "alt1",
        name: "Royal blue road alternate",
        kit: {
          ...H,
          jersey: 0x003278,
          pants: 0xb5b7b9,
          chest: "block",
          text: "TEXAS",
          tail: false,
          badge: false,
          ink: 0xffffff,
          edge: 0xc0111f,
          num: 0xffffff,
          numEdge: 0xc0111f,
          numSide: 1,
          back: 0xffffff,
          backEdge: 0xc0111f,
          name: 0xffffff,
          placket: [],
          collar: [],
          cuff: [0x7da7d9, 0xffffff, 0xc0111f],
          pipe: [],
          stripe: -1,
          sock: 0x003278,
          sockBand: -1,
          under: 0x003278,
          cap: 0x003278,
          bill: 0x003278,
          capFront: -1,
        },
      },
      // Powder blue alternate
      {
        id: "alt2",
        name: "Powder blue alternate",
        kit: {
          ...H,
          jersey: 0x7da7d9,
          pants: 0xffffff,
          chest: "script",
          text: "Rangers",
          tail: true,
          badge: false,
          ink: 0xffffff,
          edge: 0x003278,
          num: 0xffffff,
          numEdge: 0x003278,
          numSide: 1,
          back: 0xffffff,
          backEdge: 0x003278,
          name: 0xffffff,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x003278,
          sockBand: -1,
          under: 0x003278,
          cap: 0x7da7d9,
          bill: 0x003278,
          capFront: -1,
        },
      },
      // City Connect 2.0 'Tejas' (2026)
      {
        id: "cc",
        name: "City Connect 2.0 'Tejas' (2026)",
        kit: {
          ...H,
          jersey: 0xa6192e,
          pants: 0xa6192e,
          chest: "block",
          text: "TEJAS",
          tail: false,
          badge: false,
          ink: 0xc8102e,
          edge: 0xffffff,
          num: 0xc8102e,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0xc8102e,
          backEdge: 0xffffff,
          name: 0xc8102e,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [0xffffff],
          stripe: -1,
          sock: 0xa6192e,
          sockBand: -1,
          under: 0xa6192e,
          cap: 0xa6192e,
          bill: 0xa6192e,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[141][0];
    t[141] = [
      // Royal blue alternate
      {
        id: "alt1",
        name: "Royal blue alternate",
        kit: {
          ...H,
          jersey: 0x134a8e,
          pants: 0xffffff,
          chest: "arch",
          text: "BLUE JAYS",
          tail: false,
          badge: false,
          ink: 0xffffff,
          edge: 0x1d2d5c,
          num: 0xffffff,
          numEdge: 0x1d2d5c,
          numSide: 1,
          back: 0xffffff,
          backEdge: 0x1d2d5c,
          name: 0xffffff,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x134a8e,
          sockBand: -1,
          under: 0x134a8e,
          cap: 0x134a8e,
          bill: 0x134a8e,
          capFront: -1,
        },
      },
      // Powder blue 'New Blue' alternate
      {
        id: "alt2",
        name: "Powder blue 'New Blue' alternate",
        kit: {
          ...H,
          jersey: 0x6cace4,
          pants: 0xffffff,
          chest: "arch",
          text: "BLUE JAYS",
          tail: false,
          badge: false,
          ink: 0x1d2d5c,
          edge: 0xffffff,
          num: 0x1d2d5c,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0x1d2d5c,
          backEdge: 0xffffff,
          name: 0x1d2d5c,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x1d2d5c,
          sockBand: -1,
          under: 0x1d2d5c,
          cap: 0x1d2d5c,
          bill: 0x6cace4,
          capFront: -1,
        },
      },
      // City Connect 'Night Mode'
      {
        id: "cc",
        name: "City Connect 'Night Mode'",
        kit: {
          ...H,
          jersey: 0x1b2440,
          pants: 0x1b2440,
          chest: "script",
          text: "Toronto",
          tail: true,
          badge: false,
          ink: 0xe8291c,
          edge: -1,
          num: 0xe8291c,
          numEdge: -1,
          numSide: 1,
          back: 0xe8291c,
          backEdge: -1,
          name: 0xe8291c,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x1b2440,
          sockBand: -1,
          under: 0x1b2440,
          cap: 0x1b2440,
          bill: 0x1b2440,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[142][0];
    t[142] = [
      // Cream Twin Cities alternate
      {
        id: "alt1",
        name: "Cream Twin Cities alternate",
        kit: {
          ...H,
          jersey: 0xf2e8d5,
          pants: 0xf2e8d5,
          chest: "script",
          text: "Twin Cities",
          tail: true,
          badge: false,
          ink: 0x002b5c,
          edge: -1,
          num: 0x002b5c,
          numEdge: -1,
          numSide: 1,
          back: 0x002b5c,
          backEdge: -1,
          name: 0x002b5c,
          placket: [0x002b5c],
          collar: [0x002b5c],
          cuff: [0x002b5c],
          pipe: [0x002b5c],
          stripe: -1,
          sock: 0x002b5c,
          sockBand: -1,
          under: 0x002b5c,
          cap: 0x002b5c,
          bill: 0x002b5c,
          capFront: -1,
        },
      },
      // Navy alternate
      {
        id: "alt2",
        name: "Navy alternate",
        kit: {
          ...H,
          jersey: 0x002b5c,
          pants: 0xffffff,
          chest: "script",
          text: "Twins",
          tail: true,
          badge: false,
          ink: 0xffffff,
          edge: 0xd31145,
          num: 0xd31145,
          numEdge: 0xd31145,
          numSide: 1,
          back: 0xd31145,
          backEdge: 0xd31145,
          name: 0xffffff,
          placket: [],
          collar: [],
          cuff: [0x002b5c, 0xffffff, 0xd31145],
          pipe: [],
          stripe: -1,
          sock: 0x002b5c,
          sockBand: -1,
          under: 0x002b5c,
          cap: 0x002b5c,
          bill: 0x002b5c,
          capFront: -1,
        },
      },
      // City Connect (MN) (approximate)
      {
        id: "cc",
        name: "City Connect (MN)",
        kit: {
          ...H,
          jersey: 0x1f5da0,
          pants: 0xffffff,
          chest: "block",
          text: "MN",
          tail: false,
          badge: false,
          ink: 0xffffff,
          edge: -1,
          num: 0xffffff,
          numEdge: -1,
          numSide: 1,
          back: 0xffffff,
          backEdge: -1,
          name: 0xffffff,
          placket: [],
          collar: [],
          cuff: [0xffc72c],
          pipe: [0x1f5da0, 0xffc72c],
          stripe: -1,
          sock: 0x1f5da0,
          sockBand: -1,
          under: 0x1f5da0,
          cap: 0x1f5da0,
          bill: 0xffc72c,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[143][0];
    t[143] = [
      // Powder blue throwback alternate
      {
        id: "alt1",
        name: "Powder blue throwback alternate",
        kit: {
          ...H,
          jersey: 0x8eb8e5,
          pants: 0xffffff,
          chest: "script",
          text: "Phillies",
          tail: true,
          badge: false,
          ink: 0x6f263d,
          edge: 0xffffff,
          num: 0x6f263d,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0x6f263d,
          backEdge: 0xffffff,
          name: 0x6f263d,
          placket: [0x6f263d, 0xffffff],
          collar: [0x6f263d, 0xffffff],
          cuff: [0x6f263d, 0xffffff],
          pipe: [0x6f263d],
          stripe: -1,
          sock: 0x6f263d,
          sockBand: -1,
          under: 0x6f263d,
          cap: 0x6f263d,
          bill: 0x6f263d,
          capFront: -1,
        },
      },
      // Cream alternate
      {
        id: "alt2",
        name: "Cream alternate",
        kit: {
          ...H,
          jersey: 0xf2e9d8,
          pants: 0xf2e9d8,
          chest: "script",
          text: "Phillies",
          tail: true,
          badge: false,
          ink: 0xe81828,
          edge: 0x002d72,
          num: 0xe81828,
          numEdge: 0x002d72,
          numSide: 1,
          back: 0xe81828,
          backEdge: 0x002d72,
          name: 0xe81828,
          placket: [0x002d72],
          collar: [0x002d72],
          cuff: [0x002d72],
          pipe: [0x002d72],
          stripe: -1,
          sock: 0xe81828,
          sockBand: -1,
          under: 0x002d72,
          cap: 0x002d72,
          bill: 0xe81828,
          capFront: -1,
        },
      },
      // City Connect 'Unapologetically Philly'
      {
        id: "cc",
        name: "City Connect 'Unapologetically Philly'",
        kit: {
          ...H,
          jersey: 0x5b8dc9,
          pants: 0x0d1b3e,
          chest: "block",
          text: "PHILLY",
          tail: false,
          badge: false,
          ink: 0xffffff,
          edge: -1,
          num: 0xf6c700,
          numEdge: -1,
          numSide: 1,
          back: 0xf6c700,
          backEdge: -1,
          name: 0xffffff,
          placket: [],
          collar: [0xf6c700],
          cuff: [0xf6c700],
          pipe: [0xf6c700],
          stripe: -1,
          sock: 0x0d1b3e,
          sockBand: -1,
          under: 0x0d1b3e,
          cap: 0x0d1b3e,
          bill: 0x0d1b3e,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[144][0];
    t[144] = [
      // Red Friday alternate
      {
        id: "alt1",
        name: "Red Friday alternate",
        kit: {
          ...H,
          jersey: 0xce1141,
          pants: 0xffffff,
          chest: "script",
          text: "Braves",
          tail: true,
          badge: false,
          ink: 0x13274f,
          edge: 0xffffff,
          num: 0x13274f,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0x13274f,
          backEdge: 0xffffff,
          name: 0x13274f,
          placket: [0x13274f, 0xffffff],
          collar: [0x13274f, 0xffffff],
          cuff: [0x13274f, 0xffffff],
          pipe: [0x13274f],
          stripe: -1,
          sock: 0x13274f,
          sockBand: -1,
          under: 0x13274f,
          cap: 0x13274f,
          bill: 0xce1141,
          capFront: -1,
        },
      },
      // Navy road alternate
      {
        id: "alt2",
        name: "Navy road alternate",
        kit: {
          ...H,
          jersey: 0x13274f,
          pants: 0xbec0c2,
          chest: "script",
          text: "Atlanta",
          tail: true,
          badge: false,
          ink: 0xce1141,
          edge: 0xffffff,
          num: 0xce1141,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0xce1141,
          backEdge: 0xffffff,
          name: 0xce1141,
          placket: [0xce1141],
          collar: [0xce1141],
          cuff: [0xce1141],
          pipe: [0x13274f],
          stripe: -1,
          sock: 0x13274f,
          sockBand: -1,
          under: 0x13274f,
          cap: 0x13274f,
          bill: 0x13274f,
          capFront: -1,
        },
      },
      // City Connect 2.0 powder blue
      {
        id: "cc",
        name: "City Connect 2.0 powder blue",
        kit: {
          ...H,
          jersey: 0x86b5e0,
          pants: 0xffffff,
          chest: "script",
          text: "Atlanta",
          tail: true,
          badge: false,
          ink: 0x13274f,
          edge: 0xce1141,
          num: 0x13274f,
          numEdge: 0xce1141,
          numSide: 1,
          back: 0x13274f,
          backEdge: 0xce1141,
          name: 0x13274f,
          placket: [0xce1141, 0x13274f],
          collar: [0xce1141, 0x13274f],
          cuff: [0xce1141, 0x13274f],
          pipe: [0xce1141, 0x13274f],
          stripe: -1,
          sock: 0x13274f,
          sockBand: -1,
          under: 0x13274f,
          cap: 0x86b5e0,
          bill: 0x13274f,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[145][0];
    t[145] = [
      // Black alternate
      {
        id: "alt1",
        name: "Black alternate",
        kit: {
          ...H,
          jersey: 0x27251f,
          pants: 0xffffff,
          chest: "block",
          text: "SOX",
          tail: false,
          badge: false,
          ink: 0xffffff,
          edge: 0xc4ced4,
          num: 0xffffff,
          numEdge: 0xc4ced4,
          numSide: 1,
          back: 0xffffff,
          backEdge: 0xc4ced4,
          name: 0xffffff,
          placket: [0xc4ced4],
          collar: [0xc4ced4],
          cuff: [0xc4ced4],
          pipe: [],
          stripe: -1,
          sock: 0x27251f,
          sockBand: -1,
          under: 0x27251f,
          cap: 0x27251f,
          bill: 0x27251f,
          capFront: -1,
        },
      },
      // City Connect (Bulls) (approximate)
      {
        id: "cc",
        name: "City Connect (Bulls)",
        kit: {
          ...H,
          jersey: 0xce1141,
          pants: 0xce1141,
          chest: "block",
          text: "CHICAGO",
          tail: false,
          badge: false,
          ink: 0x000000,
          edge: 0xffffff,
          num: 0x000000,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0x000000,
          backEdge: 0xffffff,
          name: 0x000000,
          placket: [],
          collar: [0x000000],
          cuff: [0x000000],
          pipe: [0x000000],
          stripe: 0x000000,
          sock: 0x000000,
          sockBand: -1,
          under: 0x000000,
          cap: 0xce1141,
          bill: 0xce1141,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[146][0];
    t[146] = [
      // Black alternate
      {
        id: "alt1",
        name: "Black alternate",
        kit: {
          ...H,
          jersey: 0x000000,
          pants: 0xffffff,
          chest: "script",
          text: "Marlins",
          tail: true,
          badge: false,
          ink: 0xffffff,
          edge: 0x00a3e0,
          num: 0xffffff,
          numEdge: 0x00a3e0,
          numSide: 1,
          back: 0xffffff,
          backEdge: 0x00a3e0,
          name: 0xffffff,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x000000,
          sockBand: -1,
          under: 0x000000,
          cap: 0x000000,
          bill: 0x000000,
          capFront: -1,
        },
      },
      // Teal throwback Sunday alternate (approximate)
      {
        id: "alt2",
        name: "Teal throwback Sunday alternate",
        kit: {
          ...H,
          jersey: 0x00a0af,
          pants: 0xffffff,
          chest: "script",
          text: "Marlins",
          tail: true,
          badge: false,
          ink: 0x000000,
          edge: 0xffffff,
          num: 0x000000,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0x000000,
          backEdge: 0xffffff,
          name: 0x000000,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x000000,
          sockBand: -1,
          under: 0x000000,
          cap: 0x000000,
          bill: 0x00a0af,
          capFront: -1,
        },
      },
      // City Connect 'Retrowave' (approximate)
      {
        id: "cc",
        name: "City Connect 'Retrowave'",
        kit: {
          ...H,
          jersey: 0x000000,
          pants: 0x000000,
          chest: "block",
          text: "MIAMI",
          tail: false,
          badge: false,
          ink: 0x00a0af,
          edge: 0xf4a6c9,
          num: 0xf4a6c9,
          numEdge: 0xf4a6c9,
          numSide: 1,
          back: 0xf4a6c9,
          backEdge: 0xf4a6c9,
          name: 0x00a0af,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: 0xf4a6c9,
          sock: 0x000000,
          sockBand: -1,
          under: 0x000000,
          cap: 0x000000,
          bill: 0xf4a6c9,
          capFront: -1,
        },
      },
    ];
  }
  {
    const H = KITS[158][0];
    t[158] = [
      // Powder blue road (2026)
      {
        id: "alt1",
        name: "Powder blue road (2026)",
        kit: {
          ...H,
          jersey: 0x8ec3e6,
          pants: 0xa2aaad,
          chest: "serif",
          text: "Milwaukee",
          tail: false,
          badge: false,
          ink: 0x12284b,
          edge: 0xffc52f,
          num: 0x12284b,
          numEdge: 0xffc52f,
          numSide: 1,
          back: 0x12284b,
          backEdge: 0xffc52f,
          name: 0x12284b,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x12284b,
          sockBand: -1,
          under: 0x12284b,
          cap: 0x12284b,
          bill: 0x12284b,
          capFront: 0xffc52f,
        },
      },
      // Navy road alternate
      {
        id: "alt2",
        name: "Navy road alternate",
        kit: {
          ...H,
          jersey: 0x12284b,
          pants: 0xa2aaad,
          chest: "script",
          text: "Milwaukee",
          tail: true,
          badge: false,
          ink: 0xffc52f,
          edge: 0xffffff,
          num: 0xffc52f,
          numEdge: 0xffffff,
          numSide: 1,
          back: 0xffc52f,
          backEdge: 0xffffff,
          name: 0xffc52f,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: -1,
          sock: 0x12284b,
          sockBand: -1,
          under: 0x12284b,
          cap: 0x12284b,
          bill: 0x12284b,
          capFront: 0xffc52f,
        },
      },
      // White pinstripe home alternate (approximate)
      {
        id: "alt3",
        name: "White pinstripe home alternate",
        kit: {
          ...H,
          jersey: 0xffffff,
          pants: 0xffffff,
          chest: "block",
          text: "BREWERS",
          tail: false,
          badge: false,
          ink: 0x12284b,
          edge: 0xffc52f,
          num: 0x12284b,
          numEdge: 0xffc52f,
          numSide: 1,
          back: 0x12284b,
          backEdge: 0xffc52f,
          name: 0x12284b,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [],
          stripe: 0x12284b,
          sock: 0x12284b,
          sockBand: -1,
          under: 0x12284b,
          cap: 0x12284b,
          bill: 0x12284b,
          capFront: -1,
        },
      },
      // City Connect 2.0 (2026) 'Wisco' (approximate)
      {
        id: "cc",
        name: "City Connect 2.0 (2026) 'Wisco'",
        kit: {
          ...H,
          jersey: 0x2c6bac,
          pants: 0xf2e8d5,
          chest: "script",
          text: "Wisco",
          tail: true,
          badge: false,
          ink: 0xf7a02a,
          edge: 0xf2e8d5,
          num: 0xf2e8d5,
          numEdge: 0xf2e8d5,
          numSide: 1,
          back: 0xf2e8d5,
          backEdge: 0xf2e8d5,
          name: 0xf7a02a,
          placket: [],
          collar: [],
          cuff: [],
          pipe: [0xf2e8d5],
          stripe: -1,
          sock: 0x2c6bac,
          sockBand: -1,
          under: 0x2c6bac,
          cap: 0x2c6bac,
          bill: 0x2c6bac,
          capFront: -1,
        },
      },
    ];
  }

  return t;
})();

/** Every set a club wears: home, road, then its alternates and City Connect. */
export function clubSets(teamId: number): KitSet[] {
  const pair = KITS[teamId];
  if (!pair) return [];
  return [
    { id: "home", name: "Home", kit: pair[0] },
    { id: "road", name: "Road", kit: pair[1] },
    ...(EXTRA_KITS[teamId] ?? []),
  ];
}

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
  Object.entries(KITS).map(([id, [h, r]]) => [
    id,
    {
      home: h.jersey,
      road: r.jersey,
      cap: h.cap,
      letter: h.ink,
      trim: h.accent,
      ...(h.stripe >= 0 ? { stripe: h.stripe } : {}),
    },
  ]),
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

export function uniformFor(
  teamId: number,
  home: boolean,
  fallbackColor: number,
): Uniform {
  const pair = KITS[teamId];
  if (!pair)
    return {
      teamId,
      home,
      jersey: home ? WHITE : GRAY,
      cap: fallbackColor,
      letter: fallbackColor,
      trim: fallbackColor,
      stripe: -1,
      kit: null,
    };
  const k = pair[home ? 0 : 1];
  return {
    teamId,
    home,
    jersey: k.jersey,
    cap: k.cap,
    letter: k.ink,
    trim: k.accent,
    stripe: k.stripe,
    kit: k,
  };
}

/** A kit for somebody without a club set: plain cloth with everything in one trim colour. */
export function plainKit(
  jersey: number,
  ink: number,
  cap: number,
  accent: number,
  stripe: number,
): Kit {
  return kit(jersey, ink, {
    chest: "script",
    cap,
    stripe,
    accent,
    sock: accent,
  });
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
  og.drawImage(
    c,
    x0,
    best[0],
    out.width,
    out.height,
    0,
    0,
    out.width,
    out.height,
  );
  return { src: out, w: out.width, h: out.height };
}

function loadMark(key: string, url: string, crop: boolean): Mark | null {
  if (typeof Image === "undefined" || typeof document === "undefined")
    return null;
  if (marks.has(key)) return marks.get(key) ?? null;
  marks.set(key, null);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.onload = () => {
    if (!img.naturalWidth) return;
    const m = crop
      ? mainLine(img)
      : { src: img, w: img.naturalWidth, h: img.naturalHeight };
    if (m) {
      marks.set(key, m);
      logoVersion += 1;
    }
  };
  img.src = url;
  return null;
}

/** The club's wordmark for a light or dark jersey, once loaded (null until then, on failure, or if the club has none that fits). */
export function chestWordmark(
  teamId: number,
  darkJersey: boolean,
): Mark | null {
  if (!teamId) return null;
  const surface = darkJersey ? "on-dark" : "on-light";
  return loadMark(
    `w${surface}${teamId}`,
    `https://www.mlbstatic.com/team-logos/team-wordmark-${surface}/${teamId}.svg`,
    true,
  );
}

/** The club's cap mark in its light-background colours, for the left chest. */
export function chestLogo(teamId: number, darkJersey: boolean): Mark | null {
  if (!teamId) return null;
  return loadMark(
    `l${darkJersey ? "d" : "l"}${teamId}`,
    mlbTeamLogoUrl(teamId, darkJersey ? "dark" : "light"),
    false,
  );
}
