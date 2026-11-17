/**
 * Season honors: All-Stars (picked at the break), and at season's end MVP, Cy Young and
 * Rookie of the Year with simulated BBWAA ballots, Reliever of the Year (Mariano Rivera
 * AL / Trevor Hoffman NL), the Hank Aaron Award, Silver Sluggers and Gold Gloves.
 */
import type { MLBLeague } from "@/lib/mlb/teams";
import { LG } from "./data";
import { FRng, hash32 } from "./rng";
import { news } from "./roster";
import { avg, batWar, era, fmt3, ipStr, obp, pitWar, seasonWar, slg, woba } from "./stats";
import type { AllStarRoster, AwardPick, Awards, BatLine, League, PitLine, Player } from "./types";

export const LEAGUES: MLBLeague[] = ["AL", "NL"];
export const SLUGGER_POS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"] as const;
export const GLOVE_POS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;
export const RELIEF_NAME: Record<MLBLeague, string> = { AL: "Mariano Rivera AL Reliever of the Year", NL: "Trevor Hoffman NL Reliever of the Year" };

const teamGames = (league: League, p: Player) => {
  const t = league.teams[p.team];
  return t ? Math.max(1, t.w + t.l) : 162;
};

/** Batting runs above average (wOBA-based). */
export const battingRuns = (b: BatLine): number => ((woba(b) - LG.woba) / LG.wobaScale) * b.pa;

export function batLineStr(p: Player, b: BatLine): string {
  const war = batWar(p, b) + (p.stats.pit ? pitWar(p.stats.pit) : 0);
  return `${war.toFixed(1)} WAR · ${fmt3(avg(b))}/${fmt3(obp(b))}/${fmt3(slg(b))} · ${b.hr} HR · ${b.rbi} RBI${b.sb >= 10 ? ` · ${b.sb} SB` : ""}`;
}

export function pitLineStr(s: PitLine): string {
  const rel = s.gs < s.g / 2;
  return `${pitWar(s).toFixed(1)} WAR · ${s.w}-${s.l}, ${era(s).toFixed(2)} ERA · ${ipStr(s)} IP · ${s.k} SO${rel || s.sv ? ` · ${s.sv} SV` : ""}`;
}

const pick = (p: Player, v: number, line: string): AwardPick => ({ id: p.id, team: p.team, v: Math.round(v * 100) / 100, line });

function leaguePlayers(league: League, lg: MLBLeague): Player[] {
  return Object.values(league.players).filter((p) => p.team && league.teams[p.team]?.league === lg);
}

/**
 * Simulated ballots: each of 30 voters ranks candidates by score plus personal noise;
 * points per place follow the BBWAA scale. Returns finishers with points, best first.
 */
function vote(cands: Array<{ p: Player; score: number; line: string }>, points: number[], noise: number, seed: number): AwardPick[] {
  if (!cands.length) return [];
  const rng = new FRng(seed);
  const pts = new Map<number, number>();
  const top = [...cands].sort((a, b) => b.score - a.score).slice(0, points.length + 6);
  for (let v = 0; v < 30; v += 1) {
    const ballot = top.map((c) => ({ c, s: c.score + rng.gauss(0, noise) })).sort((a, b) => b.s - a.s);
    ballot.slice(0, points.length).forEach((b, i) => pts.set(b.c.p.id, (pts.get(b.c.p.id) ?? 0) + points[i]));
  }
  return top
    .filter((c) => pts.get(c.p.id))
    .map((c) => ({ ...pick(c.p, c.score, c.line), pts: pts.get(c.p.id) }))
    .sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0) || b.v - a.v);
}

