/**
 * Mid-season club changes: a player's season line lives on the player, so when he
 * changes clubs (trade, waiver claim, release) the part he played for the old club is
 * set aside as a split. Team totals then credit each club only with what was played for
 * it, and the player's own line stays whole.
 */
import type { BatLine, PitLine, Player } from "./types";

export interface Segment {
  team: number;
  bat?: BatLine;
  pit?: PitLine;
}

function minus<T extends BatLine | PitLine>(line: T | undefined, parts: Array<T | undefined>): T | undefined {
  if (!line) return undefined;
  const out = { ...line };
  for (const p of parts) if (p) for (const k of Object.keys(out) as Array<keyof T>) (out[k] as number) -= p[k] as number;
  return Object.values(out).some((v) => v !== 0) ? out : undefined;
}

/** The season split by club: earlier clubs' splits, then the current club's remainder. */
export function seasonSegments(p: Player): Segment[] {
  const prev = p.splits ?? [];
  if (!prev.length) return [{ team: p.team, bat: p.stats.bat, pit: p.stats.pit }];
  const rest: Segment = {
    team: p.team,
    bat: minus(p.stats.bat, prev.map((s) => s.bat)),
    pit: minus(p.stats.pit, prev.map((s) => s.pit)),
  };
  return [...prev, rest];
}

/** Call before changing p.team mid-season: banks what he has done for his current club. */
export function leaveTeam(p: Player): void {
  if (!p.team || (!p.stats.bat && !p.stats.pit)) return;
  const here = seasonSegments(p).at(-1)!;
  if (!here.bat && !here.pit) return;
  // Copies: the season line keeps growing in place (recordLines adds into it).
  p.splits = [...(p.splits ?? []), { team: p.team, ...(here.bat && { bat: { ...here.bat } }), ...(here.pit && { pit: { ...here.pit } }) }];
}
