"use client";

import { useMemo, useState, type ReactNode } from "react";
import { pitchName } from "@/components/game/controller";
import { TypeChip } from "@/components/game/PitchTracker";
import { arsenalRates, batRates, pitRates, type ScMoment, type ScTops, type SeasonStatcast } from "@/lib/game/franchise/seasonStatcast";
import { battingRows, pitchingRows, type BatRow, type PitRow } from "@/lib/game/franchise/statline";
import type { League } from "@/lib/game/franchise/types";
import { useProfiles } from "../Profiles";
import { useSeasonStatcast } from "../useSeasonStatcast";
import { f1, ipFmt, pct1, StatTable, type Col } from "../StatTable";
import { Card, Segmented } from "../ui";
import { Filters, NameCell, Select, TeamCell, useCommonFilters } from "./StatsTab";

type Sub = "hitters" | "pitchers" | "arsenal" | "plays";

const dash = "—";
const num = (v: number | null | undefined): number => v ?? 0;
/** A rate column: shows a dash when there was nothing to divide by. */
function rate<R>(key: string, label: string, raw: (r: R) => number | null, fmt: (v: number) => string, extra: Partial<Col<R>> = {}): Col<R> {
  return { key, label, get: (r) => num(raw(r)), fmt: (v, r) => (raw(r) == null ? dash : fmt(v)), rate: true, ...extra };
}
const f0 = (v: number): string => v.toFixed(0);

type HitRow = Pick<BatRow, "id" | "name" | "team" | "lg" | "rookie" | "qual" | "tags" | "pa"> & {
  bbe: number;
  ev: number | null;
  evMax: number;
  la: number | null;
  sweet: number | null;
  hard: number | null;
  barrels: number;
  hrs: number;
  brl: number | null;
  brlPa: number | null;
  hrDist: number;
  swing: number | null;
  whiff: number | null;
  chase: number | null;
};

type ArmRow = Pick<PitRow, "id" | "name" | "team" | "lg" | "rookie" | "qual" | "tags" | "ip" | "so" | "role"> & {
  pitches: number;
  fb: number | null;
  max: number;
  spin: number | null;
  whiff: number | null;
  csw: number | null;
  chase: number | null;
  zone: number | null;
  ev: number | null;
  hard: number | null;
  brl: number | null;
};

type PitchRow = Pick<PitRow, "name" | "team" | "lg" | "rookie" | "tags"> & {
  /** Row key (StatTable wants a number). */
  id: number;
  pid: number;
  qual: boolean;
  type: string;
  n: number;
  usage: number;
  velo: number;
  max: number;
  spin: number;
  ivb: number;
  hb: number;
  whiff: number | null;
  csw: number;
  ev: number | null;
  hard: number | null;
};