const MVP_PTS = [14, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const CY_PTS = [7, 4, 3, 2, 1];
const ROY_PTS = [5, 3, 1];

export function computeAwards(league: League): Awards {
  const empty = () => ({ AL: 0, NL: 0 });
  const out: Awards = {
    season: league.season,
    mvp: empty(),
    cy: empty(),
    roy: empty(),
    ballots: { mvp: { AL: [], NL: [] }, cy: { AL: [], NL: [] }, roy: { AL: [], NL: [] } },
    relief: {},
    aaron: {},
    silver: { AL: {}, NL: {} },
    gold: { AL: {}, NL: {} },
    allStar: league.allStars?.[league.season],
  };
  const seed = hash32(league.seed, league.season, "awards");
  for (const lg of LEAGUES) {
    const ps = leaguePlayers(league, lg);
    const line = (p: Player) => (p.stats.bat && (!p.stats.pit || p.stats.bat.pa > p.stats.pit.bf * 0.5) ? batLineStr(p, p.stats.bat) : p.stats.pit ? pitLineStr(p.stats.pit) : "");
    // MVP: WAR, a nod to winners and to big counting numbers.
    const mvpC = ps
      .filter((p) => (p.stats.bat?.pa ?? 0) >= 300 || (p.stats.pit?.outs ?? 0) >= 360)
      .map((p) => {
        const t = league.teams[p.team];
        const b = p.stats.bat;
        const score = seasonWar(p) + (t.w - 81) * 0.025 + (b ? b.hr * 0.012 + b.rbi * 0.004 : 0) - (p.stats.pit && !b ? 1.2 : 0);
        return { p, score, line: line(p) };
      });
    out.ballots!.mvp[lg] = vote(mvpC, MVP_PTS, 0.7, seed + (lg === "AL" ? 1 : 2));
    // Cy Young: WAR, ERA and innings.
    const cyC = ps
      .filter((p) => p.stats.pit && (p.stats.pit.outs >= 360 || (p.stats.pit.outs >= 150 && p.stats.pit.sv >= 30)))
      .map((p) => {
        const s = p.stats.pit!;
        const rel = s.gs < s.g / 2;
        const score = (rel ? pitWar(s) * 0.8 : pitWar(s)) + s.w * 0.04 - era(s) * 0.25 + s.k * 0.002;
        return { p, score, line: pitLineStr(s) };
      });
    out.ballots!.cy[lg] = vote(cyC, CY_PTS, 0.5, seed + (lg === "AL" ? 3 : 4));
    const royC = ps
      .filter((p) => p.rookie && ((p.stats.bat?.pa ?? 0) >= 150 || (p.stats.pit?.outs ?? 0) >= 120))
      .map((p) => ({ p, score: seasonWar(p) + (p.stats.bat?.hr ?? 0) * 0.01, line: line(p) }));
    out.ballots!.roy[lg] = vote(royC, ROY_PTS, 0.5, seed + (lg === "AL" ? 5 : 6));
    out.mvp[lg] = out.ballots!.mvp[lg][0]?.id ?? 0;
    out.cy[lg] = out.ballots!.cy[lg][0]?.id ?? 0;
    out.roy[lg] = out.ballots!.roy[lg][0]?.id ?? 0;

    // Reliever of the Year.
    const rel = ps
      .filter((p) => p.stats.pit && p.stats.pit.g >= 40 && p.stats.pit.gs <= p.stats.pit.g * 0.15)
      .map((p) => ({ p, v: pitWar(p.stats.pit!) + p.stats.pit!.sv * 0.035 - era(p.stats.pit!) * 0.15 }))
      .sort((a, b) => b.v - a.v)[0];
    if (rel) out.relief![lg] = pick(rel.p, rel.v, pitLineStr(rel.p.stats.pit!));

    // Hank Aaron Award: the league's best offensive player.
    const hitters = ps.filter((p) => p.stats.bat && p.stats.bat.pa >= 3.1 * teamGames(league, p) * 0.8);
    const aaron = hitters.map((p) => ({ p, v: battingRuns(p.stats.bat!) + p.stats.bat!.hr * 0.15 })).sort((a, b) => b.v - a.v)[0];
    if (aaron) out.aaron![lg] = pick(aaron.p, aaron.v, batLineStr(aaron.p, aaron.p.stats.bat!));

    // Silver Sluggers: best bat at each position (DH included).
    const sluggable = ps.filter((p) => p.stats.bat && p.stats.bat.pa >= 1.5 * teamGames(league, p));
    for (const pos of SLUGGER_POS) {
      const best = sluggable
        .filter((p) => p.pos === pos)
        .map((p) => ({ p, v: battingRuns(p.stats.bat!) + p.stats.bat!.hr * 0.1 }))
        .sort((a, b) => b.v - a.v)[0];
      if (best) out.silver![lg][pos] = pick(best.p, best.v, batLineStr(best.p, best.p.stats.bat!));
    }
    // Gold Gloves: defensive runs over a full season's work at the spot (a little bat bias, as with the real voters).
    for (const pos of GLOVE_POS) {
      const best = ps
        .filter((p) => p.pos === pos && p.stats.bat && p.stats.bat.g >= teamGames(league, p) * 0.55)
        .map((p) => {
          const def = (p.bat?.def ?? 0) * (p.stats.bat!.g / 150);
          return { p, v: def + battingRuns(p.stats.bat!) * 0.05 + hash32(p.id, league.season, "gg") / 2 ** 32 };
        })
        .sort((a, b) => b.v - a.v)[0];
      if (best) {
        const b = best.p.stats.bat!;
        out.gold![lg][pos] = pick(best.p, best.v, `${((best.p.bat?.def ?? 0) * (b.g / 150)).toFixed(0)} def runs · ${b.g} G · ${fmt3(avg(b))} AVG`);
      }
    }
  }
  return out;
}

/** All-Star selections at the break: fan-voted starters, then reserves, pitchers, every club represented. */
export function selectAllStars(league: League): void {
  const sel: Record<MLBLeague, AllStarRoster> = { AL: { starters: [], reserves: [], pitchers: [] }, NL: { starters: [], reserves: [], pitchers: [] } };
  for (const lg of LEAGUES) {
    const ps = leaguePlayers(league, lg).filter((p) => p.status === "active" || p.status === "il");
    const r = sel[lg];
    const used = new Set<number>();
    // Fans vote on season-to-date value and reputation.
    const fan = (p: Player) => (p.stats.bat ? batWar(p, p.stats.bat) : 0) + (p.ovr - 50) * 0.06;
    const hitters = ps.filter((p) => !p.pitcher && (p.stats.bat?.pa ?? 0) >= 120);
    const slot = (pos: string, pool: Player[]) => {
      const best = pool.filter((p) => !used.has(p.id)).sort((a, b) => fan(b) - fan(a))[0];
      if (best) {
        r.starters.push({ pos, id: best.id });
        used.add(best.id);
      }
    };
    for (const pos of ["C", "1B", "2B", "3B", "SS"]) slot(pos, hitters.filter((p) => p.pos === pos));
    for (let i = 0; i < 3; i += 1) slot("OF", hitters.filter((p) => p.pos === "LF" || p.pos === "CF" || p.pos === "RF"));
    slot("DH", hitters);
    // Players' ballot / commissioner: reserves on season-to-date WAR.
    const res = hitters.filter((p) => !used.has(p.id)).sort((a, b) => seasonWar(b) - seasonWar(a));
    if (!r.starters.some((s) => s.pos === "C") || !res.slice(0, 8).some((p) => p.pos === "C")) {
      const c = res.find((p) => p.pos === "C");
      if (c) {
        r.reserves.push(c.id);
        used.add(c.id);
      }
    }
    for (const p of res) {
      if (r.reserves.length >= 8) break;
      if (used.has(p.id)) continue;
      r.reserves.push(p.id);
      used.add(p.id);
    }
    const arms = ps.filter((p) => p.stats.pit && p.stats.pit.outs >= 45);
    const sp = arms.filter((p) => p.stats.pit!.gs >= p.stats.pit!.g / 2).sort((a, b) => pitWar(b.stats.pit!) - pitWar(a.stats.pit!) + (era(a.stats.pit!) - era(b.stats.pit!)) * 0.2);
    const rp = arms.filter((p) => p.stats.pit!.gs < p.stats.pit!.g / 2).sort((a, b) => pitWar(b.stats.pit!) + b.stats.pit!.sv * 0.05 - pitWar(a.stats.pit!) - a.stats.pit!.sv * 0.05);
    for (const p of sp.slice(0, 8)) r.pitchers.push(p.id);
    for (const p of rp.slice(0, 4)) r.pitchers.push(p.id);
    r.pitchers.forEach((id) => used.add(id));
    // Every club gets a representative.
    for (const t of Object.values(league.teams).filter((t) => t.league === lg)) {
      const all = [...r.starters.map((s) => s.id), ...r.reserves, ...r.pitchers];
      if (all.some((id) => league.players[id]?.team === t.id)) continue;
      const best = ps.filter((p) => p.team === t.id && !used.has(p.id)).sort((a, b) => seasonWar(b) - seasonWar(a))[0];
      if (!best) continue;
      if (best.pitcher) r.pitchers.push(best.id);
      else r.reserves.push(best.id);
      used.add(best.id);
    }
  }
  league.allStars = { ...(league.allStars ?? {}), [league.season]: sel };
  const me = league.userTeam;
  const mine = [...sel.AL.starters.map((s) => s.id), ...sel.AL.reserves, ...sel.AL.pitchers, ...sel.NL.starters.map((s) => s.id), ...sel.NL.reserves, ...sel.NL.pitchers].filter(
    (id) => league.players[id]?.team === me,
  );
  news(
    league,
    `All-Star rosters announced. ${league.teams[me].name}: ${mine.length ? mine.map((id) => league.players[id].name).join(", ") : "no selections"}.`,
    me,
    "award",
  );
}

/** Short honor tags for a player's season, Baseball-Reference style (AS, MVP-3, CYA-1, SS, GG …). */
export function awardTags(league: League, season: number, id: number): string[] {
  const tags: string[] = [];
  const as = league.allStars?.[season];
  if (as) {
    for (const lg of LEAGUES) {
      const r = as[lg];
      if (r.starters.some((s) => s.id === id) || r.reserves.includes(id) || r.pitchers.includes(id)) tags.push("AS");
    }
  }
  const a = league.awards.find((x) => x.season === season);
  if (!a) return tags;
  for (const lg of LEAGUES) {
    const place = (list: AwardPick[] | undefined, tag: string) => {
      const i = list?.findIndex((x) => x.id === id) ?? -1;
      if (i >= 0) tags.push(`${tag}-${i + 1}`);
    };
    if (a.ballots) {
      place(a.ballots.mvp[lg], "MVP");
      place(a.ballots.cy[lg], "CYA");
      place(a.ballots.roy[lg], "ROY");
    } else {
      if (a.mvp[lg] === id) tags.push("MVP-1");
      if (a.cy[lg] === id) tags.push("CYA-1");
      if (a.roy[lg] === id) tags.push("ROY-1");
    }
    if (a.relief?.[lg]?.id === id) tags.push("REL");
    if (a.aaron?.[lg]?.id === id) tags.push("HA");
    if (Object.values(a.silver?.[lg] ?? {}).some((x) => x?.id === id)) tags.push("SS");
    if (Object.values(a.gold?.[lg] ?? {}).some((x) => x?.id === id)) tags.push("GG");
  }
  return tags;
}
