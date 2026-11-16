/**
 * Roster management: 26-man active roster, 40-man roster, minors, injured list,
 * depth chart (lineup / rotation / bullpen roles) and transactions
 * (call-up, option, DFA + waivers, release, IL activation).
 */
import { batRuns600, defAt, eligible, isPosPlayer, slotValue } from "./ratings";
import { projectedWar } from "./contracts";
import { FIELD_SPOTS, type League, type LineupPos, type LineupSlot, type Player, type TeamState } from "./types";

export const ACTIVE_MAX = 26;
export const FORTY_MAX = 40;
export const PITCHER_MAX = 13;

export const isHealthy = (p: Player): boolean => !p.injury || p.injury.days <= 0;

export function orgPlayers(league: League, teamId: number): Player[] {
  const out: Player[] = [];
  for (const p of Object.values(league.players)) if (p.team === teamId && p.status !== "fa" && p.status !== "retired") out.push(p);
  return out;
}

export const activePlayers = (league: League, teamId: number): Player[] => orgPlayers(league, teamId).filter((p) => p.status === "active");

/** Counts against the 40-man (60-day IL players do not). */
export const counts40 = (p: Player): boolean => p.on40 && !(p.status === "il" && p.injury?.il === 60);

export const fortyMan = (league: League, teamId: number): Player[] => orgPlayers(league, teamId).filter(counts40);

export function news(league: League, text: string, team?: number, kind: League["news"][number]["kind"] = "roster"): void {
  league.news.push({ day: league.day, text, team, kind });
  if (league.news.length > 400) league.news.splice(0, league.news.length - 400);
}

/** Simple keep/cut value for roster decisions. */
export const rosterValue = (p: Player): number => p.ovr + Math.max(0, p.pot - p.ovr) * (p.age <= 25 ? 0.35 : 0.1) + (isHealthy(p) ? 0 : -6);

const name = (league: League, id: number) => league.players[id]?.name ?? `#${id}`;

// ---------------------------------------------------------------------------
// Depth chart

export function bestLineup(hitters: Player[]): LineupSlot[] {
  const pool = [...hitters];
  const slots: LineupSlot[] = [];
  const order: LineupPos[] = ["C", "SS", "CF", "2B", "3B", "RF", "LF", "1B"];
  for (const pos of order) {
    let best: Player | null = null;
    let bv = -Infinity;
    for (const p of pool) {
      const v = defAt(p, pos) == null ? (p.bat ? batRuns600(p.bat) - 25 : -999) : slotValue(p, pos);
      if (v > bv) {
        bv = v;
        best = p;
      }
    }
    if (!best) break;
    slots.push({ id: best.id, pos });
    pool.splice(pool.indexOf(best), 1);
  }
  const dh = pool.filter((p) => p.bat).sort((a, b) => batRuns600(b.bat!) - batRuns600(a.bat!))[0];
  if (dh) slots.push({ id: dh.id, pos: "DH" });
  return battingOrder(slots, hitters);
}

/** Classic order: on-base leadoff, best hitters 2–4, then descending. */
export function battingOrder(slots: LineupSlot[], players: Player[]): LineupSlot[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const val = (s: LineupSlot) => (byId.get(s.id)?.bat ? batRuns600(byId.get(s.id)!.bat!) : -99);
  const obp = (s: LineupSlot) => {
    const b = byId.get(s.id)?.bat;
    return b ? b.bb + (1 - b.k - b.bb) * b.babip + b.spd * 0.002 : 0;
  };
  const sorted = [...slots].sort((a, b) => val(b) - val(a));
  const top4 = sorted.slice(0, 4);
  const lead = top4.reduce((a, b) => (obp(b) > obp(a) ? b : a), top4[0]);
  const rest = sorted.filter((s) => s !== lead);
  return lead ? [lead, ...rest] : sorted;
}

export function autoDepth(league: League, teamId: number): void {
  const t = league.teams[teamId];
  const act = activePlayers(league, teamId).filter(isHealthy);
  const hitters = act.filter(isPosPlayer);
  t.lineup = bestLineup(hitters);
  const pitchers = act.filter((p) => p.pitcher && p.pit);
  const starters = [...pitchers].sort((a, b) => starterScore(b) - starterScore(a));
  t.rotation = starters.slice(0, 5).map((p) => p.id);
  const pen = pitchers.filter((p) => !t.rotation.includes(p.id)).sort((a, b) => b.ovr - a.ovr);
  t.closer = pen[0]?.id ?? null;
  t.setup = pen.slice(1, 3).map((p) => p.id);
  t.rotIdx = t.rotIdx % Math.max(1, t.rotation.length);
}

