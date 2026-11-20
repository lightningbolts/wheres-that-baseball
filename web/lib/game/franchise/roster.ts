/**
 * Roster management: 26-man active roster, 40-man roster, minors, injured list,
 * depth chart (lineup / rotation / bullpen roles) and transactions
 * (call-up, option, DFA + waivers, release, IL activation).
 */
import { batRuns600, canPitch, defAt, eligible, isPosPlayer, POS_ADJ, slotValue } from "./ratings";
import { projectedWar, remainingOwed } from "./contracts";
import { leaveTeam } from "./splits";
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

/** Value of a hitter at a spot; anyone forced out of position pays heavily for it. */
const spotValue = (p: Player, pos: LineupPos): number => {
  if (!p.bat) return -999;
  if (pos === "DH") return batRuns600(p.bat) + POS_ADJ.DH;
  return defAt(p, pos) == null ? batRuns600(p.bat) - 60 : slotValue(p, pos);
};
const SPOTS: LineupPos[] = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];

/**
 * Best nine for the eight field spots and DH: an exact assignment (dynamic programming over
 * which spots are filled), so nobody plays a position he can't while a natural one sits.
 * A greedy fill (catcher first, then shortstop…) happily put a star DH at second base
 * because his bat outscored the real second baseman's bat-plus-glove.
 */
export function assignSpots(hitters: Player[], spots: LineupPos[] = SPOTS, fixed: LineupSlot[] = []): LineupSlot[] {
  const pool = hitters.filter((p) => p.bat && !fixed.some((f) => f.id === p.id));
  const n = spots.length;
  const full = (1 << n) - 1;
  // best[mask] after considering players[0..i]; choice tracking per player.
  let best = new Float64Array(1 << n).fill(-Infinity);
  best[0] = 0;
  const pickAt: Int8Array[] = [];
  for (const p of pool) {
    const next = Float64Array.from(best);
    const choice = new Int8Array(1 << n).fill(-1);
    const vals = spots.map((pos) => spotValue(p, pos));
    for (let m = 0; m <= full; m += 1) {
      if (best[m] === -Infinity) continue;
      for (let k = 0; k < n; k += 1) {
        if (m & (1 << k)) continue;
        const nm = m | (1 << k);
        const v = best[m] + vals[k];
        if (v > next[nm]) {
          next[nm] = v;
          choice[nm] = k;
        }
      }
    }
    // A mask may be reached without this player: keep the "skip" (choice -1) where it is no worse.
    for (let m = 0; m <= full; m += 1) if (best[m] >= next[m]) choice[m] = -1;
    pickAt.push(choice);
    best = next;
  }
  // The fullest mask reachable (thin rosters fill what they can).
  let m = full;
  if (best[m] === -Infinity) {
    let bc = -1;
    for (let x = 0; x <= full; x += 1) {
      const c = popcount(x);
      if (best[x] > -Infinity && (c > bc || (c === bc && best[x] > best[m]))) {
        bc = c;
        m = x;
      }
    }
  }
  const out: LineupSlot[] = [...fixed];
  for (let i = pool.length - 1; i >= 0; i -= 1) {
    const k = pickAt[i][m];
    if (k < 0) continue;
    out.push({ id: pool[i].id, pos: spots[k] });
    m &= ~(1 << k);
  }
  return out;
}

const popcount = (x: number): number => {
  let c = 0;
  for (; x; x &= x - 1) c += 1;
  return c;
};