export function StatcastLeaders({ league }: { league: League }) {
  const f = useCommonFilters(league);
  const [sub, setSub] = useState<Sub>("hitters");
  const { rosters, slot } = useProfiles();
  const st = useSeasonStatcast(league, f.season, f.split, rosters, slot);
  const sc = st.sc;
  const kept = f.season >= league.season - 1;

  let body: ReactNode;
  if (!kept) body = <Empty>Pitch logs are kept for the current and previous season only.</Empty>;
  else if (st.err) body = <Empty>Couldn&apos;t read the stored games (storage unavailable).</Empty>;
  else if (!sc)
    body = (
      <Empty>
        Reading every game&apos;s pitch log…{st.total > 0 && ` ${st.done.toLocaleString()} / ${st.total.toLocaleString()} games`}
        <div className="mx-auto mt-2 h-1 w-48 overflow-hidden rounded bg-border">
          <div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${st.total ? (st.done / st.total) * 100 : 5}%` }} />
        </div>
      </Empty>
    );
  else if (!sc.games) body = <Empty>No games stored for this season yet. Sim or play some games first.</Empty>;
  else if (sub === "hitters") body = <Hitters league={league} sc={sc} f={f} />;
  else if (sub === "pitchers") body = <Pitchers league={league} sc={sc} f={f} />;
  else if (sub === "arsenal") body = <Arsenals league={league} sc={sc} f={f} />;
  else body = <TopPlays league={league} sc={sc} f={f} linkGames={f.season === league.season} />;

  return (
    <Card
      title="Statcast"
      right={
        <Segmented
          value={sub}
          onChange={setSub}
          options={[
            { v: "hitters", label: "Hitters" },
            { v: "pitchers", label: "Pitchers" },
            { v: "arsenal", label: "Pitch arsenals" },
            { v: "plays", label: "Top plays" },
          ]}
        />
      }
    >
      <div className="mb-3 space-y-2">
        <Filters>{f.ui}</Filters>
        {sc && sc.games > 0 && (
          <p className="text-[11px] text-muted">
            {`From ${sc.games.toLocaleString()} games and ${sc.pitches.toLocaleString()} tracked pitches (played games' own pitches, simmed games' pitch-by-pitch logs).`}
          </p>
        )}
      </div>
      {body}
    </Card>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="py-10 text-center text-sm text-secondary">{children}</div>;
}

type F = ReturnType<typeof useCommonFilters>;

/** Games per club in the logs. */
const teamGames = (sc: SeasonStatcast) => Math.max(1, (sc.games * 2) / 30);

/** Row basics for a player with pitch-log data but no stat line. */
function fallback(league: League, id: number) {
  const p = league.players[id];
  const team = p?.team ?? 0;
  return { id, name: p?.name ?? `#${id}`, team, lg: league.teams[team]?.league ?? null, rookie: false, tags: "" };
}

function Hitters({ league, sc, f }: { league: League; sc: SeasonStatcast; f: F }) {
  const all = useMemo(() => {
    const out: HitRow[] = [];
    const rows = battingRows(league, f.season, f.split);
    const have = new Set(rows.map((r) => r.id));
    // Players whose stat lines are gone (postseason lines clear when the offseason begins): the pitch logs still have them.
    for (const b of sc.bat.values()) if (b.pa && !have.has(b.id)) rows.push({ ...fallback(league, b.id), pa: b.pa, qual: b.pa >= (f.split === "post" ? 10 : 3.1 * teamGames(sc)) } as BatRow);
    for (const r of rows) {
      const b = sc.bat.get(r.id);
      if (!b) continue;
      const x = batRates(b);
      out.push({ id: r.id, name: r.name, team: r.team, lg: r.lg, rookie: r.rookie, qual: r.qual, tags: r.tags, pa: r.pa, bbe: b.bbe, ev: x.ev, evMax: b.evMax, la: x.la, sweet: x.sweetSpotPct, hard: x.hardHitPct, barrels: b.barrels, hrs: b.hrs, brl: x.barrelPct, brlPa: x.barrelPa, hrDist: b.hrDistMax, swing: x.swingPct, whiff: x.whiffPct, chase: x.chasePct });
    }
    return out;
  }, [league, sc, f.season, f.split]);
  const rows = all.filter((r) => f.keep(r, r.pa));
  const cols: Array<Col<HitRow>> = [
    { key: "name", label: "Name", text: true, sticky: true, get: (r) => r.name, render: (r) => <NameCell id={r.id} name={r.name} tags={r.tags} rookie={r.rookie} /> },
    { key: "team", label: "Tm", text: true, get: (r) => league.teams[r.team]?.abbrev ?? "", render: (r) => <TeamCell league={league} id={r.team} /> },
    { key: "pa", label: "PA", get: (r) => r.pa },
    { key: "bbe", label: "BBE", title: "Batted-ball events", get: (r) => r.bbe },
    rate("ev", "EV", (r) => r.ev, f1, { title: "Average exit velocity (mph)" }),
    { key: "evMax", label: "Max EV", get: (r) => r.evMax, fmt: (v) => (v ? f1(v) : dash) },
    rate("la", "LA", (r) => r.la, f1, { title: "Average launch angle (°)" }),
    rate("sweet", "Sweet%", (r) => r.sweet, pct1, { title: "Launch angle 8–32°" }),
    rate("hard", "Hard%", (r) => r.hard, pct1, { title: "Hard-hit rate: 95+ mph" }),
    { key: "barrels", label: "Brl", title: "Barrels", get: (r) => r.barrels },
    rate("brl", "Brl%", (r) => r.brl, pct1, { title: "Barrels per batted ball" }),
    rate("brlPa", "Brl/PA", (r) => r.brlPa, pct1),
    { key: "hrs", label: "HR", get: (r) => r.hrs },
    { key: "hrDist", label: "Max HR", title: "Longest home run (ft)", get: (r) => r.hrDist, fmt: (v) => (v ? f0(v) : dash) },
    rate("swing", "Swing%", (r) => r.swing, pct1),
    rate("whiff", "Whiff%", (r) => r.whiff, pct1, { low: true, title: "Misses per swing" }),
    rate("chase", "Chase%", (r) => r.chase, pct1, { low: true, title: "Swings at pitches outside the zone" }),
  ];
  return <StatTable key={`${f.season}${f.split}`} rows={rows} cols={cols} defaultSort="ev" isQual={(r) => r.qual} highlight={(r) => r.team === league.userTeam} />;
}

function Pitchers({ league, sc, f }: { league: League; sc: SeasonStatcast; f: F }) {
  const [role, setRole] = useState<"All" | "SP" | "RP">("All");
  const all = useMemo(() => {
    const out: ArmRow[] = [];
    const rows = pitchingRows(league, f.season, f.split);
    const have = new Set(rows.map((r) => r.id));
    for (const p of sc.pit.values()) if (p.pitches && !have.has(p.id)) rows.push({ ...fallback(league, p.id), ip: NaN, so: p.ks, role: "RP", qual: p.pitches >= (f.split === "post" ? 45 : 16 * teamGames(sc)) } as PitRow);
    for (const r of rows) {
      const p = sc.pit.get(r.id);
      if (!p) continue;
      const x = pitRates(p);
      out.push({ id: r.id, name: r.name, team: r.team, lg: r.lg, rookie: r.rookie, qual: r.qual, tags: r.tags, ip: r.ip, so: r.so, role: r.role, pitches: p.pitches, fb: x.fbVelo, max: p.veloMax, spin: x.ffSpin, whiff: x.whiffPct, csw: x.cswPct, chase: x.chasePct, zone: x.zonePct, ev: x.evAgainst, hard: x.hardHitPct, brl: x.barrelPct });
    }
    return out;
  }, [league, sc, f.season, f.split]);
  // No stat line: rank by pitches (≈16 an inning) for the minimum.
  const rows = all.filter((r) => f.keep(r, Number.isNaN(r.ip) ? r.pitches / 16 : r.ip) && (role === "All" || r.role === role));
  const cols: Array<Col<ArmRow>> = [
    { key: "name", label: "Name", text: true, sticky: true, get: (r) => r.name, render: (r) => <NameCell id={r.id} name={r.name} tags={r.tags} rookie={r.rookie} /> },
    { key: "team", label: "Tm", text: true, get: (r) => league.teams[r.team]?.abbrev ?? "", render: (r) => <TeamCell league={league} id={r.team} /> },
    { key: "role", label: "Role", text: true, get: (r) => r.role },
    { key: "ip", label: "IP", get: (r) => (Number.isNaN(r.ip) ? 0 : r.ip), fmt: (v, r) => (Number.isNaN(r.ip) ? dash : ipFmt(v)) },
    { key: "pitches", label: "Pitches", get: (r) => r.pitches },
    rate("fb", "FB velo", (r) => r.fb, f1, { title: "Average fastball (four-seam, sinker) mph" }),
    { key: "max", label: "Max", title: "Fastest pitch (mph)", get: (r) => r.max, fmt: f1 },
    rate("spin", "FF spin", (r) => r.spin, f0, { title: "Four-seam spin (rpm)" }),
    rate("whiff", "Whiff%", (r) => r.whiff, pct1, { title: "Misses per swing" }),
    rate("csw", "CSW%", (r) => r.csw, pct1, { title: "Called strikes + whiffs per pitch" }),
    rate("chase", "Chase%", (r) => r.chase, pct1, { title: "Swings at pitches outside the zone" }),
    rate("zone", "Zone%", (r) => r.zone, pct1),
    rate("ev", "EV", (r) => r.ev, f1, { low: true, title: "Average exit velocity allowed" }),
    rate("hard", "Hard%", (r) => r.hard, pct1, { low: true, title: "Hard-hit rate allowed" }),
    rate("brl", "Brl%", (r) => r.brl, pct1, { low: true, title: "Barrels allowed per batted ball" }),
    { key: "so", label: "SO", get: (r) => r.so },
  ];
  return (
    <>
      <div className="mb-2">
        <Segmented
          value={role}
          onChange={setRole}
          options={[
            { v: "All", label: "All pitchers" },
            { v: "SP", label: "Starters" },
            { v: "RP", label: "Relievers" },
          ]}
        />
      </div>
      <StatTable key={`${f.season}${f.split}`} rows={rows} cols={cols} defaultSort="csw" isQual={(r) => r.qual} highlight={(r) => r.team === league.userTeam} />
    </>
  );
}

/** Min pitches of a type for the arsenal board's "Qualified". */
const ARSENAL_QUAL = 150;

function Arsenals({ league, sc, f }: { league: League; sc: SeasonStatcast; f: F }) {
  const [type, setType] = useState("All");
  const all = useMemo(() => {
    const byId = new Map<number, Pick<PitRow, "name" | "team" | "lg" | "rookie" | "tags">>(pitchingRows(league, f.season, f.split).map((r) => [r.id, r]));
    const out: PitchRow[] = [];
    let i = 0;
    for (const a of sc.arsenal.values()) {
      const r = byId.get(a.id) ?? fallback(league, a.id);
      const x = arsenalRates(a);
      out.push({ id: (i += 1), pid: a.id, name: r.name, team: r.team, lg: r.lg, rookie: r.rookie, tags: r.tags, qual: a.n >= ARSENAL_QUAL, type: a.type, n: a.n, usage: a.usage, velo: x.velo, max: a.veloMax, spin: x.spin, ivb: x.ivb, hb: x.hb, whiff: x.whiffPct, csw: x.cswPct, ev: x.evAgainst, hard: x.hardHitPct });
    }
    return out;
  }, [league, sc, f.season, f.split]);
  const types = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of all) n.set(r.type, (n.get(r.type) ?? 0) + r.n);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [all]);
  const rows = all.filter((r) => f.keep(r, r.n) && (type === "All" || r.type === type));
  const cols: Array<Col<PitchRow>> = [
    { key: "name", label: "Name", text: true, sticky: true, get: (r) => r.name, render: (r) => <NameCell id={r.pid} name={r.name} tags={r.tags} rookie={r.rookie} /> },
    { key: "team", label: "Tm", text: true, get: (r) => league.teams[r.team]?.abbrev ?? "", render: (r) => <TeamCell league={league} id={r.team} /> },
    { key: "type", label: "Pitch", text: true, get: (r) => pitchName(r.type), render: (r) => <TypeChip t={r.type} /> },
    { key: "n", label: "#", title: "Pitches thrown", get: (r) => r.n },
    { key: "usage", label: "Usage", get: (r) => r.usage, fmt: pct1 },
    { key: "velo", label: "Velo", get: (r) => r.velo, fmt: f1, rate: true },
    { key: "max", label: "Max", get: (r) => r.max, fmt: f1 },
    { key: "spin", label: "Spin", get: (r) => r.spin, fmt: f0, rate: true },
    { key: "ivb", label: "IVB", title: "Induced vertical break (in)", get: (r) => r.ivb, fmt: f1, rate: true },
    { key: "hb", label: "HB", title: "Horizontal break (in, pitcher's view)", get: (r) => r.hb, fmt: f1, rate: true },
    rate("whiff", "Whiff%", (r) => r.whiff, pct1),
    { key: "csw", label: "CSW%", get: (r) => r.csw, fmt: pct1, rate: true },
    rate("ev", "EV", (r) => r.ev, f1, { low: true }),
    rate("hard", "Hard%", (r) => r.hard, pct1, { low: true }),
  ];
  return (
    <>
      <div className="mb-2">
        <Select label="Pitch" value={type} onChange={setType} options={[{ v: "All", label: "All pitches" }, ...types.map((t) => ({ v: t, label: pitchName(t) }))]} />
        <span className="ml-2 text-[11px] text-muted">Qualified = {ARSENAL_QUAL}+ of that pitch; other minimums count pitches.</span>
      </div>
      <StatTable key={`${f.season}${f.split}${type}`} rows={rows} cols={cols} defaultSort={type === "All" ? "whiff" : "velo"} isQual={(r) => r.qual} highlight={(r) => r.team === league.userTeam} />
    </>
  );
}

