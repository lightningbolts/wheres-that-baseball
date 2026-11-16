/**
 * Per-park stadium layouts: what gets built around each real field outline.
 *
 * Bearings are spray angles seen from home plate, in degrees: 0 = center field, −45 / +45 =
 * the left / right field foul poles, ±90 ≈ the dugouts, ±180 = directly behind the plate.
 * Everything here is render-only data (pure, no three.js); the physics lives in park.ts.
 */

export type WallSkin = "pad" | "brick" | "ivy" | "monster" | "board" | "chain" | "stone";

/** One seating deck in cross-section (feet). */
export interface Deck {
  /** Horizontal distance from the field wall to the deck's front edge. */
  off: number;
  /** Horizontal depth of the seating. */
  depth: number;
  /** Height of the front edge: above the wall top when `rel`, else above the field. */
  base: number;
  /** Height gained front to back. */
  rise: number;
  rel?: boolean;
  /** Canopy over the back rows. */
  roof?: boolean;
  /** Grass berm instead of seats. */
  berm?: boolean;
  /** Which of the layout's seat colors to use (0 lower, 1 club, 2 upper). */
  tint?: 0 | 1 | 2;
}

export type StandKey =
  | "box4"
  | "box3"
  | "box2"
  | "classic"
  | "small"
  | "bleach"
  | "bleachTall"
  | "of2"
  | "of3"
  | "porch"
  | "monster"
  | "berm"
  | "rockpile"
  | "pavilion"
  | "kc"
  | "dodger"
  | "of1"
  | "terrace"
  | "hotel";

export const STAND_PRESETS: Record<StandKey, Deck[]> = {
  box4: [
    { off: 3, depth: 80, base: 1, rise: 28, rel: true },
    { off: 66, depth: 36, base: 40, rise: 14, tint: 1 },
    { off: 78, depth: 60, base: 66, rise: 34, tint: 1 },
    { off: 120, depth: 72, base: 108, rise: 48, tint: 2 },
  ],
  box3: [
    { off: 3, depth: 92, base: 1, rise: 33, rel: true },
    { off: 74, depth: 34, base: 46, rise: 14, tint: 1 },
    { off: 84, depth: 92, base: 74, rise: 60, tint: 2 },
  ],
  box2: [
    { off: 3, depth: 95, base: 1, rise: 35, rel: true },
    { off: 80, depth: 85, base: 58, rise: 56, tint: 2 },
  ],
  classic: [
    { off: 3, depth: 105, base: 1, rise: 36, rel: true },
    { off: 58, depth: 55, base: 54, rise: 30, tint: 2, roof: true },
  ],
  small: [
    { off: 3, depth: 62, base: 1, rise: 22, rel: true },
    { off: 66, depth: 22, base: 34, rise: 8, tint: 1, roof: true },
  ],
  bleach: [{ off: 4, depth: 70, base: 2, rise: 32, rel: true }],
  bleachTall: [{ off: 4, depth: 105, base: 2, rise: 50, rel: true }],
  of2: [
    { off: 4, depth: 62, base: 2, rise: 27, rel: true },
    { off: 52, depth: 72, base: 46, rise: 44, tint: 2 },
  ],
  of3: [
    { off: 4, depth: 62, base: 2, rise: 27, rel: true },
    { off: 52, depth: 40, base: 46, rise: 18, tint: 1 },
    { off: 70, depth: 80, base: 76, rise: 52, tint: 2 },
  ],
  porch: [{ off: 3, depth: 26, base: 1, rise: 10, rel: true }],
  monster: [{ off: 1, depth: 20, base: 0.5, rise: 11, rel: true }],
  berm: [{ off: 4, depth: 60, base: 1, rise: 16, rel: true, berm: true }],
  rockpile: [{ off: 70, depth: 55, base: 34, rise: 30 }],
  pavilion: [{ off: 4, depth: 70, base: 2, rise: 30, rel: true, roof: true }],
  // Kauffman: a thin club level under one tall, steep upper deck.
  kc: [
    { off: 3, depth: 88, base: 1, rise: 30, rel: true },
    { off: 74, depth: 26, base: 44, rise: 9, tint: 1 },
    { off: 86, depth: 112, base: 68, rise: 80, tint: 2 },
  ],
  // Dodger Stadium: five thin stacked decks, the top one only behind the plate.
  dodger: [
    { off: 3, depth: 72, base: 1, rise: 22, rel: true },
    { off: 60, depth: 42, base: 32, rise: 14, tint: 1 },
    { off: 70, depth: 26, base: 54, rise: 8, tint: 1 },
    { off: 82, depth: 74, base: 72, rise: 42, tint: 2 },
    { off: 136, depth: 46, base: 122, rise: 28, tint: 2 },
  ],
  of1: [{ off: 4, depth: 46, base: 2, rise: 19, rel: true }],
  // Restaurant terraces: a few rows at the wall under a covered party deck.
  terrace: [
    { off: 4, depth: 34, base: 2, rise: 12, rel: true },
    { off: 26, depth: 44, base: 36, rise: 20, tint: 1, roof: true },
  ],
  // Rogers Centre's outfield: a low bowl with the hotel's glass floors stacked above.
  hotel: [
    { off: 4, depth: 56, base: 2, rise: 24, rel: true },
    { off: 44, depth: 30, base: 44, rise: 10, tint: 1 },
    { off: 56, depth: 28, base: 70, rise: 10, tint: 1 },
    { off: 66, depth: 70, base: 96, rise: 46, tint: 2 },
  ],
};

export interface StandSpec {
  from: number;
  to: number;
  key: StandKey;
  /** Extra setback from the wall (ft) — leaves room for a bullpen or plaza. */
  back?: number;
  /** Bullpen in the setback gap. */
  pen?: boolean;
  /** Bearings the upper decks span, when they stop short of the lower bowl. */
  up?: [number, number];
  /** Bearings the top deck spans (stands with three or more decks). */
  top?: [number, number];
  /** Length (ft) over which the top deck steps down toward its open ends. */
  taper?: number;
  /** Canopy over the top deck (default: infield grandstands only). */
  cover?: boolean;
}

