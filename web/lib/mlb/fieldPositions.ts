/**
 * Canonical defensive / base slots in FIELD_VIEW_BOX space (-16–116).
 * Schematic placement (not Statcast shifts) aligned with spray-chart parks.
 */

export type FieldPositionCode =
  | "P"
  | "C"
  | "1B"
  | "2B"
  | "3B"
  | "SS"
  | "LF"
  | "CF"
  | "RF";

export type FieldBaseSlot = "home" | "first" | "second" | "third";

export interface FieldPoint {
  x: number;
  y: number;
}

/** Standard diamond + outfield pin locations (viewBox coords). */
export const FIELD_DEFENSE_SLOTS: Record<FieldPositionCode, FieldPoint> = {
  P: { x: 50, y: 72 },
  C: { x: 50, y: 94 },
  "1B": { x: 72, y: 68 },
  "2B": { x: 62, y: 52 },
  "3B": { x: 28, y: 68 },
  SS: { x: 38, y: 52 },
  LF: { x: 22, y: 28 },
  CF: { x: 50, y: 18 },
  RF: { x: 78, y: 28 },
};

/** Base / plate markers for runners and batter. */
export const FIELD_BASE_SLOTS: Record<FieldBaseSlot, FieldPoint> = {
  home: { x: 50, y: 88 },
  first: { x: 68, y: 70 },
  second: { x: 50, y: 52 },
  third: { x: 32, y: 70 },
};

/** Wall-distance label anchors (LF line / CF / RF line). */
export const FIELD_DISTANCE_SLOTS = {
  leftLine: { x: 12, y: 48 },
  center: { x: 50, y: 6 },
  rightLine: { x: 88, y: 48 },
} as const;

export const FIELD_POSITION_ORDER: FieldPositionCode[] = [
  "LF",
  "CF",
  "RF",
  "SS",
  "2B",
  "3B",
  "1B",
  "P",
  "C",
];