const TOP_N = 25;

function TopPlays({ league, sc, f, linkGames }: { league: League; sc: SeasonStatcast; f: F; linkGames: boolean }) {
  // Each club keeps its own top 25, so a team or league filter is exact; a name search finds
  // a player's plays when they're among his club's best.
  const pick = (k: keyof ScTops, who: "bat" | "pit", score: (m: ScMoment) => number): ScMoment[] => {
    const out: ScMoment[] = [];
    for (const [tid, tops] of sc.team) {
      for (const m of tops[k]) {
        const id = who === "bat" ? m.p.batterId : m.p.pitcherId;
        const p = league.players[id];
        const name = p?.name ?? (who === "bat" ? m.p.batterName : m.p.pitcherName);
        if (f.keep({ lg: league.teams[tid]?.league ?? null, team: tid, name, rookie: !!p?.rookie && f.season === league.season, qual: true }, Infinity)) out.push(m);
      }
    }
    return out.sort((a, b) => score(b) - score(a)).slice(0, TOP_N);
  };
  const ev = (m: ScMoment) => m.p.ev ?? 0;
  const dist = (m: ScMoment) => m.p.dist ?? 0;
  const mph = (m: ScMoment) => m.p.mph;
  return (
    <>
      <div className="grid gap-3 lg:grid-cols-3">
        <MomentList league={league} title="Hardest-hit balls" list={pick("hardestHit", "bat", ev)} value={(m) => `${f1(ev(m))} mph`} who="bat" linkGames={linkGames} />
        <MomentList league={league} title="Longest home runs" list={pick("longestHr", "bat", dist)} value={(m) => `${f0(dist(m))} ft`} who="bat" linkGames={linkGames} />
        <MomentList league={league} title="Fastest pitches" list={pick("fastest", "pit", mph)} value={(m) => `${f1(mph(m))} mph`} who="pit" linkGames={linkGames} />
      </div>
      <p className="mt-2 text-[11px] text-muted">Batted balls count for the hitter&apos;s club, pitches for the pitcher&apos;s. The minimum filter doesn&apos;t apply here.</p>
    </>
  );
}

