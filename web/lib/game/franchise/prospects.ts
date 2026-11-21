/**
 * Real farm systems: every club's MLB Pipeline top-30 list (data/prospects.json) becomes the
 * prospects in its organization. Pipeline's 20–80 Overall grade is a future value, so it sets
 * the potential; how far the player still is from it comes from his level and age. Tool grades
 * shape his profile (contact vs. power, speed, glove; stuff vs. command).
 */
import prospectData from "./data/prospects.json";
import { clamp } from "./ratings";
import { generatePlayer, type GenRole } from "./generate";
import type { FRng } from "./rng";
import type { League, Player, Pos } from "./types";

export interface PipelineProspect {
  rank: number;
  id: number;
  name: string;
  pos: string;
  eta?: number;
  born?: string;
  bats?: string;
  throws?: string;
  level?: string;
  ovr?: number;
  tools: Record<string, number>;
  draft?: number | null;
}

export interface ProspectFile {
  year: number;
  source: string;
  fetched: string;
  teams: Record<string, PipelineProspect[]>;
}

export const PROSPECTS = prospectData as unknown as ProspectFile;

/** Grades below the future value, by current level (the "MLB" tag = on the parent 40-man). */
const LEVEL_GAP: Record<string, number> = { MLB: 5, AAA: 6, AA: 9, "A+": 12, A: 15, R: 18 };

const ALIAS: Record<string, string> = { speed: "run", defense: "field", hitting: "hit", curve: "curveball" };

export function tools(p: PipelineProspect): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.tools)) out[ALIAS[k] ?? k] = v;
  return out;
}

/** Baseball age (as of June 30) during `season`. */
export function seasonAge(born: string | undefined, season: number): number {
  if (!born) return 21;
  const [y, m] = born.split("-").map(Number);
  return season - y - (m > 6 ? 1 : 0);
}

export const isPitcherPos = (pos: string): boolean => /^(RHP|LHP)$/.test(pos.split("/")[0]);

/** Field position from Pipeline's label ("SS/2B" → SS; "OF" → CF/RF/LF by speed and arm). */
export function fieldPosOf(pos: string, t: Record<string, number>): Pos {
  const first = pos.split("/")[0];
  if (["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"].includes(first)) return first as Pos;
  if (first === "INF" || first === "UTIL") return (t.arm ?? 50) >= 55 ? "SS" : "2B";
  // Outfielders: the fastest play center, strong arms right, the rest left.
  if ((t.run ?? 50) >= 55 && (t.field ?? 50) >= 50) return "CF";
  return (t.arm ?? 50) >= 55 ? "RF" : "LF";
}

/** Current/potential grades (hitters' scale; generatePlayer rescales pitchers). */
export function prospectGrades(p: PipelineProspect, season: number): { age: number; ovr: number; pot: number } {
  const age = seasonAge(p.born, season);
  const fv = p.ovr ?? 40;
  // Pipeline's Overall is the expected outcome; the ceiling runs a little above it for the young.
  const pot = clamp(Math.round(fv + 2 + Math.max(0, 23 - age) * 0.8 + Math.max(0, fv - 50) * 0.15), 35, 80);
  const gap = (LEVEL_GAP[p.level ?? "R"] ?? 15) + Math.max(0, 21 - age) * 1.5;
  const ovr = clamp(Math.round(fv - gap), 22, pot);
  return { age, ovr, pot };
}

/** Style z-scores for the generator, from the tool grades. */
function styleOf(p: PipelineProspect, pitcher: boolean): number[] {
  const t = tools(p);
  const z = (g: number | undefined) => ((g ?? 50) - 50) / 10;
  if (pitcher) {
    const pitches = Object.entries(t)
      .filter(([k]) => k !== "control")
      .map(([, v]) => v)
      .sort((a, b) => b - a);
    const stuff = ((pitches[0] ?? 50) + (pitches[1] ?? 50)) / 2;
    // Starters keep a third pitch; two-pitch arms with shaky command profile as relievers.
    const depth = pitches.length >= 3 ? 0.4 : -1.2;
    return [z(stuff) * 0.9, z(t.control), depth, 0];
  }
  return [(z(t.power) - z(t.hit)) * 0.6, z(t.power), z(t.run), z(t.field) * 0.7 + z(t.arm) * 0.3];
}

/** One real prospect as a franchise player (minor leaguer unless he's already on the 40-man). */
export function prospectPlayer(rng: FRng, p: PipelineProspect, team: number, season: number): Player {
  const pitcher = isPitcherPos(p.pos);
  const t = tools(p);
  const g = prospectGrades(p, season);
  const style = styleOf(p, pitcher);
  const role: GenRole = pitcher ? (style[2] < 0 && (t.control ?? 50) < 50 ? "RP" : "SP") : "bat";
  const player = generatePlayer(rng, {
    id: p.id,
    role,
    age: g.age,
    ovr: g.ovr,
    pot: g.pot,
    team,
    pos: pitcher ? undefined : fieldPosOf(p.pos, t),
    name: p.name,
    bats: (p.bats === "L" || p.bats === "S" ? p.bats : "R") as Player["bats"],
    throws: (p.throws === "L" ? "L" : "R") as Player["throws"],
    style,
  });
  player.prospect = { rank: p.rank, year: PROSPECTS.year, fv: p.ovr ?? 40, eta: p.eta, level: p.level };
  player.rookie = true;
  player.status = "minors";
  player.on40 = false;
  return player;
}

/** Pipeline tag for a ranked prospect who is already in the league (on a 40-man roster). */
export function tagProspect(pl: Player, p: PipelineProspect): void {
  pl.prospect = { rank: p.rank, year: PROSPECTS.year, fv: p.ovr ?? 40, eta: p.eta, level: p.level };
}

/**
 * Adds a club's real top-30 to its organization. Ranked players already in the league
 * (big-league rosters, the 40-man extras) are tagged instead. Returns how many were added.
 */
export function addRealProspects(league: League, rng: FRng, team: number, file: ProspectFile = PROSPECTS): number {
  let added = 0;
  for (const p of file.teams[String(team)] ?? []) {
    const had = league.players[p.id];
    if (had) {
      tagProspect(had, p);
      continue;
    }
    const pl = prospectPlayer(rng, p, team, league.season);
    league.players[pl.id] = pl;
    added += 1;
  }
  return added;
}
