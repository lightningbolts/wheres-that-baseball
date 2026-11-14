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