const OUTCOME: Record<number, string> = { 1: "Single", 2: "Double", 3: "Triple", 4: "Home run" };

function MomentList({ league, title, list, value, who, linkGames }: { league: League; title: string; list: ScMoment[]; value: (m: ScMoment) => string; who: "bat" | "pit"; linkGames: boolean }) {
  const { openGame, openPlayer } = useProfiles();
  const ab = (id: number) => league.teams[id]?.abbrev ?? "?";
  return (
    <div className="min-w-0 rounded-lg border border-border">
      <h3 className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-secondary">{title}</h3>
      {!list.length && <p className="px-3 py-4 text-xs text-muted">None yet.</p>}
      <ol className="divide-y divide-border text-xs">
        {list.map((m, i) => {
          const id = who === "bat" ? m.p.batterId : m.p.pitcherId;
          const name = league.players[id]?.name ?? (who === "bat" ? m.p.batterName : m.p.pitcherName);
          const vs = who === "bat" ? `off ${league.players[m.p.pitcherId]?.name ?? m.p.pitcherName}` : `to ${league.players[m.p.batterId]?.name ?? m.p.batterName}`;
          const what = who === "bat" ? (m.p.hit ? OUTCOME[m.p.hit] : m.p.paResult ?? "Out") : `${pitchName(m.p.type)} · ${m.p.result === "ball" ? "ball" : m.p.inPlay ? "in play" : m.p.whiff ? "swinging strike" : m.p.called ? "called strike" : m.p.foul ? "foul" : m.p.result}`;
          return (
            <li key={`${m.gameId}-${m.p.n}`} className="flex items-start gap-2 px-3 py-1.5">
              <span className="w-5 shrink-0 text-right tabular-nums text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <button type="button" className="font-medium hover:text-emerald-500 hover:underline" onClick={() => openPlayer(id)}>
                  {name}
                </button>{" "}
                <span className="text-muted">{vs}</span>
                <span className="block text-[11px] text-secondary">
                  {what} ·{" "}
                  {linkGames ? (
                    <button type="button" className="hover:underline" onClick={() => openGame(m.gameId)} title="Open the game">
                      {ab(m.away)} @ {ab(m.home)}, day {m.day}
                    </button>
                  ) : (
                    `${ab(m.away)} @ ${ab(m.home)}, day ${m.day}`
                  )}
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{value(m)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
