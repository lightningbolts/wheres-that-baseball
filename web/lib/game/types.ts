/** Shapes of web/data/game/rosters.json (built by ml-engine/scripts/build_game_rosters.py). */

export interface StatcastKinematics {
  x0: number;
  y0: number;
  z0: number;
  vX0: number;
  vY0: number;
  vZ0: number;
  aX: number;
  aY: number;
  aZ: number;
}

export interface ArsenalPitch {
  type: string;
  name: string;
  usage: number;
  speed: number;
  speedSd: number | null;
  spin: number | null;
  spinDir: number | null;
  ext: number | null;
  kin: StatcastKinematics;
  locSd: [number | null, number | null];
}

export interface BatRatingsRaw {
  pa: number;
  k: number | null;
  bb: number | null;
  zSwing: number | null;
  oSwing: number | null;
  zContact: number | null;
  oContact: number | null;
  foulPerContact: number | null;
  evMean: number | null;
  evP90: number | null;
  laMean: number | null;
  laSd: number | null;
  hr: number | null;
  sprayMean: number | null;
  spraySd: number | null;
}

export interface PitchRatingsRaw {
  bf?: number;
  k?: number | null;
  bb?: number | null;
  zoneRate?: number | null;
  stamina: number;
  arsenal: ArsenalPitch[];
}

export interface SavantMetrics {
  hpTo1b?: number;
  sbOpp?: number;
  sb?: number;
  cs?: number;
  /** Primary lead on steal attempts, ft. */
  sbLead?: number;
  sbRuns?: number;
  bolts?: number;
  armMax?: number;
  oaa?: number;
  frp?: number;
  oaaIn?: number;
  oaaBack?: number;
  pop2b?: number;
  exchange?: number;
  popArm?: number;
  batSpeed?: number;
  swingLength?: number;
  squaredUp?: number;
  blast?: number;
  hardSwing?: number;
  xwoba?: number;
  xba?: number;
  xslg?: number;
  woba?: number;
  barrel?: number;
  hardHit?: number;
  sweetSpot?: number;
  maxEv?: number;
  pull?: number;
  gb?: number;
  fb?: number;
  whiff?: number;
  hrs?: number;
  avg?: number;
  slg?: number;
  era?: number;
  xera?: number;
  chase?: number;
  ip?: number;
  so?: number;
  sv?: number;
}

export interface RosterPlayer {
  id: number;
  name: string;
  num: string | null;
  pos: string;
  bats: "L" | "R" | "S" | null;
  throws: "L" | "R" | null;
  heightIn: number | null;
  weight: number | null;
  age: number | null;
  zone: [number | null, number | null];
  sprint: number;
  arm: number;
  /** Skin tone "#rrggbb" sampled from the MLB headshot (ml-engine/scripts/sample_skin_tones.py), when there is one. */
  skin?: string | null;
  /** Baseball Savant leaderboards (enrich_game_rosters.py); any key may be missing. */
  sav?: SavantMetrics;
  bat?: BatRatingsRaw;
  pitch?: PitchRatingsRaw;
}

export interface RosterTeam {
  teamId: number;
  lineup: RosterPlayer[];
  bench: RosterPlayer[];
  rotation: RosterPlayer[];
  bullpen: RosterPlayer[];
}

export interface RosterFile {
  season: number;
  generatedFrom: string;
  teams: Record<string, RosterTeam>;
}

export type FieldPos = "P" | "C" | "1B" | "2B" | "3B" | "SS" | "LF" | "CF" | "RF";
export const FIELD_POSITIONS: FieldPos[] = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