export type Feature =
  | { k: "skyline"; from: number; to: number; dist: number; h: number; n: number; tall?: Array<[number, number]> }
  | { k: "mountains"; from: number; to: number; dist: number; h: number; color: string; snow?: boolean }
  /** Open water `back` ft past the wall; `w` makes it a river of that width (default: open bay). */
  | { k: "water"; from: number; to: number; back: number; w?: number }
  | { k: "bridge"; deg: number; dist: number; len: number; color: string; towers: number }
  | { k: "arch"; deg: number; dist: number; h: number }
  | { k: "needle"; deg: number; dist: number; h: number; style?: "saucer" }
  | { k: "building"; deg: number; back: number; w: number; d: number; h: number; color: string; trim?: string; glass?: boolean; /** Turn the face this many degrees off square-to-home (+ swings it toward right field). */ skew?: number }
  | { k: "rowhouses"; from: number; to: number; back: number }
  | { k: "trees"; from: number; to: number; back: number; kind: "pine" | "palm" | "round" | "cherry"; n: number }
  | { k: "rocks"; deg: number; back: number; w: number; water?: boolean }
  | { k: "fountain"; from: number; to: number; back: number }
  | { k: "glass"; from: number; to: number; back: number; h: number }
  | {
      k: "apple" | "bell" | "bottle" | "glove" | "stacks" | "bigA" | "train" | "slide" | "pool" | "pinwheels" | "crown" | "triSign" | "boats" | "flags";
      deg: number;
      back: number;
      y?: number;
    };

export interface RoofSpec {
  /** Bearing the roof rails run along. */
  axis: number;
  /** Fraction of the span the parked panels cover, measured from the +axis end. */
  cover: number;
  h: number;
  color: string;
  /**
   * How the panels park: sliding to one end, split to both, fanned to the sides, or a stacked
   * dome. "cable" is a fixed fabric cable dome (Tropicana Field), with `h` its peak height.
   */
  kind?: "slide" | "split" | "fan" | "dome" | "cable";
}

export interface ParkLayout {
  /** Seat colors: lower bowl, club level, upper deck. */
  seats: [string, string, string];
  /** Outfield wall padding tint. */
  wall: string;
  /** Fascia / canopy color. */
  trim: string;
  concrete: string;
  /** Exterior wall color and look (default: the concrete color, arcaded). */
  facade?: string;
  facadeStyle?: "arches" | "plain" | "glass";
  /** Canopy roof color (default: trim). */
  canopy?: string;
  /** Folded-plate canopies (Dodger Stadium's pavilion roofs). */
  canopyStyle?: "zigzag";
  /** Outfield wall skins as `[fromDeg, skin]` steps (like wall heights). */
  skins: Array<[number, WallSkin]>;
  foulSkin: WallSkin;
  stands: StandSpec[];
  /** Batter's eye: bearing range, height, look. */
  eye: { from: number; to: number; h: number; style: "wall" | "grass" | "trees" | "ivy" | "black" };
  board: { deg: number; back: number; y: number; w: number; style: "led" | "green" | "hex" };
  lights: "tower" | "rim" | "brush";
  mow: "checker" | "stripes" | "arcs" | "plain";
  roof?: RoofSpec;
  /** White scalloped frieze on canopies (Yankee Stadium). */
  frieze?: boolean;
  /** Foul pole color (Citi Field's are orange). */
  pole?: string;
  /** Mile-high purple row in the upper deck (Coors). */
  purpleRow?: boolean;
  features: Feature[];
}

const GREEN = "#1f5137";
const NAVY = "#1b2c52";
const BRICK = "#96563f";
const st = (from: number, to: number, key: StandKey, back?: number, pen?: boolean, x?: Partial<StandSpec>): StandSpec => ({ from, to, key, back, pen, ...x });
type Span = number | [number, number];
const span = (v: Span | undefined): [[number, number], [number, number]] | null => (v == null ? null : typeof v === "number" ? [[-180, -v], [v, 180]] : [[-180, v[0]], [v[1], 180]]);
/**
 * Infield grandstand from the left pole around the plate to the right pole. `up` / `top` say
 * where the upper decks / top deck end (one bearing for both sides, or [left, right]).
 */
const infield = (key: StandKey, left = -52, right = 52, o: { up?: Span; top?: Span; taper?: number; cover?: boolean } = {}): StandSpec[] => {
  const up = span(o.up);
  const top = span(o.top);
  const x = (i: 0 | 1): Partial<StandSpec> => ({ ...(up ? { up: up[i] } : {}), ...(top ? { top: top[i] } : {}), ...(o.taper ? { taper: o.taper } : {}), ...(o.cover != null ? { cover: o.cover } : {}) });
  return [st(-180, left, key, 0, false, x(0)), st(right, 180, key, 0, false, x(1))];
};

const BASE: ParkLayout = {
  seats: [GREEN, "#274f6b", GREEN],
  wall: "#1d4a36",
  trim: "#2b3138",
  concrete: "#8f9296",
  skins: [[-45, "pad"]],
  foulSkin: "pad",
  stands: [...infield("box3", -52, 52, { taper: 90 }), st(-45, -9, "of2", 26, true), st(9, 45, "bleach", 26, true)],
  eye: { from: -7, to: 7, h: 42, style: "wall" },
  board: { deg: -24, back: 150, y: 118, w: 120, style: "led" },
  lights: "tower",
  mow: "checker",
  features: [
    { k: "skyline", from: -40, to: 40, dist: 1700, h: 180, n: 26 },
    { k: "trees", from: -6, to: 6, back: 70, kind: "round", n: 8 },
  ],
};

const L = (o: Partial<ParkLayout>): ParkLayout => ({ ...BASE, ...o });

