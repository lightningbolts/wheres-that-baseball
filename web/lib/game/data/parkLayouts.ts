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
  | "pavilion";

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
};

export interface StandSpec {
  from: number;
  to: number;
  key: StandKey;
  /** Extra setback from the wall (ft) — leaves room for a bullpen or plaza. */
  back?: number;
  /** Bullpen in the setback gap. */
  pen?: boolean;
}

export type Feature =
  | { k: "skyline"; from: number; to: number; dist: number; h: number; n: number; tall?: Array<[number, number]> }
  | { k: "mountains"; from: number; to: number; dist: number; h: number; color: string; snow?: boolean }
  | { k: "water"; from: number; to: number; back: number }
  | { k: "bridge"; deg: number; dist: number; len: number; color: string; towers: number }
  | { k: "arch"; deg: number; dist: number; h: number }
  | { k: "needle"; deg: number; dist: number; h: number }
  | { k: "building"; deg: number; back: number; w: number; d: number; h: number; color: string; trim?: string }
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
}

export interface ParkLayout {
  /** Seat colors: lower bowl, club level, upper deck. */
  seats: [string, string, string];
  /** Outfield wall padding tint. */
  wall: string;
  /** Fascia / canopy color. */
  trim: string;
  concrete: string;
  /** Outfield wall skins as `[fromDeg, skin]` steps (like wall heights). */
  skins: Array<[number, WallSkin]>;
  foulSkin: WallSkin;
  stands: StandSpec[];
  /** Batter's eye: bearing range, height, look. */
  eye: { from: number; to: number; h: number; style: "wall" | "grass" | "trees" | "ivy" };
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
const st = (from: number, to: number, key: StandKey, back?: number, pen?: boolean): StandSpec => ({ from, to, key, back, pen });
/** Symmetric infield grandstand from the left pole around the plate to the right pole. */
const infield = (key: StandKey, left = -52, right = 52): StandSpec[] => [st(-180, left, key), st(right, 180, key)];

const BASE: ParkLayout = {
  seats: [GREEN, "#274f6b", GREEN],
  wall: "#1d4a36",
  trim: "#2b3138",
  concrete: "#8f9296",
  skins: [[-45, "pad"]],
  foulSkin: "pad",
  stands: [...infield("box3"), st(-45, -9, "of2", 26, true), st(9, 45, "bleach", 26, true)],
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
  // Angel Stadium — rock pile and geysers in left-center, the Big A beyond.
  1: L({
    seats: ["#1f5a3c", "#7b2a2a", "#1f5a3c"],
    stands: [...infield("box3", -58, 58), st(-45, -22, "bleach", 22, true), st(12, 45, "of2")],
    skins: [[-45, "pad"], [22, "board"]],
    eye: { from: -8, to: 8, h: 36, style: "grass" },
    board: { deg: 28, back: 170, y: 122, w: 120, style: "led" },
    lights: "rim",
    mow: "arcs",
    features: [
      { k: "rocks", deg: -14, back: 34, w: 90, water: true },
      { k: "trees", from: -20, to: -6, back: 80, kind: "pine", n: 9 },
      { k: "bigA", deg: -4, back: 520 },
      { k: "mountains", from: -60, to: 50, dist: 2600, h: 260, color: "#8c9cb3" },
      { k: "trees", from: -50, to: 50, back: 320, kind: "palm", n: 22 },
    ],
  }),
  // Camden Yards — the B&O Warehouse looms over right field.
  2: L({
    seats: ["#1d4a37", "#1d4a37", "#1d4a37"],
    stands: [...infield("box3", -54, 60), st(-45, -12, "of2"), st(-11, -4, "bleach", 26, true), st(14, 45, "porch")],
    skins: [[-45, "pad"], [22, "board"]],
    foulSkin: "brick",
    eye: { from: -4, to: 9, h: 40, style: "ivy" },
    board: { deg: 3, back: 120, y: 112, w: 110, style: "led" },
    features: [
      { k: "building", deg: 30, back: 105, w: 760, d: 52, h: 96, color: "#8a4a36", trim: "#c8b89a" },
      { k: "skyline", from: -35, to: 10, dist: 1500, h: 240, n: 20, tall: [[-12, 420], [-3, 360]] },
      { k: "flags", deg: 30, back: 34 },
    ],
  }),
  // Fenway Park — Green Monster, the Triangle, Pesky's Pole.
  3: L({
    seats: ["#a3312d", "#a3312d", "#2c5a44"],
    wall: "#2c5f47",
    trim: "#2c5a44",
    stands: [...infield("classic", -50, 50), st(-45, -10, "monster"), st(-8, 11, "bleach", 8), st(13, 43, "bleachTall", 24, true)],
    skins: [[-45, "monster"], [-9.5, "pad"]],
    eye: { from: -6, to: 6, h: 30, style: "wall" },
    board: { deg: 2, back: 140, y: 104, w: 116, style: "led" },
    mow: "checker",
    features: [
      { k: "triSign", deg: -27, back: 330, y: 150 },
      { k: "skyline", from: 5, to: 60, dist: 1900, h: 230, n: 22, tall: [[28, 620], [36, 480]] },
      { k: "building", deg: -24, back: 150, w: 420, d: 60, h: 62, color: "#8d5a44", trim: "#cdbfa6" },
    ],
  }),
  // Rate Field — exploding scoreboard with pinwheels.
  4: L({
    seats: ["#20503a", "#20503a", "#20503a"],
    wall: "#1e4a35",
    stands: [...infield("box3"), st(-45, -9, "bleach", 24, true), st(9, 45, "bleach", 24, true)],
    eye: { from: -8, to: 8, h: 44, style: "ivy" },
    board: { deg: 0, back: 120, y: 118, w: 132, style: "led" },
    mow: "stripes",
    features: [
      { k: "pinwheels", deg: 0, back: 122, y: 150 },
      { k: "skyline", from: -70, to: -20, dist: 2800, h: 420, n: 24, tall: [[-48, 900]] },
    ],
  }),
  // Progressive Field — 19 ft left-field wall, toothbrush light towers, downtown beyond.
  5: L({
    stands: [...infield("box3"), st(-45, -13, "bleachTall", 4), st(13, 45, "of2", 22, true)],
    eye: { from: -11, to: 11, h: 38, style: "trees" },
    board: { deg: -28, back: 135, y: 150, w: 140, style: "led" },
    lights: "brush",
    features: [
      { k: "trees", from: -11, to: 11, back: 46, kind: "round", n: 12 },
      { k: "skyline", from: -40, to: 25, dist: 1300, h: 300, n: 24, tall: [[-22, 800], [-10, 650], [4, 560]] },
    ],
  }),
  // Kauffman Stadium — fountains and the crown scoreboard, open outfield.
  7: L({
    seats: ["#1d4c8f", "#1d4c8f", "#1d4c8f"],
    wall: "#1f4f3a",
    stands: [...infield("box3", -60, 60), st(-45, -24, "porch", 46), st(24, 45, "porch", 46)],
    eye: { from: -9, to: 9, h: 30, style: "grass" },
    board: { deg: 0, back: 150, y: 96, w: 84, style: "led" },
    lights: "rim",
    mow: "arcs",
    features: [
      { k: "fountain", from: 9, to: 40, back: 16 },
      { k: "fountain", from: -30, to: -11, back: 16 },
      { k: "crown", deg: 0, back: 152, y: 140 },
      { k: "mountains", from: -80, to: 80, dist: 2200, h: 70, color: "#4f6b4a" },
      { k: "trees", from: -50, to: 50, back: 260, kind: "round", n: 30 },
    ],
  }),
  // Rogers Centre — the dome's stacked roof and the CN Tower.
  14: L({
    seats: ["#1f4f9a", "#1f4f9a", "#1f4f9a"],
    wall: "#1a3f7a",
    concrete: "#9a9da1",
    stands: [...infield("box4"), st(-45, -8, "of3", 24, true), st(8, 45, "of3", 24, true)],
    eye: { from: -8, to: 8, h: 40, style: "wall" },
    board: { deg: 0, back: 130, y: 120, w: 140, style: "led" },
    lights: "rim",
    mow: "plain",
    roof: { axis: 0, cover: 0.34, h: 250, color: "#d9dde2" },
    features: [
      { k: "needle", deg: 70, dist: 720, h: 1500 },
      { k: "skyline", from: 20, to: 110, dist: 1500, h: 520, n: 22 },
    ],
  }),
  // Chase Field — pool in right-center, giant panels beyond the outfield.
  15: L({
    seats: ["#215240", "#7a2a2e", "#215240"],
    wall: "#1f4c39",
    stands: [...infield("box4"), st(-45, -7, "bleach", 22, true), st(7, 19, "bleach", 22), st(31, 45, "bleach", 22, true)],
    skins: [[-45, "pad"]],
    eye: { from: -5, to: 5, h: 60, style: "wall" },
    board: { deg: 0, back: 120, y: 132, w: 150, style: "led" },
    lights: "rim",
    mow: "stripes",
    roof: { axis: 90, cover: 0.3, h: 250, color: "#cfd3d6" },
    features: [
      { k: "pool", deg: 25, back: 18 },
      { k: "glass", from: -42, to: 42, back: 190, h: 170 },
    ],
  }),
  // Wrigley Field — ivy on brick, bleachers, rooftops across the street.
  17: L({
    seats: ["#1e4d37", "#1e4d37", "#1e4d37"],
    wall: "#2f6b3a",
    trim: "#24503c",
    stands: [...infield("classic", -50, 50), st(-45, -7, "bleach", 3), st(7, 45, "bleach", 3)],
    skins: [[-45, "ivy"]],
    foulSkin: "brick",
    eye: { from: -7, to: 7, h: 34, style: "ivy" },
    board: { deg: 0, back: 78, y: 96, w: 76, style: "green" },
    lights: "rim",
    mow: "checker",
    features: [
      { k: "rowhouses", from: -44, to: 44, back: 150 },
      { k: "skyline", from: 20, to: 75, dist: 2900, h: 380, n: 18, tall: [[52, 820]] },
      { k: "flags", deg: 0, back: 80, y: 124 },
    ],
  }),
  // Coors Field — pines, rocks and fountains in center, the Rockpile, the Rockies.
  19: L({
    seats: ["#1f5a3a", "#1f5a3a", "#1f5a3a"],
    stands: [...infield("box3"), st(-45, -12, "bleach", 24, true), st(-3, 12, "rockpile"), st(15, 45, "of2", 4)],
    skins: [[-45, "pad"], [20, "board"]],
    eye: { from: -11, to: 11, h: 26, style: "trees" },
    board: { deg: -27, back: 140, y: 128, w: 124, style: "led" },
    mow: "checker",
    purpleRow: true,
    features: [
      { k: "rocks", deg: 0, back: 30, w: 120, water: true },
      { k: "trees", from: -11, to: 11, back: 40, kind: "pine", n: 16 },
      { k: "mountains", from: -100, to: 40, dist: 2600, h: 560, color: "#6f7fa0", snow: true },
      { k: "skyline", from: 30, to: 80, dist: 1700, h: 300, n: 16 },
    ],
  }),
  // Dodger Stadium — pastel decks, wavy-roofed pavilions, palms and the San Gabriels.
  22: L({
    seats: ["#e3bd4a", "#de9146", "#69a9d6"],
    wall: "#1c4e96",
    trim: "#e9e6dc",
    concrete: "#b9b4a6",
    stands: [...infield("box4", -58, 58), st(-42, -11, "pavilion", 24, true), st(11, 42, "pavilion", 24, true)],
    eye: { from: -10, to: 10, h: 34, style: "wall" },
    board: { deg: -26, back: 118, y: 96, w: 84, style: "hex" },
    lights: "tower",
    mow: "arcs",
    features: [
      { k: "trees", from: -44, to: 44, back: 150, kind: "palm", n: 30 },
      { k: "mountains", from: -70, to: 70, dist: 2400, h: 420, color: "#8c8fa6" },
      { k: "mountains", from: -70, to: 70, dist: 900, h: 110, color: "#6b7a55" },
    ],
  }),
  // PNC Park — Clemente Wall, the Allegheny, the bridge and downtown.
  31: L({
    seats: ["#1d3157", "#1d3157", "#1d3157"],
    wall: "#1e4d38",
    concrete: "#c9b88f",
    stands: [...infield("box2", -54, 60), st(-45, -16, "bleach", 22, true), st(9, 45, "porch")],
    skins: [[-45, "pad"], [8, "board"]],
    eye: { from: -12, to: 6, h: 30, style: "trees" },
    board: { deg: -30, back: 130, y: 116, w: 110, style: "led" },
    lights: "brush",
    mow: "checker",
    features: [
      { k: "water", from: -12, to: 70, back: 150 },
      { k: "bridge", deg: 6, dist: 900, len: 900, color: "#e9b824", towers: 2 },
      { k: "skyline", from: -25, to: 45, dist: 1500, h: 360, n: 26, tall: [[-8, 840], [8, 720], [20, 620], [30, 560]] },
      { k: "trees", from: -12, to: 6, back: 44, kind: "round", n: 8 },
    ],
  }),
  // American Family Field — fan-shaped roof, Bernie's slide.
  32: L({
    seats: ["#1f4f39", "#1f4f39", "#1f4f39"],
    wall: "#1c3f6e",
    stands: [...infield("box4"), st(-45, -9, "of2", 22, true), st(9, 45, "of2", 22, true)],
    eye: { from: -8, to: 8, h: 44, style: "wall" },
    board: { deg: 0, back: 130, y: 140, w: 150, style: "led" },
    lights: "rim",
    mow: "arcs",
    roof: { axis: 90, cover: 0.26, h: 270, color: "#c9ced3" },
    features: [
      { k: "slide", deg: -30, back: 150, y: 110 },
      { k: "glass", from: -44, to: 44, back: 200, h: 200 },
    ],
  }),
  // T-Mobile Park — the roof parks beyond right field; Seattle past left.
  680: L({
    seats: ["#1f4d3a", "#1f4d3a", "#1f4d3a"],
    wall: "#1d4636",
    stands: [...infield("box3"), st(-45, -11, "bleach", 24, true), st(11, 45, "of2", 6)],
    eye: { from: -8, to: 8, h: 40, style: "wall" },
    board: { deg: 12, back: 150, y: 130, w: 140, style: "led" },
    lights: "rim",
    mow: "stripes",
    roof: { axis: 45, cover: 0.42, h: 240, color: "#a9b1b5" },
    features: [{ k: "skyline", from: -95, to: -15, dist: 1900, h: 420, n: 28, tall: [[-62, 900], [-50, 760], [-40, 640]] }],
  }),
  // Daikin Park — Crawford Boxes, the arches and the train.
  2392: L({
    seats: ["#1f4b38", "#1f4b38", "#1f4b38"],
    wall: "#1d4634",
    concrete: "#b9a98c",
    stands: [...infield("box3"), st(-45, -19, "bleach", 1), st(12, 45, "of2", 22, true)],
    skins: [[-45, "board"], [-12, "pad"]],
    eye: { from: -8, to: 8, h: 40, style: "wall" },
    board: { deg: 28, back: 150, y: 138, w: 130, style: "led" },
    lights: "rim",
    mow: "checker",
    roof: { axis: 60, cover: 0.36, h: 250, color: "#c2c7c9" },
    features: [
      { k: "train", deg: -24, back: 96, y: 74 },
      { k: "glass", from: -48, to: -6, back: 130, h: 190 },
      { k: "skyline", from: -45, to: -5, dist: 1400, h: 520, n: 16, tall: [[-30, 880]] },
      { k: "trees", from: -8, to: 8, back: 50, kind: "round", n: 6 },
    ],
  }),
  // Comerica Park — center-field fountain, Detroit skyline.
  2394: L({
    seats: ["#1f4d39", "#1f4d39", "#1f4d39"],
    stands: [...infield("box2"), st(-45, -14, "bleach", 22, true), st(12, 45, "of2", 22, true)],
    eye: { from: -10, to: 10, h: 40, style: "ivy" },
    board: { deg: -30, back: 130, y: 132, w: 140, style: "led" },
    mow: "stripes",
    features: [
      { k: "fountain", from: -7, to: 7, back: 52 },
      { k: "skyline", from: -20, to: 50, dist: 1400, h: 320, n: 26, tall: [[8, 720], [22, 560], [34, 600]] },
    ],
  }),
  // Oracle Park — brick arcade in right, McCovey Cove, the glove and the bottle.
  2395: L({
    seats: ["#1f4a37", "#1f4a37", "#1f4a37"],
    wall: "#1e4a36",
    stands: [st(-180, -52, "box3"), st(54, 180, "box3"), st(-45, -9, "bleach", 22, true), st(18.5, 45, "porch")],
    skins: [[-45, "pad"], [18.5, "brick"]],
    eye: { from: -6, to: 9, h: 38, style: "wall" },
    board: { deg: 2, back: 130, y: 116, w: 130, style: "led" },
    mow: "checker",
    features: [
      { k: "water", from: 6, to: 100, back: 62 },
      { k: "boats", deg: 30, back: 150 },
      { k: "bottle", deg: -30, back: 116, y: 46 },
      { k: "glove", deg: -22, back: 112, y: 46 },
      { k: "mountains", from: -30, to: 110, dist: 2800, h: 120, color: "#7d8fa3" },
      { k: "bridge", deg: -18, dist: 2300, len: 1500, color: "#b7bcc2", towers: 3 },
    ],
  }),
  // George M. Steinbrenner Field — spring-training scale with a Yankee Stadium frieze.
  2523: L({
    seats: [NAVY, NAVY, NAVY],
    wall: "#16294d",
    trim: "#f1efe8",
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
  // Sutter Health Park — grass berms and the Tower Bridge.
  2529: L({
    seats: ["#1f5a3a", "#1f5a3a", "#1f5a3a"],
    stands: [...infield("small", -60, 60), st(-45, -12, "berm", 20, true), st(12, 45, "berm", 20, true)],
    eye: { from: -9, to: 9, h: 34, style: "wall" },
    board: { deg: -22, back: 96, y: 60, w: 76, style: "led" },
    mow: "stripes",
    features: [
      { k: "water", from: -10, to: 70, back: 420 },
      { k: "bridge", deg: 22, dist: 900, len: 520, color: "#d7b23c", towers: 4 },
      { k: "skyline", from: 0, to: 60, dist: 1900, h: 300, n: 16, tall: [[30, 520]] },
      { k: "trees", from: -70, to: 70, back: 150, kind: "round", n: 36 },
    ],
  }),
  // Great American Ball Park — riverboat smokestacks, the Ohio River.
  2602: L({
    seats: ["#a5282c", "#a5282c", "#a5282c"],
    wall: "#16402f",
    stands: [st(-180, -116, "box3"), st(-110, -52, "box3"), st(52, 180, "box3"), st(-45, -12, "of2", 20, true), st(17, 45, "bleach", 4)],
    eye: { from: -9, to: 9, h: 40, style: "wall" },
    board: { deg: -28, back: 150, y: 128, w: 136, style: "led" },
    mow: "stripes",
    features: [
      { k: "stacks", deg: 13, back: 46, y: 0 },
      { k: "water", from: -20, to: 80, back: 240 },
      { k: "mountains", from: -40, to: 90, dist: 2300, h: 150, color: "#5d7458" },
      { k: "bridge", deg: 48, dist: 1500, len: 1000, color: "#3f6fb0", towers: 2 },
    ],
  }),
  // Petco Park — Western Metal Supply Co. building at the left-field pole.
  2680: L({
    seats: ["#1c2f55", "#1c2f55", "#1c2f55"],
    wall: "#1c2f55",
    concrete: "#d2c19a",
    trim: "#efe9da",
    stands: [...infield("box3", -62, 52), st(-36, -12, "of2", 10), st(12, 45, "bleach", 24, true)],
    eye: { from: -9, to: 9, h: 38, style: "wall" },
    board: { deg: -24, back: 150, y: 134, w: 130, style: "led" },
    mow: "checker",
    features: [
      { k: "building", deg: -46.5, back: 34, w: 86, d: 60, h: 82, color: "#8f4f38", trim: "#d8c9a8" },
      { k: "skyline", from: -70, to: 25, dist: 1100, h: 330, n: 30, tall: [[-40, 520], [-18, 480], [4, 450]] },
      { k: "trees", from: -8, to: 40, back: 130, kind: "palm", n: 14 },
      { k: "mountains", from: -8, to: 12, dist: 520, h: 24, color: "#5b8a4a" },
    ],
  }),
  // Citizens Bank Park — the Liberty Bell, Philadelphia in the distance.
  2681: L({
    seats: ["#274b8f", "#274b8f", "#274b8f"],
    wall: "#1d4634",
    stands: [...infield("box3"), st(-45, -12, "of2", 4), st(16, 45, "bleach", 24, true)],
    skins: [[-45, "pad"], [18, "board"]],
    foulSkin: "brick",
    eye: { from: -10, to: 10, h: 40, style: "ivy" },
    board: { deg: -28, back: 150, y: 140, w: 150, style: "led" },
    mow: "checker",
    features: [
      { k: "bell", deg: 24, back: 140, y: 118 },
      { k: "skyline", from: -22, to: 14, dist: 3000, h: 520, n: 18, tall: [[-6, 1000], [2, 900]] },
      { k: "trees", from: -10, to: 10, back: 48, kind: "round", n: 8 },
    ],
  }),
  // Busch Stadium — the Gateway Arch over center field.
  2889: L({
    seats: ["#a3262e", "#a3262e", "#a3262e"],
    wall: "#1c4733",
    concrete: "#a7624a",
    stands: [...infield("box3"), st(-45, -14, "of2", 22, true), st(14, 45, "of2", 22, true)],
    foulSkin: "brick",
    eye: { from: -10, to: 10, h: 32, style: "grass" },
    board: { deg: 27, back: 150, y: 134, w: 130, style: "led" },
    lights: "rim",
    mow: "arcs",
    features: [
      { k: "arch", deg: -3, dist: 1900, h: 630 },
      { k: "skyline", from: -40, to: 32, dist: 1400, h: 300, n: 30, tall: [[-24, 580], [10, 540], [20, 480]] },
    ],
  }),
  // Citi Field — the Home Run Apple, orange foul poles.
  3289: L({
    seats: ["#1f4a37", "#1f4a37", "#1f4a37"],
    wall: "#16305f",
    concrete: "#a8674c",
    pole: "#f26a1b",
    stands: [...infield("box3"), st(-45, -12, "of2", 2), st(13, 45, "of2", 22, true)],
    foulSkin: "brick",
    eye: { from: -9, to: 9, h: 36, style: "wall" },
    board: { deg: -4, back: 150, y: 136, w: 150, style: "led" },
    mow: "checker",
    features: [
      { k: "apple", deg: 0, back: 26, y: 8 },
      { k: "bridge", deg: 30, dist: 260, len: 150, color: "#3d4046", towers: 0 },
      { k: "skyline", from: -60, to: 30, dist: 2700, h: 300, n: 20 },
    ],
  }),
  // Nationals Park — cherry blossoms beyond left.
  3309: L({
    seats: [NAVY, "#8f1d24", NAVY],
    wall: "#17305c",
    concrete: "#c9c5bc",
    stands: [...infield("box3"), st(-45, -13, "of2", 24, true), st(13, 45, "of2", 2)],
    skins: [[-45, "pad"], [20, "board"]],
    eye: { from: -9, to: 9, h: 40, style: "grass" },
    board: { deg: 28, back: 140, y: 130, w: 140, style: "led" },
    lights: "rim",
    mow: "stripes",
    features: [
      { k: "trees", from: -44, to: -14, back: 16, kind: "cherry", n: 12 },
      { k: "skyline", from: -50, to: 50, dist: 1600, h: 150, n: 30 },
      { k: "needle", deg: -86, dist: 2600, h: 555 },
    ],
  }),
  // Target Field — limestone, the right-field overhang, Minneapolis.
  3312: L({
    seats: ["#1f4c38", "#1f4c38", "#1f4c38"],
    wall: "#1b4432",
    concrete: "#cdbd96",
    stands: [...infield("box3"), st(-45, -12, "of2", 22, true), st(20, 45, "of2", 0)],
    skins: [[-45, "pad"], [20, "board"]],
    foulSkin: "stone",
    eye: { from: -9, to: 12, h: 46, style: "wall" },
    board: { deg: -26, back: 150, y: 136, w: 140, style: "led" },
    lights: "rim",
    mow: "stripes",
    features: [
      { k: "trees", from: -8, to: 10, back: 60, kind: "pine", n: 10 },
      { k: "skyline", from: 5, to: 75, dist: 1000, h: 380, n: 26, tall: [[26, 780], [38, 700], [50, 640]] },
    ],
  }),
  // Yankee Stadium — the frieze, the short porch, Monument Park.
  3313: L({
    seats: [NAVY, NAVY, NAVY],
    wall: "#15264a",
    trim: "#f1efe8",
    concrete: "#cfcabb",
    frieze: true,
    stands: [st(-180, -52, "box4"), st(52, 180, "box4"), st(-45, -9, "of2", 6), st(9, 45, "of2", 6)],
    eye: { from: -8, to: 8, h: 44, style: "wall" },
    board: { deg: 0, back: 150, y: 132, w: 150, style: "led" },
    lights: "rim",
    mow: "checker",
    features: [
      { k: "skyline", from: -60, to: 60, dist: 1300, h: 200, n: 30 },
      { k: "flags", deg: 0, back: 60, y: 60 },
    ],
  }),
  // loanDepot park — glass wall with the Miami skyline in left.
  4169: L({
    seats: ["#2a63b0", "#2a63b0", "#2a63b0"],
    wall: "#1f6fb5",
    concrete: "#e3e4e2",
    trim: "#e3e4e2",
    stands: [...infield("box3"), st(-45, -10, "porch", 20, true), st(10, 45, "of2", 22, true)],
    eye: { from: -9, to: 9, h: 40, style: "wall" },
    board: { deg: 26, back: 150, y: 134, w: 136, style: "led" },
    lights: "rim",
    mow: "plain",
    roof: { axis: 90, cover: 0.34, h: 250, color: "#e6e8ea" },
    features: [
      { k: "glass", from: -50, to: -6, back: 96, h: 160 },
      { k: "skyline", from: -60, to: 0, dist: 1500, h: 480, n: 26, tall: [[-40, 760], [-28, 820], [-16, 700]] },
      { k: "trees", from: -8, to: 40, back: 150, kind: "palm", n: 12 },
    ],
  }),
  // Truist Park — brick in right, the Chop House, The Battery.
  4705: L({
    seats: ["#1f3157", "#1f3157", "#1f3157"],
    wall: "#1c4533",
    concrete: "#a9694c",
    stands: [...infield("box3"), st(-45, -12, "of2", 22, true), st(14, 45, "of2", 2)],
    skins: [[-45, "pad"], [14, "brick"]],
    foulSkin: "brick",
    eye: { from: -10, to: 10, h: 34, style: "trees" },
    board: { deg: -3, back: 130, y: 128, w: 150, style: "led" },
    lights: "rim",
    mow: "stripes",
    features: [
      { k: "rocks", deg: -2, back: 30, w: 70, water: true },
      { k: "trees", from: -10, to: 10, back: 44, kind: "pine", n: 10 },
      { k: "skyline", from: 10, to: 80, dist: 760, h: 240, n: 16 },
      { k: "trees", from: -60, to: 0, back: 300, kind: "round", n: 24 },
    ],
  }),
  // Globe Life Field — the big roof and brick arches in left.
  5325: L({
    seats: ["#22493a", "#22493a", "#22493a"],
    wall: "#1c4534",
    concrete: "#b08a68",
    stands: [...infield("box4"), st(-45, -12, "of2", 6), st(12, 45, "of3", 22, true)],
    skins: [[-45, "brick"], [-25, "pad"]],
    eye: { from: -8, to: 8, h: 40, style: "grass" },
    board: { deg: 30, back: 150, y: 150, w: 150, style: "led" },
    lights: "rim",
    mow: "plain",
    roof: { axis: 100, cover: 0.36, h: 280, color: "#bfc4c8" },
    features: [{ k: "glass", from: -44, to: 44, back: 220, h: 210 }],
  }),
};

/** Layout for a venue; unknown venues get a generic modern park. */
export function layoutFor(venueId: number | null | undefined): ParkLayout {
  return (venueId != null ? PARK_LAYOUTS[venueId] : undefined) ?? BASE;
}