const starterScore = (p: Player) => (p.pos === "SP" ? 100 : 0) + (p.pit?.stam ?? 0) * 0.3 + p.ovr;

/** Keep the user's choices where still valid; fill holes with the best available. */
export function repairDepth(league: League, teamId: number): void {
  const t = league.teams[teamId];
  const ok = (id: number) => {
    const p = league.players[id];
    return !!p && p.team === teamId && p.status === "active" && isHealthy(p);
  };
  const act = activePlayers(league, teamId).filter(isHealthy);
  // Lineup.
  const keep = t.lineup.filter((s) => ok(s.id) && isPosPlayer(league.players[s.id]));
  if (keep.length < 9 || new Set(keep.map((s) => s.pos)).size < keep.length) {
    const used = new Set(keep.map((s) => s.id));
    const missing = FIELD_SPOTS.filter((pos) => !keep.some((s) => s.pos === pos));
    const pool = act.filter((p) => isPosPlayer(p) && !used.has(p.id));
    const fixed = [...keep];
    for (const pos of missing) {
      let best: Player | null = null;
      let bv = -Infinity;
      for (const p of pool) {
        const v = pos === "DH" ? batRuns600(p.bat!) : defAt(p, pos) == null ? batRuns600(p.bat!) - 25 : slotValue(p, pos);
        if (v > bv) {
          bv = v;
          best = p;
        }
      }
      if (!best) continue;
      pool.splice(pool.indexOf(best), 1);
      // Fill the hole in the same batting-order spot the departed player held.
      const idx = t.lineup.findIndex((s) => s.pos === pos);
      const slot = { id: best.id, pos };
      if (idx >= 0 && idx <= fixed.length) fixed.splice(Math.min(idx, fixed.length), 0, slot);
      else fixed.push(slot);
    }
    t.lineup = fixed.length >= 9 ? fixed.slice(0, 9) : bestLineup(act.filter(isPosPlayer));
  }
  // Rotation.
  const rot = t.rotation.filter((id) => ok(id) && league.players[id].pitcher);
  if (rot.length < 5) {
    const cands = act
      .filter((p) => p.pitcher && !rot.includes(p.id) && p.id !== t.closer && !t.setup.includes(p.id))
      .sort((a, b) => starterScore(b) - starterScore(a));
    while (rot.length < 5 && cands.length) rot.push(cands.shift()!.id);
  }
  t.rotation = rot;
  if (t.rotIdx >= rot.length) t.rotIdx = 0;
  const pen = act.filter((p) => p.pitcher && !rot.includes(p.id)).sort((a, b) => b.ovr - a.ovr);
  if (t.closer == null || !ok(t.closer) || rot.includes(t.closer)) t.closer = pen[0]?.id ?? null;
  t.setup = t.setup.filter((id) => ok(id) && id !== t.closer && !rot.includes(id));
  for (const p of pen) {
    if (t.setup.length >= 2) break;
    if (p.id !== t.closer && !t.setup.includes(p.id)) t.setup.push(p.id);
  }
}

// ---------------------------------------------------------------------------
// Transactions

export type TxResult = { ok: true; msg: string } | { ok: false; msg: string };

export function callUp(league: League, id: number, opts: { force?: boolean } = {}): TxResult {
  const p = league.players[id];
  if (!p || p.status !== "minors") return { ok: false, msg: "Only minor leaguers can be called up." };
  if (!isHealthy(p)) return { ok: false, msg: `${p.name} is injured.` };
  if (!opts.force && activePlayers(league, p.team).length >= ACTIVE_MAX) return { ok: false, msg: "The active roster is full (26). Option or DFA someone first." };
  if (!p.on40) {
    if (fortyMan(league, p.team).length >= FORTY_MAX) return { ok: false, msg: "The 40-man roster is full. DFA someone to make room." };
    p.on40 = true;
  }
  p.status = "active";
  news(league, `${league.teams[p.team].abbrev} recalled ${p.name}.`, p.team);
  return { ok: true, msg: `${p.name} called up.` };
}