export function bestLineup(hitters: Player[]): LineupSlot[] {
  return battingOrder(assignSpots(hitters), hitters);
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
  const nextUp = t.rotation.length ? t.rotation[t.rotIdx % t.rotation.length] : undefined;
  const pitchers = act.filter(canPitch);
  const starters = [...pitchers].sort((a, b) => starterScore(b) - starterScore(a));
  // The five best starters, ace first (the top of the rotation gets the most turns).
  t.rotation = starters
    .slice(0, 5)
    .sort((a, b) => b.ovr - a.ovr)
    .map((p) => p.id);
  const pen = pitchers.filter((p) => !t.rotation.includes(p.id)).sort((a, b) => b.ovr - a.ovr);
  t.closer = pen[0]?.id ?? null;
  t.setup = pen.slice(1, 3).map((p) => p.id);
  // Whoever was due to start still starts next.
  const i = nextUp != null ? t.rotation.indexOf(nextUp) : -1;
  t.rotIdx = i >= 0 ? i : t.rotIdx % Math.max(1, t.rotation.length);
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
  // Lineup: keep who is still here, re-place the rest exactly (nobody out of position).
  const keep = t.lineup.filter((s) => ok(s.id) && isPosPlayer(league.players[s.id]));
  if (keep.length < 9 || new Set(keep.map((s) => s.pos)).size < keep.length) {
    const seen = new Set<string>();
    const kept = keep.filter((s) => (seen.has(s.pos) ? false : (seen.add(s.pos), true)));
    const missing = FIELD_SPOTS.filter((pos) => !kept.some((s) => s.pos === pos));
    const filled = assignSpots(act.filter(isPosPlayer), missing, kept);
    if (filled.length >= 9) {
      // New men take the batting-order spot of the man they replace.
      const order: LineupSlot[] = [];
      for (const s of t.lineup) {
        const f = filled.find((x) => x.pos === s.pos);
        if (f && !order.includes(f)) order.push(f);
      }
      for (const f of filled) if (!order.includes(f)) order.push(f);
      t.lineup = order.slice(0, 9);
    } else t.lineup = bestLineup(act.filter(isPosPlayer));
  }
  // Auto-managed: a fill-in keeps the job only while he is the right call. When a regular
  // comes back from the IL, or someone is stuck out of position, the lineup is rebuilt.
  if (league.settings.autoRoster) {
    const hitters = act.filter(isPosPlayer);
    const val = (lu: LineupSlot[]) => lu.reduce((a, s) => a + spotValue(league.players[s.id], s.pos as LineupPos), 0);
    const best = assignSpots(hitters);
    const outOfPos = t.lineup.some((s) => s.pos !== "DH" && defAt(league.players[s.id], s.pos as LineupPos) == null);
    if (best.length >= 9 && (outOfPos || val(best) - val(t.lineup) > 6)) t.lineup = battingOrder(best, hitters);
  }
  // Rotation.
  const rot = t.rotation.filter((id) => ok(id) && canPitch(league.players[id]));
  if (rot.length < 5) {
    const cands = act
      .filter((p) => canPitch(p) && !rot.includes(p.id) && p.id !== t.closer && !t.setup.includes(p.id))
      .sort((a, b) => starterScore(b) - starterScore(a));
    while (rot.length < 5 && cands.length) rot.push(cands.shift()!.id);
  }
  // Auto-managed: a clearly better healthy starter (back from the IL, called up) takes the
  // weakest rotation spot, and the rotation lines up ace first.
  if (league.settings.autoRoster) {
    const nextUp = rot.length ? rot[t.rotIdx % rot.length] : undefined;
    const sps = act.filter((p) => canPitch(p) && p.pos === "SP" && !rot.includes(p.id) && p.id !== t.closer).sort((a, b) => b.ovr - a.ovr);
    for (const c of sps) {
      const worst = rot.reduce<number | null>((w, id) => (w == null || league.players[id].ovr < league.players[w].ovr ? id : w), null);
      if (worst == null || c.ovr - league.players[worst].ovr < 4) break;
      rot[rot.indexOf(worst)] = c.id;
    }
    rot.sort((a, b) => league.players[b].ovr - league.players[a].ovr);
    const i = nextUp != null ? rot.indexOf(nextUp) : -1;
    if (i >= 0) t.rotIdx = i;
  }
  t.rotation = rot;
  if (t.rotIdx >= rot.length) t.rotIdx = 0;
  const pen = act.filter((p) => p.pitcher && !p.twoWay && !rot.includes(p.id)).sort((a, b) => b.ovr - a.ovr);
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
        leaveTeam(p);
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
  if (p.contract.kind !== "minor" && p.contract.aav > 0.85) {
    // What's still owed, spread over the remaining seasons (a declined option's buyout included).
    const owed = remainingOwed(p.contract);
    t.dead.push({ aav: Math.round((owed / p.contract.years) * 100) / 100, years: p.contract.years, name: p.name });
  }
  news(league, `${t.abbrev} released ${p.name}.`, t.id);
  p.prevTeam = p.team;
  leaveTeam(p);
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
  // AI clubs re-set their depth chart from scratch; the user's choices are only patched.
  if (isUser) repairDepth(league, teamId);
  else autoDepth(league, teamId);
}

export function lineupPlayers(league: League, t: TeamState): Array<{ p: Player; pos: LineupPos }> {
  return t.lineup.map((s) => ({ p: league.players[s.id], pos: s.pos })).filter((x) => !!x.p);
}

export function positionWarning(p: Player, pos: LineupPos): string | null {
  if (pos === "DH") return null;
  return eligible(p).some(([q]) => q === pos) ? null : `${p.name} is out of position at ${pos}.`;
}