export const PARK_LAYOUTS: Record<number, ParkLayout> = {
  // Angel Stadium — three decks to the corners, rock pile and geysers in left-center, the Big A.
  1: L({
    seats: ["#1f5a3c", "#7b2a2a", "#1f5a3c"],
    concrete: "#b9b3a4",
    facade: "#c4bba8",
    facadeStyle: "plain",
    trim: "#2a4a3a",
    stands: [...infield("box3", -56, 56, { up: 64, taper: 110 }), st(-45, -24, "of1", 24, true), st(12, 45, "of2", 2, false, { cover: false })],
    skins: [[-45, "pad"], [22, "board"]],
    eye: { from: -8, to: 8, h: 36, style: "grass" },
    board: { deg: 30, back: 150, y: 128, w: 120, style: "led" },
    lights: "rim",
    mow: "arcs",
    features: [
      { k: "rocks", deg: -14, back: 34, w: 90, water: true },
      { k: "trees", from: -21, to: -7, back: 78, kind: "pine", n: 9 },
      // The Big A stands at the far edge of the lot by the 57, beyond the right-field stands.
      { k: "bigA", deg: 66, back: 980 },
      // San Gabriels to the north, the Puente/Brea hills behind center, Santa Ana Mountains to the east.
      { k: "mountains", from: -70, to: -5, dist: 4800, h: 220, color: "#8c9cb3" },
      { k: "mountains", from: -45, to: 30, dist: 3800, h: 110, color: "#8f9a86" },
      { k: "mountains", from: 60, to: 110, dist: 4800, h: 200, color: "#93a0b0" },
      { k: "trees", from: -50, to: 50, back: 300, kind: "palm", n: 24 },
    ],
  }),
  // Camden Yards — brick arches, the B&O Warehouse behind right field, downtown past center.
  2: L({
    seats: ["#1d4a37", "#1d4a37", "#1d4a37"],
    concrete: "#8f8a80",
    facade: "#8f4a36",
    trim: "#1d3b2c",
    stands: [...infield("box3", -50, 60, { up: [-56, 70], taper: 90 }), st(-45, -14, "of1", 4), st(-13, -4, "bleach", 26, true), st(14, 45, "porch")],
    skins: [[-45, "pad"], [22, "board"]],
    foulSkin: "brick",
    eye: { from: -4, to: 9, h: 40, style: "ivy" },
    // Main videoboard over the right-field bleachers, under the flag court.
    board: { deg: 21, back: 72, y: 86, w: 100, style: "led" },
    features: [
      // B&O Warehouse: ~1,000 ft long, 8 storeys, running north–south beyond Eutaw Street
      // (OSM footprint: spray +9 at 715 ft to +97 at 578 ft, nearest 458 ft at about +57).
      { k: "building", deg: 44, back: 155, w: 940, d: 51, h: 98, color: "#8a4a36", trim: "#c8b89a", skew: 15 },
      // Downtown past left-center: the Hilton (-21), Bromo-Seltzer Tower (-19, 1,700 ft),
      // 100 Light Street, the tallest (+23, 2,600 ft).
      { k: "skyline", from: -32, to: 30, dist: 1350, h: 250, n: 22, tall: [[-21, 300], [-19, 360], [23, 560]] },
      { k: "flags", deg: 30, back: 34 },
    ],
  }),
  // Fenway Park — Green Monster, the Triangle, Pesky's Pole, one roofed deck.
  3: L({
    seats: ["#a3312d", "#a3312d", "#2c5a44"],
    wall: "#2c5f47",
    trim: "#2c5a44",
    facade: "#8d4a38",
    stands: [...infield("classic", -50, 50, { up: [-62, 58] }), st(-45, -10, "monster"), st(-8, 11, "bleach", 8), st(13, 43, "bleachTall", 24, true)],
    skins: [[-45, "monster"], [-9.5, "pad"]],
    eye: { from: -6, to: 6, h: 30, style: "wall" },
    board: { deg: 2, back: 140, y: 104, w: 116, style: "led" },
    mow: "checker",
    features: [
      // Citgo sign over Kenmore Square, ~1,100 ft from the plate past the Monster.
      { k: "triSign", deg: -12, back: 724, y: 135 },
      // Back Bay over right field: the Prudential (+40) and the Hancock (+35) beyond it.
      { k: "skyline", from: 15, to: 55, dist: 2600, h: 300, n: 20, tall: [[40, 770], [35, 560]] },
      { k: "building", deg: -24, back: 150, w: 420, d: 60, h: 62, color: "#8d5a44", trim: "#cdbfa6" },
    ],
  }),
  // Rate Field — symmetric bowl, steep roofed upper deck, exploding scoreboard with pinwheels.
  4: L({
    seats: ["#20503a", "#20503a", "#20503a"],
    wall: "#1e4a35",
    concrete: "#b5ad9c",
    facade: "#c9b99c",
    trim: "#23272c",
    stands: [...infield("box3", -52, 52, { taper: 60 }), st(-45, -9, "bleach", 24, true), st(9, 45, "bleach", 24, true)],
    eye: { from: -8, to: 8, h: 44, style: "ivy" },
    board: { deg: 0, back: 120, y: 118, w: 132, style: "led" },
    mow: "stripes",
    features: [
      { k: "pinwheels", deg: 0, back: 122, y: 150 },
      // The Loop lies north, behind the third-base stands (Willis Tower at -128, 3.4 mi).
      { k: "skyline", from: -150, to: -108, dist: 3000, h: 260, n: 24, tall: [[-128, 400]] },
    ],
  }),
  // Progressive Field — white steel, 19 ft left-field wall under the big board, toothbrush lights.
  5: L({
    concrete: "#c9c6bc",
    facade: "#dcd8cc",
    facadeStyle: "plain",
    trim: "#e6e6e0",
    stands: [...infield("box3", -52, 52, { up: [-52, 62], taper: 80 }), st(-45, -13, "bleachTall", 4), st(13, 45, "of2", 22, true, { cover: false })],
    eye: { from: -11, to: 11, h: 38, style: "trees" },
    board: { deg: -28, back: 135, y: 150, w: 140, style: "led" },
    lights: "brush",
    features: [
      { k: "trees", from: -11, to: 11, back: 46, kind: "round", n: 12 },
      // Downtown over the left-field corner: Terminal Tower (-65) and Key Tower (-48).
      { k: "skyline", from: -82, to: -32, dist: 1900, h: 300, n: 22, tall: [[-65, 885], [-48, 955]] },
    ],
  }),
  // Kauffman Stadium — swooping upper deck, fountains and the crown scoreboard, open outfield.
  7: L({
    seats: ["#1d4c8f", "#1d4c8f", "#1d4c8f"],
    wall: "#1f4f3a",
    concrete: "#c9c6bd",
    facade: "#d2cfc5",
    facadeStyle: "plain",
    trim: "#d9d7cf",
    stands: [...infield("kc", -60, 60, { up: 68, taper: 330 }), st(-45, -30, "of1", 46), st(30, 45, "of1", 46)],
    eye: { from: -9, to: 9, h: 30, style: "grass" },
    board: { deg: 0, back: 150, y: 96, w: 84, style: "led" },
    lights: "rim",
    mow: "arcs",
    features: [
      // Water Spectacular (322 ft wide) behind the right-field fence.
      { k: "fountain", from: 8, to: 42, back: 16 },
      { k: "fountain", from: -29, to: -11, back: 16 },
      { k: "crown", deg: 0, back: 152, y: 140 },
      { k: "mountains", from: -80, to: 80, dist: 2200, h: 70, color: "#4f6b4a" },
      { k: "trees", from: -50, to: 50, back: 260, kind: "round", n: 30 },
    ],
  }),
  // Tropicana Field — the tilted cable dome and its catwalks, turf, the ray tank in right-center.
  12: L({
    seats: ["#1f4e9c", "#1f4e9c", "#1f4e9c"],
    wall: "#14305f",
    concrete: "#c9c7c0",
    facade: "#e6e4dc",
    facadeStyle: "plain",
    trim: "#1b2c52",
    stands: [...infield("box3", -52, 52, { taper: 70, cover: false }), st(-45, -14, "of2", 4, false, { cover: false }), st(-11, 11, "porch", 34), st(14, 45, "bleach", 4)],
    eye: { from: -9, to: 9, h: 30, style: "black" },
    board: { deg: 20, back: 70, y: 92, w: 64, style: "led" },
    lights: "rim",
    mow: "stripes",
    roof: { axis: 0, cover: 0, h: 225, color: "#f2f2ee", kind: "cable" },
    features: [{ k: "pool", deg: 14, back: 4 }],
  }),
  // Rogers Centre — closed concrete bowl, hotel in center, the dome stacked north, the CN Tower.
  14: L({
    seats: ["#1f4f9a", "#1f4f9a", "#1f4f9a"],
    wall: "#1a3f7a",
    concrete: "#a9acb0",
    facade: "#b9bbbd",
    facadeStyle: "plain",
    stands: [...infield("box4", -52, 52), st(-52, -45, "box4"), st(45, 52, "box4"), st(-45, -9, "hotel", 22, true), st(9, 45, "hotel", 22, true)],
    eye: { from: -9, to: 9, h: 44, style: "black" },
    board: { deg: 0, back: 96, y: 128, w: 150, style: "led" },
    lights: "rim",
    mow: "plain",
    roof: { axis: 0, cover: 0.34, h: 250, color: "#dfe2e6", kind: "dome" },
    features: [
      { k: "building", deg: 0, back: 104, w: 330, d: 60, h: 190, color: "#9fb4c4", trim: "#c9cdd1", glass: true },
      // CN Tower just past the first-base side; the Financial District beyond right field.
      { k: "needle", deg: 55, dist: 765, h: 1500 },
      { k: "skyline", from: 38, to: 85, dist: 2600, h: 520, n: 22, tall: [[49, 1220]] },
    ],
  }),
  // Chase Field — pool in right-center, the roof split to both ends, panelled walls beyond.
  15: L({
    seats: ["#215240", "#7a2a2e", "#215240"],
    wall: "#1f4c39",
    concrete: "#a8a093",
    facade: "#a2604a",
    trim: "#2a4f43",
    stands: [...infield("box4", -52, 52, { top: 60 }), st(-45, -7, "bleach", 22, true), st(7, 19, "bleach", 22), st(31, 45, "bleach", 22, true)],
    skins: [[-45, "pad"]],
    eye: { from: -5, to: 5, h: 60, style: "wall" },
    board: { deg: 0, back: 120, y: 132, w: 150, style: "led" },
    lights: "rim",
    mow: "stripes",
    roof: { axis: 90, cover: 0.3, h: 250, color: "#d6d9db", kind: "split" },
    features: [
      { k: "pool", deg: 25, back: 18 },
      { k: "glass", from: -42, to: 42, back: 190, h: 170 },
      // Downtown Phoenix (Chase Tower) off the left-field corner.
      { k: "skyline", from: -75, to: -30, dist: 1900, h: 260, n: 16, tall: [[-57, 600]] },
    ],
  }),
  // Wrigley Field — ivy on brick, bleachers under the green scoreboard, rooftops across the street.
  17: L({
    seats: ["#1e4d37", "#1e4d37", "#1e4d37"],
    wall: "#2f6b3a",
    trim: "#24503c",
    concrete: "#b9b3a2",
    facade: "#c8c0ac",
    facadeStyle: "plain",
    stands: [...infield("classic", -50, 50, { up: [-60, 60] }), st(-45, -16, "bleach", 3), st(-16, 16, "bleachTall", 3), st(16, 45, "bleach", 3)],
    skins: [[-45, "ivy"]],
    foulSkin: "brick",
    eye: { from: -6, to: 6, h: 14, style: "ivy" },
    board: { deg: 0, back: 112, y: 104, w: 76, style: "green" },
    lights: "rim",
    mow: "checker",
    features: [
      { k: "rowhouses", from: -44, to: 44, back: 170 },
      // The Loop is ~4-5 miles south-southeast, behind the first-base side: Hancock (+112), Willis (+126).
      // Compressed to fit the far plane; heights scaled to keep their true angular size.
      { k: "skyline", from: 100, to: 132, dist: 2900, h: 140, n: 18, tall: [[112, 280], [126, 280]] },
      { k: "flags", deg: 0, back: 114, y: 130 },
    ],
  }),
  // Coors Field — brick, pines and fountains in center, the Rockpile, the purple row, the Rockies.
  19: L({
    seats: ["#1f5a3a", "#1f5a3a", "#1f5a3a"],
    facade: "#9a5a44",
    concrete: "#a59c8e",
    trim: "#2a4a3c",
    stands: [...infield("box3", -52, 52, { up: [-60, 52], taper: 80 }), st(-45, -12, "bleach", 24, true), st(-3, 12, "rockpile"), st(15, 45, "of2", 4, false, { cover: false })],
    skins: [[-45, "pad"], [20, "board"]],
    eye: { from: -11, to: 11, h: 26, style: "trees" },
    board: { deg: -27, back: 140, y: 128, w: 124, style: "led" },
    mow: "checker",
    purpleRow: true,
    features: [
      { k: "rocks", deg: 0, back: 30, w: 120, water: true },
      { k: "trees", from: -11, to: 11, back: 40, kind: "pine", n: 16 },
      // The Front Range lies west, past third base and the left-field corner; downtown is behind first base.
      { k: "mountains", from: -135, to: -40, dist: 4500, h: 250, color: "#6f7fa0", snow: true },
      { k: "skyline", from: 125, to: 178, dist: 2600, h: 300, n: 20, tall: [[156, 600]] },
    ],
  }),
  // Dodger Stadium — five pastel decks, roofed pavilions, hexagonal boards, palms and the San Gabriels.
  22: L({
    seats: ["#e3bd4a", "#de9146", "#69a9d6"],
    wall: "#1c4e96",
    trim: "#e9e6dc",
    concrete: "#b9b4a6",
    facade: "#c6c0b0",
    facadeStyle: "plain",
    canopyStyle: "zigzag",
    stands: [...infield("dodger", -56, 56, { up: 62, top: 128, taper: 60 }), st(-42, -11, "pavilion", 24, true), st(11, 42, "pavilion", 24, true)],
    eye: { from: -10, to: 10, h: 34, style: "black" },
    board: { deg: -26, back: 118, y: 96, w: 84, style: "hex" },
    lights: "tower",
    mow: "arcs",
    features: [
      { k: "trees", from: -44, to: 44, back: 150, kind: "palm", n: 30 },
      { k: "mountains", from: -35, to: 50, dist: 4500, h: 340, color: "#8c8fa6" },
      { k: "mountains", from: -70, to: 70, dist: 900, h: 110, color: "#6b7a55" },
      // Downtown LA behind home plate (U.S. Bank Tower, Wilshire Grand, City Hall).
      { k: "skyline", from: 158, to: 195, dist: 3000, h: 260, n: 18, tall: [[183, 560], [186, 540], [160, 320]] },
    ],
  }),
  // PNC Park — two limestone decks, Clemente Wall, the Allegheny, the yellow bridge and downtown.
  31: L({
    seats: ["#1d3157", "#1d3157", "#1d3157"],
    wall: "#1e4d38",
    concrete: "#b9ad8e",
    facade: "#cdbd94",
    trim: "#1d3157",
    stands: [...infield("box2", -52, 60, { up: [-52, 66], taper: 80 }), st(-45, -16, "bleach", 22, true), st(9, 45, "porch")],
    skins: [[-45, "pad"], [8, "board"]],
    eye: { from: -12, to: 6, h: 30, style: "trees" },
    board: { deg: -30, back: 130, y: 116, w: 110, style: "led" },
    lights: "brush",
    mow: "checker",
    features: [
      // The Allegheny runs behind right and center; the Clemente (+8), Warhol (-17) and Carson (-21) bridges cross it.
      { k: "water", from: -25, to: 100, back: 150 },
      { k: "bridge", deg: 8, dist: 969, len: 900, color: "#e9b824", towers: 2 },
      { k: "bridge", deg: -17, dist: 1311, len: 900, color: "#e9b824", towers: 2 },
      { k: "bridge", deg: -21, dist: 1813, len: 900, color: "#e9b824", towers: 2 },
      // Downtown across the river: U.S. Steel Tower (+6), BNY Mellon (+16.5), PPG Place (+48).
      { k: "skyline", from: -5, to: 60, dist: 2300, h: 300, n: 26, tall: [[6, 846], [16.5, 704], [48, 910]] },
      { k: "trees", from: -12, to: 6, back: 44, kind: "round", n: 8 },
    ],
  }),
  // American Family Field — brick arches under the fan-shaped roof, Bernie's slide.
  32: L({
    seats: ["#1f4f39", "#1f4f39", "#1f4f39"],
    wall: "#1c3f6e",
    concrete: "#a59a8c",
    facade: "#9a5a44",
    trim: "#2a4f43",
    stands: [...infield("box4", -52, 52), st(-45, -9, "of2", 22, true, { cover: false }), st(9, 45, "of2", 22, true, { cover: false })],
    eye: { from: -8, to: 8, h: 44, style: "wall" },
    board: { deg: 0, back: 130, y: 140, w: 150, style: "led" },
    lights: "rim",
    mow: "arcs",
    roof: { axis: 0, cover: 0.2, h: 250, color: "#c9ced3", kind: "fan" },
    features: [
      { k: "slide", deg: -30, back: 150, y: 110 },
      { k: "glass", from: -44, to: 44, back: 200, h: 200 },
    ],
  }),
  // T-Mobile Park — brick and green steel, the roof parked beyond right field, Seattle past left.
  680: L({
    seats: ["#1f4d3a", "#1f4d3a", "#1f4d3a"],
    wall: "#1d4636",
    facade: "#8f5440",
    concrete: "#9a9d9a",
    trim: "#22463a",
    stands: [...infield("box3", -52, 52, { taper: 70 }), st(-45, -11, "bleach", 24, true), st(11, 45, "of2", 6, false, { cover: false })],
    eye: { from: -8, to: 8, h: 40, style: "wall" },
    board: { deg: -12, back: 150, y: 130, w: 140, style: "led" },
    lights: "rim",
    mow: "stripes",
    // The roof parks east over the BNSF tracks, beyond right field.
    roof: { axis: 43, cover: 0.4, h: 240, color: "#b3bbbf" },
    features: [
      // Downtown (Columbia Center, Smith Tower) past the left-field corner.
      { k: "skyline", from: -80, to: -20, dist: 2600, h: 380, n: 28, tall: [[-40, 800], [-47, 640], [-55, 600]] },
      // The Space Needle far up the waterfront, the Olympics across the Sound, Rainier to the southeast.
      { k: "needle", deg: -67, dist: 5200, h: 300, style: "saucer" },
      { k: "mountains", from: -150, to: -95, dist: 4800, h: 180, color: "#7f8fa8", snow: true },
      { k: "mountains", from: 98, to: 113, dist: 5000, h: 260, color: "#8d9ab2", snow: true },
      { k: "trees", from: -44, to: -20, back: 60, kind: "pine", n: 8 },
    ],
  }),
  // Daikin Park — Crawford Boxes, the arches and the train, glass wall to downtown.
  2392: L({
    seats: ["#1f4b38", "#1f4b38", "#1f4b38"],
    wall: "#1d4634",
    concrete: "#b9a98c",
    facade: "#b29a78",
    trim: "#2a4a3c",
    stands: [...infield("box3", -52, 52, { taper: 60 }), st(-45, -19, "bleach", 1), st(12, 45, "of2", 22, true, { cover: false })],
    skins: [[-45, "board"], [-12, "pad"]],
    eye: { from: -8, to: 8, h: 40, style: "wall" },
    board: { deg: 28, back: 150, y: 138, w: 130, style: "led" },
    lights: "rim",
    mow: "checker",
    // The roof panels stack beyond right field.
    roof: { axis: 42, cover: 0.36, h: 250, color: "#c2c7c9" },
    features: [
      { k: "train", deg: -24, back: 96, y: 74 },
      { k: "glass", from: -48, to: -6, back: 130, h: 190 },
      // Downtown Houston beyond left field: JPMorgan Chase Tower and Wells Fargo Plaza.
      { k: "skyline", from: -80, to: -35, dist: 2100, h: 420, n: 20, tall: [[-50, 1250], [-67, 850]] },
      { k: "trees", from: -8, to: 8, back: 50, kind: "round", n: 6 },
    ],
  }),
  // Comerica Park — two decks, center-field fountain and ivy, the big board in left, Detroit.
  2394: L({
    seats: ["#1f4d39", "#1f4d39", "#1f4d39"],
    concrete: "#a9a195",
    facade: "#b9a488",
    trim: "#1f3d30",
    stands: [...infield("box2", -52, 52, { up: [-58, 52], taper: 70 }), st(-45, -14, "bleach", 22, true), st(12, 45, "of2", 22, true, { cover: false })],
    eye: { from: -10, to: 10, h: 40, style: "ivy" },
    board: { deg: -30, back: 130, y: 132, w: 140, style: "led" },
    mow: "stripes",
    features: [
      // The center-field water feature, in front of the ivy screen so it reads from the plate.
      { k: "fountain", from: -8, to: 8, back: 6 },
      // Downtown past center: the RenCen (-3), Guardian (+18) and Penobscot (+25) buildings.
      { k: "skyline", from: -12, to: 38, dist: 2400, h: 340, n: 24, tall: [[-3, 635], [18, 525], [25, 660]] },
    ],
  }),
  // Oracle Park — brick arcade in right over McCovey Cove, the glove and the bottle in left.
  2395: L({
    seats: ["#1f4a37", "#1f4a37", "#1f4a37"],
    wall: "#1e4a36",
    facade: BRICK,
    concrete: "#a39a8c",
    trim: "#1f3d30",
    stands: [...infield("box3", -52, 54, { up: [-52, 64], taper: 80 }), st(-45, -9, "bleach", 22, true), st(18.5, 45, "porch")],
    skins: [[-45, "pad"], [18.5, "brick"]],
    eye: { from: -6, to: 9, h: 38, style: "wall" },
    board: { deg: 2, back: 130, y: 116, w: 130, style: "led" },
    mow: "checker",
    features: [
      { k: "water", from: 6, to: 100, back: 62 },
      { k: "boats", deg: 30, back: 150 },
      { k: "bottle", deg: -30, back: 116, y: 46 },
      { k: "glove", deg: -22, back: 112, y: 46 },
      // East Bay hills across the water; the Bay Bridge runs off past the left-field corner.
      { k: "mountains", from: -45, to: 45, dist: 4600, h: 150, color: "#7d8fa3" },
      { k: "bridge", deg: -66, dist: 4200, len: 2400, color: "#b7bcc2", towers: 3 },
      // SoMa and the Financial District behind third base (Salesforce Tower, Transamerica).
      { k: "skyline", from: -135, to: -90, dist: 3000, h: 360, n: 22, tall: [[-113, 1040], [-118, 540]] },
    ],
  }),
  // George M. Steinbrenner Field — spring-training scale with a Yankee Stadium frieze.
  2523: L({
    seats: [NAVY, NAVY, NAVY],
    wall: "#16294d",
    trim: "#f1efe8",
    concrete: "#cfcabb",
    facade: "#d6d0be",
    frieze: true,
    stands: [...infield("small", -62, 62), st(14, 40, "porch", 30, true), st(-40, -16, "berm", 30, true)],
    eye: { from: -9, to: 9, h: 36, style: "wall" },
    board: { deg: -24, back: 90, y: 62, w: 76, style: "led" },
    mow: "checker",
    features: [
      { k: "trees", from: -60, to: 60, back: 130, kind: "palm", n: 34 },
      { k: "trees", from: -50, to: 50, back: 260, kind: "round", n: 30 },
    ],
  }),
  // Sutter Health Park — one small deck, grass berms and the Tower Bridge.
  2529: L({
    seats: ["#1f5a3a", "#1f5a3a", "#1f5a3a"],
    concrete: "#b5b0a3",
    facade: "#bdb6a6",
    facadeStyle: "plain",
    stands: [...infield("small", -60, 60), st(-45, -12, "berm", 20, true), st(12, 45, "berm", 20, true)],
    eye: { from: -9, to: 9, h: 34, style: "wall" },
    board: { deg: -22, back: 96, y: 60, w: 76, style: "led" },
    mow: "stripes",
    features: [
      // The Sacramento River runs north-south beyond right field; Tower Bridge and downtown across it.
      { k: "water", from: 5, to: 100, back: 1000, w: 550 },
      { k: "bridge", deg: 46, dist: 1690, len: 520, color: "#d7b23c", towers: 2 },
      { k: "skyline", from: 40, to: 75, dist: 3500, h: 260, n: 16, tall: [[52, 400]] },
      { k: "trees", from: -70, to: 70, back: 150, kind: "round", n: 36 },
    ],
  }),
  // Great American Ball Park — the Gap, riverboat smokestacks, the Ohio River.
  2602: L({
    seats: ["#a5282c", "#a5282c", "#a5282c"],
    wall: "#16402f",
    concrete: "#c4c0b6",
    facade: "#d9d5ca",
    facadeStyle: "plain",
    trim: "#e9e7e0",
    stands: [st(-180, -116, "box3"), st(-110, -52, "box3", 0, false, { up: [-110, -60], taper: 60 }), st(52, 180, "box3", 0, false, { taper: 60 }), st(-45, -12, "of2", 20, true, { cover: false }), st(17, 45, "bleach", 4)],
    eye: { from: -9, to: 9, h: 40, style: "black" },
    board: { deg: -28, back: 150, y: 128, w: 136, style: "led" },
    mow: "stripes",
    features: [
      { k: "stacks", deg: 13, back: 46, y: 0 },
      // The Ohio River beyond the outfield, the Kentucky hills across it.
      { k: "water", from: -30, to: 100, back: 240 },
      { k: "mountains", from: -40, to: 90, dist: 2300, h: 150, color: "#5d7458" },
      // Roebling (blue, two towers) off right field; Taylor-Southgate past left-center; the yellow Big Mac past the LF pole.
      { k: "bridge", deg: 86, dist: 1854, len: 1000, color: "#3f6fb0", towers: 2 },
      { k: "bridge", deg: -10, dist: 1830, len: 1100, color: "#8a8f96", towers: 0 },
      { k: "bridge", deg: -47, dist: 3660, len: 1200, color: "#e9b824", towers: 0 },
      // Downtown sits behind third base and home: Great American Tower (-121), Carew Tower (-175).
      { k: "skyline", from: -178, to: -105, dist: 700, h: 300, n: 22, tall: [[-121, 830], [-175, 420]] },
    ],
  }),
  // Petco Park — sandstone, the Western Metal Supply Co. building at the left-field pole.
  2680: L({
    seats: ["#1c2f55", "#1c2f55", "#1c2f55"],
    wall: "#1c2f55",
    concrete: "#cdbd98",
    facade: "#d8c79f",
    facadeStyle: "plain",
    trim: "#efe9da",
    stands: [...infield("box3", -62, 52, { up: [-70, 58], taper: 80 }), st(-36, -12, "of2", 10, false, { cover: false }), st(12, 45, "bleach", 24, true)],
    eye: { from: -9, to: 9, h: 38, style: "wall" },
    board: { deg: -24, back: 150, y: 134, w: 130, style: "led" },
    mow: "checker",
    features: [
      { k: "building", deg: -46.5, back: 34, w: 86, d: 60, h: 82, color: "#8f4f38", trim: "#d8c9a8" },
      { k: "skyline", from: -85, to: 15, dist: 1700, h: 330, n: 30, tall: [[-40, 520], [-18, 480], [4, 450]] },
      // The Coronado Bridge behind home plate.
      { k: "bridge", deg: 168, dist: 4600, len: 2600, color: "#5d7f9e", towers: 0 },
      { k: "trees", from: -8, to: 40, back: 130, kind: "palm", n: 14 },
      { k: "mountains", from: -8, to: 12, dist: 520, h: 24, color: "#5b8a4a" },
    ],
  }),
  // Citizens Bank Park — red brick, blue seats, the Liberty Bell, Philadelphia in the distance.
  2681: L({
    seats: ["#274b8f", "#274b8f", "#274b8f"],
    wall: "#1d4634",
    facade: "#9a5744",
    concrete: "#a59c90",
    trim: "#2f3a45",
    stands: [...infield("box3", -52, 52, { up: [-52, 60], taper: 70 }), st(-45, -12, "of2", 4, false, { cover: false }), st(16, 45, "bleach", 24, true)],
    skins: [[-45, "pad"], [18, "board"]],
    foulSkin: "brick",
    eye: { from: -10, to: 10, h: 40, style: "ivy" },
    board: { deg: -28, back: 150, y: 140, w: 150, style: "led" },
    mow: "checker",
    features: [
      { k: "bell", deg: 17, back: 96, y: 96 },
      // Center City is ~3.3 miles north, just left of center: Comcast Technology Center (-12.4), the
      // Liberty towers and City Hall (-5.6). Compressed, heights scaled to true angular size.
      { k: "skyline", from: -18, to: 2, dist: 3000, h: 160, n: 18, tall: [[-12.4, 311], [-9, 270], [-7.5, 265], [-5.6, 160]] },
      { k: "trees", from: -10, to: 10, back: 48, kind: "round", n: 8 },
    ],
  }),
  // Busch Stadium — red brick and red seats, the Gateway Arch over an open center field.
  2889: L({
    seats: ["#a3262e", "#a3262e", "#a3262e"],
    wall: "#1c4733",
    concrete: "#9c8f84",
    facade: "#a7624a",
    trim: "#2d3238",
    stands: [...infield("box3", -52, 52, { taper: 70 }), st(-45, -16, "of2", 22, true, { cover: false }), st(16, 45, "of2", 22, true, { cover: false })],
    foulSkin: "brick",
    eye: { from: -10, to: 10, h: 32, style: "grass" },
    board: { deg: 27, back: 150, y: 134, w: 130, style: "led" },
    lights: "rim",
    mow: "arcs",
    features: [
      // The Gateway Arch rises beyond right-center (+8, ~2,560 ft from the plate).
      { k: "arch", deg: 8, dist: 2560, h: 630 },
      // Ballpark Village across Clark Ave behind the LF seats, One Cardinal Way's tower past left-center.
      { k: "building", deg: -39, back: 370, w: 300, d: 150, h: 70, color: "#7a4a3a", trim: "#c9b9a0" },
      { k: "building", deg: -8, back: 400, w: 130, d: 110, h: 330, color: "#8d9aa6", trim: "#c9cdd1", glass: true },
      // Downtown fills left and left-center (Metropolitan Square at -35).
      { k: "skyline", from: -70, to: 0, dist: 1500, h: 300, n: 28, tall: [[-35, 764]] },
    ],
  }),
  // Citi Field — brick arcade, dark green seats, the Home Run Apple, orange foul poles.
  3289: L({
    seats: ["#1f4a37", "#1f4a37", "#1f4a37"],
    wall: "#16305f",
    concrete: "#a39a8e",
    facade: "#a8674c",
    trim: "#2d3238",
    pole: "#f26a1b",
    stands: [...infield("box3", -52, 52, { taper: 70 }), st(-45, -12, "of2", 2, false, { cover: false }), st(13, 45, "of2", 22, true, { cover: false })],
    foulSkin: "brick",
    eye: { from: -9, to: 9, h: 36, style: "black" },
    board: { deg: -4, back: 150, y: 136, w: 150, style: "led" },
    mow: "checker",
    features: [
      // In front of the black batter's eye, where it rises after a Mets homer.
      { k: "apple", deg: 0, back: 8, y: 8 },
      // Flushing Bay past the left-field corner; Manhattan ~7-9 miles west behind third base
      // (Empire State -110, One WTC -125); downtown Flushing past right field.
      { k: "water", from: -60, to: -15, back: 2200 },
      { k: "skyline", from: -128, to: -100, dist: 3000, h: 120, n: 22, tall: [[-110, 189], [-125, 182]] },
      { k: "skyline", from: 50, to: 75, dist: 2600, h: 200, n: 14 },
    ],
  }),
  // Nationals Park — pale concrete and glass, navy and red seats, cherry blossoms in left.
  3309: L({
    seats: [NAVY, "#8f1d24", NAVY],
    wall: "#17305c",
    concrete: "#c9c5bc",
    facade: "#d5d2c9",
    facadeStyle: "glass",
    trim: "#d9d9d4",
    stands: [...infield("box3", -52, 52, { up: [-52, 60], taper: 80 }), st(-45, -13, "of2", 24, true, { cover: false }), st(13, 45, "of2", 2, false, { cover: false })],
    skins: [[-45, "pad"], [20, "board"]],
    eye: { from: -9, to: 9, h: 40, style: "grass" },
    board: { deg: 28, back: 140, y: 130, w: 140, style: "led" },
    lights: "rim",
    mow: "stripes",
    features: [
      { k: "trees", from: -44, to: -14, back: 16, kind: "cherry", n: 12 },
      // Navy Yard mid-rises ring the outfield; the Anacostia and the Douglass Bridge lie off first base.
      { k: "skyline", from: -40, to: 45, dist: 1000, h: 200, n: 30 },
      { k: "water", from: 50, to: 130, back: 1600, w: 900 },
      { k: "bridge", deg: 124, dist: 1619, len: 1200, color: "#c9c9c4", towers: 0 },
      // The Washington Monument ~1.9 miles off the third-base side; compressed, true angular size.
      { k: "needle", deg: -85, dist: 4800, h: 268 },
    ],
  }),
  // Target Field — limestone, the right-field overhang, pines in center, Minneapolis.
  3312: L({
    seats: ["#1f4c38", "#1f4c38", "#1f4c38"],
    wall: "#1b4432",
    concrete: "#c2b48f",
    facade: "#cdbd96",
    facadeStyle: "plain",
    trim: "#d9d5c8",
    stands: [...infield("box3", -52, 52, { taper: 90 }), st(-45, -12, "of2", 22, true, { cover: false }), st(20, 45, "of2", 0, false, { cover: false })],
    skins: [[-45, "pad"], [20, "board"]],
    foulSkin: "stone",
    eye: { from: -9, to: 12, h: 46, style: "black" },
    board: { deg: -26, back: 150, y: 136, w: 140, style: "led" },
    lights: "rim",
    mow: "stripes",
    features: [
      { k: "trees", from: -8, to: 10, back: 60, kind: "pine", n: 10 },
      // Downtown Minneapolis beyond center: Capella (+1), Wells Fargo Center (+3), IDS (+14).
      { k: "skyline", from: -6, to: 40, dist: 2200, h: 380, n: 24, tall: [[1, 800], [3, 935], [14, 990]] },
    ],
  }),
  // Yankee Stadium — limestone arches, four decks under the frieze, bleachers and the big board.
  3313: L({
    seats: [NAVY, NAVY, NAVY],
    wall: "#15264a",
    trim: "#f1efe8",
    concrete: "#bdb7a6",
    facade: "#d6cfba",
    canopy: "#e9e6dc",
    frieze: true,
    stands: [...infield("box4", -52, 52, { taper: 50 }), st(-45, -9, "bleach", 8, true), st(9, 45, "bleach", 8, true)],
    eye: { from: -8, to: 8, h: 44, style: "black" },
    board: { deg: 0, back: 150, y: 132, w: 150, style: "led" },
    lights: "rim",
    mow: "checker",
    features: [
      // Bronx apartment blocks; the Courthouse and the 161st St el lie off right field (+72..+74).
      { k: "skyline", from: -30, to: 140, dist: 1300, h: 200, n: 34 },
      { k: "flags", deg: 0, back: 60, y: 60 },
    ],
  }),
  // loanDepot park — white and glass, the roof parked off the first-base side, Miami through the left-field glass.
  4169: L({
    seats: ["#2a63b0", "#2a63b0", "#2a63b0"],
    wall: "#1f6fb5",
    concrete: "#dcdddb",
    facade: "#e3e4e2",
    facadeStyle: "glass",
    trim: "#e3e4e2",
    stands: [...infield("box3", -52, 52, { taper: 60 }), st(-45, -10, "porch", 20, true), st(10, 45, "of2", 22, true, { cover: false })],
    eye: { from: -9, to: 9, h: 40, style: "wall" },
    board: { deg: 26, back: 150, y: 134, w: 136, style: "led" },
    lights: "rim",
    mow: "plain",
    // The panels roll west and park beyond the first-base side.
    roof: { axis: 142, cover: 0.24, h: 250, color: "#e6e8ea" },
    features: [
      { k: "glass", from: -50, to: -6, back: 96, h: 160 },
      // Downtown and Brickell ~2 miles east through the LF glass: Freedom Tower (-44.5), Miami Tower (-26),
      // Panorama (-8.5). Compressed, heights scaled to true angular size.
      { k: "skyline", from: -50, to: 18, dist: 3000, h: 200, n: 28, tall: [[-44.5, 250], [-26, 312], [-17, 315], [-12, 360], [-8.5, 435]] },
      { k: "trees", from: -8, to: 40, back: 150, kind: "palm", n: 12 },
    ],
  }),
  // Truist Park — brick, the Chop House terraces in right, pines and a waterfall in center, The Battery.
  4705: L({
    seats: ["#1f3157", "#1f3157", "#1f3157"],
    wall: "#1c4533",
    concrete: "#a59a8e",
    facade: "#a9694c",
    trim: "#2d3238",
    stands: [...infield("box3", -52, 52, { taper: 90 }), st(-45, -12, "of2", 22, true, { cover: false }), st(14, 45, "terrace", 2)],
    skins: [[-45, "pad"], [14, "brick"]],
    foulSkin: "brick",
    eye: { from: -10, to: 10, h: 34, style: "trees" },
    board: { deg: -3, back: 130, y: 128, w: 150, style: "led" },
    lights: "rim",
    mow: "stripes",
    features: [
      { k: "rocks", deg: -2, back: 30, w: 70, water: true },
      { k: "trees", from: -10, to: 10, back: 44, kind: "pine", n: 10 },
      // The Battery past right field: Omni hotel (+16), Comcast (+33.5), the TK Elevator tower (+40);
      // office towers along the Parkway past left.
      { k: "building", deg: 16, back: 270, w: 180, d: 90, h: 180, color: "#9a6a52", trim: "#d0c2a8" },
      { k: "building", deg: 33.5, back: 420, w: 220, d: 120, h: 103, color: "#8fa3b4", trim: "#c9cdd1", glass: true },
      { k: "building", deg: 40, back: 1440, w: 80, d: 80, h: 420, color: "#b9c6d2", trim: "#d9dde0", glass: true },
      { k: "skyline", from: -36, to: -12, dist: 900, h: 300, n: 10 },
      { k: "trees", from: -60, to: 0, back: 300, kind: "round", n: 24 },
    ],
  }),
  // Globe Life Field — brick arches under the huge roof, glass end walls.
  5325: L({
    seats: ["#22493a", "#22493a", "#22493a"],
    wall: "#1c4534",
    concrete: "#a8957c",
    facade: "#b08a68",
    trim: "#3a3d42",
    stands: [...infield("box4", -52, 52), st(-45, -12, "of2", 6, false, { cover: false }), st(12, 45, "of3", 22, true, { cover: false })],
    skins: [[-45, "brick"], [-25, "pad"]],
    eye: { from: -8, to: 8, h: 40, style: "grass" },
    board: { deg: 30, back: 150, y: 150, w: 150, style: "led" },
    lights: "rim",
    mow: "plain",
    // The single roof panel rolls west, past the third-base side.
    roof: { axis: -120, cover: 0.45, h: 280, color: "#c6cbcf" },
    features: [{ k: "glass", from: -44, to: 44, back: 220, h: 210 }],
  }),
};

/** Layout for a venue; unknown venues get a generic modern park. */
export function layoutFor(venueId: number | null | undefined): ParkLayout {
  return (venueId != null ? PARK_LAYOUTS[venueId] : undefined) ?? BASE;
}