export function optionDown(league: League, id: number): TxResult {
  const p = league.players[id];
  if (!p || p.status !== "active") return { ok: false, msg: "Only active players can be optioned." };
  if (p.options <= 0 && p.service >= 3) return { ok: false, msg: `${p.name} is out of options — DFA or keep him.` };
  if (p.service >= 5) return { ok: false, msg: `${p.name} has 5+ years of service and can refuse an assignment.` };
  p.status = "minors";
  p.optionedThisYear = true;
  const t = league.teams[p.team];
  news(league, `${t.abbrev} optioned ${p.name} to Triple-A.`, p.team);
  return { ok: true, msg: `${p.name} optioned.` };
}

/** Designate for assignment: waivers (worst record claims first), else outrighted off the 40-man. */
export function dfa(league: League, id: number): TxResult {
  const p = league.players[id];
  if (!p || !p.on40) return { ok: false, msg: "Only 40-man players can be designated." };
  const from = p.team;
  const fromAbbrev = league.teams[from].abbrev;
  p.on40 = false;
  const claimants = Object.values(league.teams)
    .filter((t) => t.id !== from && t.id !== league.userTeam)
    .sort((a, b) => a.w - a.l - (b.w - b.l));
  const war = projectedWar(p, 0);
  const surplus = war * 9.5 - p.contract.aav;
  if (war > 0.6 && surplus > 0.5) {
    for (const t of claimants) {
      if (fortyMan(league, t.id).length < FORTY_MAX) {
        p.team = t.id;
        p.on40 = true;
        p.status = "minors";
        news(league, `${t.abbrev} claimed ${p.name} off waivers from ${fromAbbrev}.`, from);
        normalizeRoster(league, t.id);
        return { ok: true, msg: `${p.name} was claimed by ${t.abbrev}.` };
      }
    }
  }
  if (p.status === "active" || p.status === "il") p.status = p.status === "il" ? "il" : "minors";
  news(league, `${fromAbbrev} outrighted ${p.name} to Triple-A.`, from);
  return { ok: true, msg: `${p.name} cleared waivers and was outrighted.` };
}

/** Release: remaining salary becomes dead money; the player becomes a free agent. */
export function release(league: League, id: number): TxResult {
  const p = league.players[id];
  if (!p || p.team === 0) return { ok: false, msg: "Not on a team." };
  const t = league.teams[p.team];
  if (p.contract.kind !== "minor" && p.contract.aav > 0.85) t.dead.push({ aav: p.contract.aav, years: p.contract.years, name: p.name });
  news(league, `${t.abbrev} released ${p.name}.`, t.id);
  p.prevTeam = p.team;
  p.team = 0;
  p.status = "fa";
  p.on40 = false;
  p.contract = { aav: 0.8, years: 1, kind: "minor", signed: league.season };
  return { ok: true, msg: `${p.name} released.` };
}

export function activateFromIL(league: League, id: number): TxResult {
  const p = league.players[id];
  if (!p || p.status !== "il") return { ok: false, msg: "Not on the injured list." };
  if (!isHealthy(p)) return { ok: false, msg: `${p.name} is still injured (${p.injury?.days} days).` };
  if (activePlayers(league, p.team).length >= ACTIVE_MAX) return { ok: false, msg: "The active roster is full. Option or DFA someone first." };
  if (!p.on40) {
    if (fortyMan(league, p.team).length >= FORTY_MAX) return { ok: false, msg: "40-man roster full." };
    p.on40 = true;
  }
  p.injury = undefined;
  p.status = "active";
  news(league, `${league.teams[p.team].abbrev} activated ${p.name} from the injured list.`, p.team);
  return { ok: true, msg: `${p.name} activated.` };
}

/** Put an injured player on the IL (or a healthy one on the 10-day IL as a "phantom" rest — not allowed). */
export function placeOnIL(league: League, id: number): TxResult {
  const p = league.players[id];
  if (!p || p.status !== "active") return { ok: false, msg: "Only active players can go on the IL." };
  if (isHealthy(p)) return { ok: false, msg: `${p.name} is healthy.` };
  p.status = "il";
  return { ok: true, msg: `${p.name} placed on the ${p.injury!.il}-day IL.` };
}

/**
 * Make a club's roster legal: injured actives to the IL, healed players back (AI /
 * auto-roster), exactly 26 active with ≤13 pitchers and two catchers, ≤40 on the
 * 40-man, then a valid depth chart.
 */
