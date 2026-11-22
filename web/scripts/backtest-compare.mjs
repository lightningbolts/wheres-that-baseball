/**
 * Scores a backtest season projection (project-season.ts --season <Y> --out <proj>) against what
 * happened (ml-engine/scripts/build_backtest_inputs.py → actual-<Y>.json), next to naive baselines:
 * every club at 81 wins, last year's record regressed a third of the way to .500, and every player
 * repeating last season.
 *
 *   node scripts/backtest-compare.mjs <proj.json> <actual.json> [report.json]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [projFile, actualFile, reportFile] = process.argv.slice(2);
if (!projFile || !actualFile) {
  console.error("usage: node scripts/backtest-compare.mjs <proj.json> <actual.json> [report.json]");
  process.exit(1);
}
const P = JSON.parse(readFileSync(projFile, "utf8"));
const A = JSON.parse(readFileSync(actualFile, "utf8"));
const Y = A.season;
const cacheDir = dirname(actualFile);

async function api(path, name) {
  const f = join(cacheDir, name);
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  const res = await fetch(`https://statsapi.mlb.com/api/v1${path}`, { headers: { "User-Agent": "wtbb-backtest" } });
  const d = await res.json();
  writeFileSync(f, JSON.stringify(d));
  return d;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const rmse = (pairs) => Math.sqrt(mean(pairs.map(([p, a]) => (p - a) ** 2)));
const mae = (pairs) => mean(pairs.map(([p, a]) => Math.abs(p - a)));
function corr(pairs) {
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy || 1);
}
const brier = (pairs) => mean(pairs.map(([p, o]) => (p - o) ** 2));
const logLoss = (pairs) => -mean(pairs.map(([p, o]) => Math.log(Math.min(1 - 1e-3, Math.max(1e-3, o ? p : 1 - p)))));
const r3 = (x) => Math.round(x * 1000) / 1000;
const stats = (pairs) => ({ n: pairs.length, rmse: r3(rmse(pairs)), mae: r3(mae(pairs)), r: r3(corr(pairs)) });

// ---- Last season, for the naive baselines.
const prevSt = await api(`/standings?leagueId=103,104&season=${Y - 1}&standingsTypes=regularSeason`, `standings_${Y - 1}.json`);
const prevW = {};
for (const rec of prevSt.records ?? []) for (const tr of rec.teamRecords) prevW[tr.team.id] = { w: tr.wins, l: tr.losses, rs: tr.runsScored, ra: tr.runsAllowed };
const prevLines = async (group) => {
  const d = await api(`/stats?stats=season&group=${group}&season=${Y - 1}&sportId=1&playerPool=ALL&limit=3000`, `stats_${group}_${Y - 1}.json`);
  return Object.fromEntries((d.stats?.[0]?.splits ?? []).map((s) => [s.player.id, s.stat]));
};
const prevBat = await prevLines("hitting");
const prevPit = await prevLines("pitching");

// ---- Teams.
const teams = P.teams.map((t) => ({ t, a: A.standings[t.id], prev: prevW[t.id] })).filter((x) => x.a);
const games = (x) => x.a.w + x.a.l;
const winPairs = teams.map(({ t, a }) => [t.wins.mean * (games({ a }) / 162), a.w]);
const pythag = (rs, ra) => rs ** 1.83 / (rs ** 1.83 + ra ** 1.83);
const base81 = teams.map(({ a }) => [81, a.w]);
const baseLast = teams.map(({ a, prev }) => [81 + ((prev.w / (prev.w + prev.l)) * 162 - 81) * (2 / 3), a.w]);
const basePy = teams.map(({ a, prev }) => [81 + (pythag(prev.rs, prev.ra) * 162 - 81) * (2 / 3), a.w]);
const inside = (lo, hi) => mean(teams.map(({ t, a }) => (a.w >= t.wins.pct[lo] && a.w <= t.wins.pct[hi] ? 1 : 0)));
const playoffPairs = teams.map(({ t, a }) => [t.playoffs, a.playoffs ? 1 : 0]);
const divPairs = teams.map(({ t, a }) => [t.div, a.divWin ? 1 : 0]);
const rsPairs = teams.map(({ t, a }) => [t.rs * (games({ a }) / 162), a.rs]);
const raPairs = teams.map(({ t, a }) => [t.ra * (games({ a }) / 162), a.ra]);
const champ = teams.find(({ a }) => a.reach === 5);
const pennants = teams.filter(({ a }) => (a.reach ?? 0) >= 4);
// Calibration of playoff odds in bands.
const bands = [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.01];
const calibration = bands.slice(0, -1).map((lo, i) => {
  const hi = bands[i + 1];
  const inBand = playoffPairs.filter(([p]) => p >= lo && p < hi);
  return { band: `${Math.round(lo * 100)}–${Math.min(100, Math.round(hi * 100))}%`, n: inBand.length, predicted: r3(mean(inBand.map((x) => x[0]))), actual: r3(mean(inBand.map((x) => x[1]))) };
});
const teamRows = teams
  .map(({ t, a, prev }) => ({
    id: t.id,
    proj: Math.round(t.wins.mean * 10) / 10,
    p10: t.wins.pct[1],
    p90: t.wins.pct[5],
    actual: a.w,
    miss: Math.round((a.w - t.wins.mean * (games({ a }) / 162)) * 10) / 10,
    prev: prev?.w,
    playoffs: t.playoffs,
    made: !!a.playoffs,
  }))
  .sort((x, y) => Math.abs(y.miss) - Math.abs(x.miss));

// ---- League environment.
const actualRuns = Object.values(A.standings).reduce((s, x) => s + x.rs, 0);
const actualGames = Object.values(A.standings).reduce((s, x) => s + x.w + x.l, 0);

// ---- Players.
const num = (x) => (x == null || x === "" || x === "-.--" || x === ".---" ? NaN : Number(x));
const ops = (l) => {
  const pa = l.ab + l.bb + l.hbp + l.sf;
  const obp = (l.h + l.bb + l.hbp) / Math.max(1, pa);
  const tb = l.h + l.d + 2 * l.t + 3 * l.hr;
  return obp + tb / Math.max(1, l.ab);
};
const hitters = [];
for (const h of P.hitters) {
  const a = A.hitting[h.id];
  if (!a || !h.line || a.plateAppearances < 300) continue;
  const pr = prevBat[h.id];
  hitters.push({
    id: h.id,
    name: h.name,
    pa: [h.line.pa, a.plateAppearances],
    ops: [ops(h.line), num(a.ops)],
    hrRate: [h.line.hr / h.line.pa, a.homeRuns / a.plateAppearances],
    kRate: [h.line.k / h.line.pa, a.strikeOuts / a.plateAppearances],
    bbRate: [h.line.bb / h.line.pa, a.baseOnBalls / a.plateAppearances],
    hr: [h.line.hr, a.homeRuns],
    prevOps: pr && pr.plateAppearances >= 200 ? num(pr.ops) : NaN,
  });
}
const ipOf = (s) => {
  const [w, f = "0"] = String(s ?? "0").split(".");
  return Number(w) + Number(f) / 3;
};
const pitchers = [];
for (const p of P.pitchers) {
  const a = A.pitching[p.id];
  if (!a || !p.line) continue;
  const ip = ipOf(a.inningsPitched);
  if (ip < 80) continue;
  const pr = prevPit[p.id];
  const bf = a.battersFaced;
  pitchers.push({
    id: p.id,
    name: p.name,
    ip: [p.line.outs / 3, ip],
    era: [(p.line.er * 27) / Math.max(1, p.line.outs), num(a.era)],
    kRate: [p.line.k / p.line.bf, a.strikeOuts / bf],
    bbRate: [p.line.bb / p.line.bf, a.baseOnBalls / bf],
    prevEra: pr && ipOf(pr.inningsPitched) >= 60 ? num(pr.era) : NaN,
    prevK: pr && pr.battersFaced >= 250 ? pr.strikeOuts / pr.battersFaced : NaN,
  });
}
const pick = (rows, key) => rows.map((r) => r[key]).filter(([p, a]) => Number.isFinite(p) && Number.isFinite(a));
const vsPrev = (rows, key, prevKey) => {
  const both = rows.filter((r) => Number.isFinite(r[prevKey]) && Number.isFinite(r[key][1]));
  return { n: both.length, model: stats(both.map((r) => r[key])), lastYear: stats(both.map((r) => [r[prevKey], r[key][1]])) };
};
// Projected regulars the season never saw (hurt, released, or optioned): playing-time misses.
const ghosts = P.hitters.filter((h) => h.line?.pa >= 450 && !(A.hitting[h.id]?.plateAppearances >= 150)).map((h) => ({ name: h.name, pa: Math.round(h.line.pa), actual: A.hitting[h.id]?.plateAppearances ?? 0 }));
const bigMiss = (rows, key) =>
  [...rows]
    .sort((x, y) => Math.abs(y[key][1] - y[key][0]) - Math.abs(x[key][1] - x[key][0]))
    .slice(0, 8)
    .map((r) => ({ name: r.name, proj: r3(r[key][0]), actual: r3(r[key][1]) }));

// ---- Awards: the real winner's projected odds and rank.
const awards = {};
for (const [key, byLg] of Object.entries(A.awards ?? {})) {
  for (const [lg, id] of Object.entries(byLg)) {
    const odds = P.awards[`${key}:${lg}`] ?? [];
    const i = odds.findIndex((o) => o.id === id);
    const name = A.hitting[id]?.name ?? A.pitching[id]?.name ?? String(id);
    awards[`${key} ${lg}`] = { winner: name, p: i >= 0 ? r3(odds[i].p) : 0, rank: i >= 0 ? i + 1 : null };
  }
}

const report = {
  season: Y,
  sims: P.sims,
  teams: {
    wins: { model: stats(winPairs), all81: stats(base81), lastYearRegressed: stats(baseLast), lastYearPythag: stats(basePy) },
    projectedSpread: r3(Math.sqrt(mean(winPairs.map(([p]) => (p - 81) ** 2)))),
    actualSpread: r3(Math.sqrt(mean(winPairs.map(([, a]) => (a - 81) ** 2)))),
    coverage: { "80% band": r3(inside(1, 5)), "50% band": r3(inside(2, 4)) },
    runsScored: stats(rsPairs),
    runsAllowed: stats(raPairs),
    playoffs: { brier: r3(brier(playoffPairs)), logLoss: r3(logLoss(playoffPairs)), coinBrier: r3(brier(playoffPairs.map(([, o]) => [0.4, o]))), coinLogLoss: r3(logLoss(playoffPairs.map(([, o]) => [0.4, o]))) },
    division: { brier: r3(brier(divPairs)), baseBrier: r3(brier(divPairs.map(([, o]) => [0.2, o]))) },
    calibration,
    champion: champ ? { id: champ.t.id, ws: r3(champ.t.ws), rank: [...P.teams].sort((a, b) => b.ws - a.ws).findIndex((t) => t.id === champ.t.id) + 1 } : null,
    pennants: pennants.map(({ t }) => ({ id: t.id, pennant: r3(t.pennant) })),
    rows: teamRows,
  },
  league: { rpgModel: P.league.rpg.mean, rpgActual: r3(actualRuns / actualGames) },
  hitters: {
    n: hitters.length,
    ops: vsPrev(hitters, "ops", "prevOps"),
    opsAll: stats(pick(hitters, "ops")),
    hrRate: stats(pick(hitters, "hrRate")),
    kRate: stats(pick(hitters, "kRate")),
    bbRate: stats(pick(hitters, "bbRate")),
    pa: stats(pick(hitters, "pa")),
    biggestOpsMisses: bigMiss(hitters, "ops"),
    projectedRegularsWhoBarelyPlayed: ghosts.slice(0, 15),
    ghostCount: ghosts.length,
  },
  pitchers: {
    n: pitchers.length,
    era: vsPrev(pitchers, "era", "prevEra"),
    kRate: vsPrev(pitchers, "kRate", "prevK"),
    bbRate: stats(pick(pitchers, "bbRate")),
    ip: stats(pick(pitchers, "ip")),
    biggestEraMisses: bigMiss(pitchers, "era"),
  },
  awards,
};
if (reportFile) writeFileSync(reportFile, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