export function normalizeRoster(league: League, teamId: number, opts: { offseason?: boolean } = {}): void {
  const t: TeamState | undefined = league.teams[teamId];
  if (!t) return;
  const isUser = teamId === league.userTeam;
  const auto = !isUser || league.settings.autoRoster;
  const org = orgPlayers(league, teamId);
  for (const p of org) {
    if (p.status === "active" && !isHealthy(p)) {
      p.status = "il";
      if (p.injury && p.injury.il === 60) news(league, `${t.abbrev} moved ${p.name} to the 60-day IL.`, teamId, "injury");
    }
    if (p.status === "il" && isHealthy(p) && auto) {
      p.injury = undefined;
      p.status = p.on40 || fortyMan(league, teamId).length < FORTY_MAX ? "active" : "minors";
      p.on40 = true;
      if (!opts.offseason) news(league, `${t.abbrev} activated ${p.name} from the injured list.`, teamId);
    }
  }
  const active = () => orgPlayers(league, teamId).filter((p) => p.status === "active");
  // Too many: send down (or DFA) the least valuable at the over-represented spot.
  let guard = 0;
  while (active().length > ACTIVE_MAX && guard++ < 30) {
    const act = active();
    const pitchers = act.filter((p) => p.pitcher).length;
    const hitters = act.length - pitchers;
    let pool = pitchers > PITCHER_MAX ? act.filter((p) => p.pitcher) : hitters > 13 ? act.filter((p) => !p.pitcher) : [...act];
    // Never strand the club without two catchers.
    if (act.filter((p) => p.pos === "C").length <= 2) pool = pool.filter((p) => p.pos !== "C");
    const victim = (pool.length ? pool : act).sort((a, b) => rosterValue(a) - rosterValue(b))[0];
    if (victim.options > 0 || victim.service < 3) {
      victim.status = "minors";
      victim.optionedThisYear = true;
      if (!opts.offseason) news(league, `${t.abbrev} optioned ${victim.name} to Triple-A.`, teamId);
    } else dfa(league, victim.id);
  }
  // Too few: promote by need.
  guard = 0;
  while (active().length < ACTIVE_MAX && guard++ < 30) {
    const act = active();
    const pitchers = act.filter((p) => p.pitcher).length;
    const catchers = act.filter((p) => p.pos === "C" && isHealthy(p)).length;
    const hitters = act.length - pitchers;
    const needPitcher = pitchers < PITCHER_MAX && (hitters >= 13 || pitchers < 12);
    const minors = orgPlayers(league, teamId).filter((p) => p.status === "minors" && isHealthy(p));
    let pool = minors.filter((p) => (catchers < 2 && !needPitcher ? p.pos === "C" : needPitcher ? p.pitcher : !p.pitcher));
    if (!pool.length) pool = minors;
    if (!pool.length) break;
    const room = fortyMan(league, teamId).length < FORTY_MAX;
    const ranked = pool.sort((a, b) => b.ovr - a.ovr + (b.on40 ? 2 : 0) - (a.on40 ? 2 : 0));
    let pick = ranked.find((p) => p.on40 || room);
    if (!pick) {
      // Clear a 40-man spot for the best non-40 option.
      const cut = fortyMan(league, teamId).filter((p) => p.status === "minors").sort((a, b) => rosterValue(a) - rosterValue(b))[0];
      if (!cut) break;
      cut.on40 = false;
      news(league, `${t.abbrev} outrighted ${cut.name} off the 40-man roster.`, teamId);
      pick = ranked[0];
    }
    pick.on40 = true;
    pick.status = "active";
    if (!opts.offseason) news(league, `${t.abbrev} recalled ${pick.name}${isUser ? " (auto)" : ""}.`, teamId);
  }
  // 40-man overflow: outright the least valuable minor leaguers on it.
  guard = 0;
  while (fortyMan(league, teamId).length > FORTY_MAX && guard++ < 40) {
    const cut = fortyMan(league, teamId)
      .filter((p) => p.status !== "active")
      .sort((a, b) => rosterValue(a) - rosterValue(b))[0];
    if (!cut) break;
    cut.on40 = false;
    if (cut.status === "il") cut.status = "minors";
  }
  repairDepth(league, teamId);
}

export function lineupPlayers(league: League, t: TeamState): Array<{ p: Player; pos: LineupPos }> {
  return t.lineup.map((s) => ({ p: league.players[s.id], pos: s.pos })).filter((x) => !!x.p);
}

export function positionWarning(p: Player, pos: LineupPos): string | null {
  if (pos === "DH") return null;
  return eligible(p).some(([q]) => q === pos) ? null : `${p.name} is out of position at ${pos}.`;
}
