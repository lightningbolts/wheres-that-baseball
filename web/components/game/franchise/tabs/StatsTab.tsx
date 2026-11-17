"use client";

import { useMemo, useState } from "react";
import { GLOVE_POS, LEAGUES, RELIEF_NAME, SLUGGER_POS } from "@/lib/game/franchise/awards";
import { battingRows, pitchingRows, statSeasons, teamRows, type BatRow, type PitRow, type StatSplit, type TeamRow } from "@/lib/game/franchise/statline";
import type { AwardPick, Awards, League } from "@/lib/game/franchise/types";
import type { MLBLeague } from "@/lib/mlb/teams";
import { cn } from "@/lib/utils";
import { useProfiles } from "../Profiles";
import { f1, f2, f3, ipFmt, pct1, StatTable, type Col } from "../StatTable";
import { Card, Segmented, TeamDot, type TabProps } from "../ui";

type View = "batting" | "pitching" | "teams" | "awards";
type Scope = "MLB" | MLBLeague;
type Qual = "qual" | "50" | "100" | "250" | "all";

const sel = "rounded-md border border-border bg-background px-2 py-1 text-xs";

function Filters({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function Select<T extends string | number>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ v: T; label: string }>; label: string }) {
  return (
    <label className="flex items-center gap-1 text-xs text-secondary">
      {label}
      <select className={sel} value={String(value)} onChange={(e) => onChange((typeof value === "number" ? Number(e.target.value) : e.target.value) as T)}>
        {options.map((o) => (
          <option key={String(o.v)} value={String(o.v)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NameCell({ id, name, tags, rookie }: { id: number; name: string; tags?: string; rookie?: boolean }) {
  const { openPlayer } = useProfiles();
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" className="font-medium hover:text-emerald-500 hover:underline" onClick={() => openPlayer(id)}>
        {name}
      </button>
      {rookie && <span className="rounded bg-sky-500/15 px-1 text-[9px] font-semibold uppercase text-sky-500">R</span>}
      {tags && <span className="text-[10px] text-amber-500">{tags}</span>}
    </span>
  );
}

function TeamCell({ league, id }: { league: League; id: number }) {
  const { openTeam } = useProfiles();
  const t = league.teams[id];
  if (!t) return <span className="text-muted">FA</span>;
  return (
    <button type="button" className="hover:underline" onClick={() => openTeam(id)}>
      <TeamDot id={id} abbrev={t.abbrev} />
    </button>
  );
}

function useCommonFilters(league: League) {
  const seasons = statSeasons(league);
  const [season, setSeason] = useState(league.season);
  const [split, setSplit] = useState<StatSplit>("reg");
  const [lg, setLg] = useState<Scope>("MLB");
  const [team, setTeam] = useState<number>(0);
  const [qual, setQual] = useState<Qual>("qual");
  const [rookies, setRookies] = useState(false);
  const [q, setQ] = useState("");
  const teams = Object.values(league.teams).sort((a, b) => a.name.localeCompare(b.name));
  const ui = (
    <>
      <Select label="Season" value={season} onChange={setSeason} options={seasons.map((s) => ({ v: s, label: String(s) }))} />
      {season === league.season && (
        <Segmented
          value={split}
          onChange={setSplit}
          options={[
            { v: "reg", label: "Regular season" },
            { v: "post", label: "Postseason" },
          ]}
        />
      )}
      <Segmented
        value={lg}
        onChange={setLg}
        options={[
          { v: "MLB", label: "MLB" },
          { v: "AL", label: "AL" },
          { v: "NL", label: "NL" },
        ]}
      />
      <Select
        label="Team"
        value={team}
        onChange={setTeam}
        options={[
          { v: 0, label: "All teams" },
          { v: league.userTeam, label: `★ ${league.teams[league.userTeam].name}` },
          ...teams.filter((t) => t.id !== league.userTeam).map((t) => ({ v: t.id, label: t.name })),
        ]}
      />
      <Select
        label="Min"
        value={qual}
        onChange={setQual}
        options={[
          { v: "qual", label: "Qualified" },
          { v: "250", label: "250+" },
          { v: "100", label: "100+" },
          { v: "50", label: "50+" },
          { v: "all", label: "All" },
        ]}
      />
      <label className="flex items-center gap-1 text-xs text-secondary">
        <input type="checkbox" checked={rookies} onChange={(e) => setRookies(e.target.checked)} />
        Rookies
      </label>
      <input className={cn(sel, "w-36")} placeholder="Search player…" value={q} onChange={(e) => setQ(e.target.value)} />
    </>
  );
  const keep = <R extends { lg: MLBLeague | null; team: number; name: string; rookie: boolean; qual: boolean }>(r: R, sample: number) =>
    (lg === "MLB" || r.lg === lg) &&
    (!team || r.team === team) &&
    (!rookies || r.rookie) &&
    (!q || r.name.toLowerCase().includes(q.toLowerCase())) &&
    (qual === "all" || (qual === "qual" ? r.qual : sample >= Number(qual)));
  return { season, split: season === league.season ? split : "reg", ui, keep };
}

const BAT_POS = ["All", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "OF", "IF", "DH"] as const;

function Batting({ league }: { league: League }) {
  const f = useCommonFilters(league);
  const [pos, setPos] = useState<(typeof BAT_POS)[number]>("All");
  const [group, setGroup] = useState<"std" | "adv">("std");
  const all = useMemo(() => battingRows(league, f.season, f.split), [league, f.season, f.split]);
  const posOk = (r: BatRow) =>
    pos === "All" || (pos === "OF" ? ["LF", "CF", "RF"].includes(r.pos) : pos === "IF" ? ["1B", "2B", "3B", "SS"].includes(r.pos) : r.pos === pos);
  const rows = all.filter((r) => f.keep(r, r.pa) && posOk(r));
  const base: Array<Col<BatRow>> = [
    { key: "name", label: "Name", text: true, sticky: true, get: (r) => r.name, render: (r) => <NameCell id={r.id} name={r.name} tags={r.tags} rookie={r.rookie} /> },
    { key: "team", label: "Tm", text: true, get: (r) => league.teams[r.team]?.abbrev ?? "", render: (r) => <TeamCell league={league} id={r.team} /> },
    { key: "pos", label: "Pos", text: true, get: (r) => r.pos },
    { key: "age", label: "Age", get: (r) => r.age, low: true },
  ];
  const std: Array<Col<BatRow>> = [
    { key: "g", label: "G", get: (r) => r.g },
    { key: "pa", label: "PA", get: (r) => r.pa },
    { key: "ab", label: "AB", get: (r) => r.ab },
    { key: "r", label: "R", get: (r) => r.r },
    { key: "h", label: "H", get: (r) => r.h },
    { key: "d", label: "2B", get: (r) => r.d },
    { key: "t", label: "3B", get: (r) => r.t },
    { key: "hr", label: "HR", get: (r) => r.hr },
    { key: "rbi", label: "RBI", get: (r) => r.rbi },
    { key: "sb", label: "SB", get: (r) => r.sb },
    { key: "cs", label: "CS", get: (r) => r.cs, low: true },
    { key: "bb", label: "BB", get: (r) => r.bb },
    { key: "so", label: "SO", get: (r) => r.so, low: true },
    { key: "avg", label: "AVG", get: (r) => r.avg, fmt: f3, rate: true },
    { key: "obp", label: "OBP", get: (r) => r.obp, fmt: f3, rate: true },
    { key: "slg", label: "SLG", get: (r) => r.slg, fmt: f3, rate: true },
    { key: "ops", label: "OPS", get: (r) => r.ops, fmt: f3, rate: true },
    { key: "opsPlus", label: "OPS+", title: "OPS relative to league, 100 = average", get: (r) => r.opsPlus, rate: true },
    { key: "war", label: "WAR", get: (r) => r.war, fmt: f1 },
  ];
  const adv: Array<Col<BatRow>> = [
    { key: "pa", label: "PA", get: (r) => r.pa },
    { key: "bbPct", label: "BB%", get: (r) => r.bbPct, fmt: pct1, rate: true },
    { key: "kPct", label: "K%", get: (r) => r.kPct, fmt: pct1, rate: true, low: true },
    { key: "bbk", label: "BB/K", get: (r) => (r.so ? r.bb / r.so : r.bb), fmt: f2, rate: true },
    { key: "iso", label: "ISO", title: "Isolated power (SLG − AVG)", get: (r) => r.iso, fmt: f3, rate: true },
    { key: "babip", label: "BABIP", get: (r) => r.babip, fmt: f3, rate: true },
    { key: "avg", label: "AVG", get: (r) => r.avg, fmt: f3, rate: true },
    { key: "obp", label: "OBP", get: (r) => r.obp, fmt: f3, rate: true },
    { key: "slg", label: "SLG", get: (r) => r.slg, fmt: f3, rate: true },
    { key: "woba", label: "wOBA", get: (r) => r.woba, fmt: f3, rate: true },
    { key: "wrcPlus", label: "wRC+", title: "Runs created per PA vs league, 100 = average", get: (r) => r.wrcPlus, rate: true },
    { key: "sbPct", label: "SB%", get: (r) => (r.sb + r.cs ? r.sb / (r.sb + r.cs) : 0), fmt: pct1, rate: true },
    { key: "war", label: "WAR", get: (r) => r.war, fmt: f1 },
  ];
  return (
    <Card
      title="Batting"
      right={
        <Segmented
          value={group}
          onChange={setGroup}
          options={[
            { v: "std", label: "Standard" },
            { v: "adv", label: "Advanced" },
          ]}
        />
      }
    >
      <div className="mb-3 space-y-2">
        <Filters>{f.ui}</Filters>
        <Filters>
          <Select label="Position" value={pos} onChange={setPos} options={BAT_POS.map((p) => ({ v: p, label: p }))} />
        </Filters>
      </div>
      <StatTable
        key={`${group}${f.season}${f.split}`}
        rows={rows}
        cols={[...base, ...(group === "std" ? std : adv)]}
        defaultSort="war"
        isQual={(r) => r.qual}
        highlight={(r) => r.team === league.userTeam}
      />
    </Card>
  );
}

function Pitching({ league }: { league: League }) {
  const f = useCommonFilters(league);
  const [role, setRole] = useState<"All" | "SP" | "RP">("All");
  const [group, setGroup] = useState<"std" | "adv">("std");
  const all = useMemo(() => pitchingRows(league, f.season, f.split), [league, f.season, f.split]);
  const rows = all.filter((r) => f.keep(r, r.ip) && (role === "All" || r.role === role));
  const base: Array<Col<PitRow>> = [
    { key: "name", label: "Name", text: true, sticky: true, get: (r) => r.name, render: (r) => <NameCell id={r.id} name={r.name} tags={r.tags} rookie={r.rookie} /> },
    { key: "team", label: "Tm", text: true, get: (r) => league.teams[r.team]?.abbrev ?? "", render: (r) => <TeamCell league={league} id={r.team} /> },
    { key: "role", label: "Role", text: true, get: (r) => r.role },
    { key: "age", label: "Age", get: (r) => r.age, low: true },
  ];
  const std: Array<Col<PitRow>> = [
    { key: "w", label: "W", get: (r) => r.w },
    { key: "l", label: "L", get: (r) => r.l, low: true },
    { key: "era", label: "ERA", get: (r) => r.era, fmt: f2, low: true, rate: true },
    { key: "g", label: "G", get: (r) => r.g },
    { key: "gs", label: "GS", get: (r) => r.gs },
    { key: "sv", label: "SV", get: (r) => r.sv },
    { key: "hld", label: "HLD", get: (r) => r.hld },
    { key: "ip", label: "IP", get: (r) => r.ip, fmt: ipFmt },
    { key: "h", label: "H", get: (r) => r.h, low: true },
    { key: "r", label: "R", get: (r) => r.r, low: true },
    { key: "er", label: "ER", get: (r) => r.er, low: true },
    { key: "hr", label: "HR", get: (r) => r.hr, low: true },
    { key: "bb", label: "BB", get: (r) => r.bb, low: true },
    { key: "so", label: "SO", get: (r) => r.so },
    { key: "whip", label: "WHIP", get: (r) => r.whip, fmt: f2, low: true, rate: true },
    { key: "eraPlus", label: "ERA+", title: "League ERA ÷ ERA, 100 = average", get: (r) => r.eraPlus, rate: true },
    { key: "war", label: "WAR", get: (r) => r.war, fmt: f1 },
  ];
  const adv: Array<Col<PitRow>> = [
    { key: "ip", label: "IP", get: (r) => r.ip, fmt: ipFmt },
    { key: "k9", label: "K/9", get: (r) => r.k9, fmt: f2, rate: true },
    { key: "bb9", label: "BB/9", get: (r) => r.bb9, fmt: f2, low: true, rate: true },
    { key: "hr9", label: "HR/9", get: (r) => r.hr9, fmt: f2, low: true, rate: true },
    { key: "kPct", label: "K%", get: (r) => r.kPct, fmt: pct1, rate: true },
    { key: "bbPct", label: "BB%", get: (r) => r.bbPct, fmt: pct1, low: true, rate: true },
    { key: "kbb", label: "K-BB%", get: (r) => r.kbb, fmt: pct1, rate: true },
    { key: "babip", label: "BABIP", get: (r) => r.babip, fmt: f3, low: true, rate: true },
    { key: "era", label: "ERA", get: (r) => r.era, fmt: f2, low: true, rate: true },
    { key: "fip", label: "FIP", title: "Fielding-independent pitching", get: (r) => r.fip, fmt: f2, low: true, rate: true },
    { key: "eraMinus", label: "ERA-", title: "ERA vs league, 100 = average, lower is better", get: (r) => r.eraMinus, low: true, rate: true },
    { key: "bs", label: "BS", get: (r) => r.bs, low: true },
    { key: "war", label: "WAR", get: (r) => r.war, fmt: f1 },
  ];
  return (
    <Card
      title="Pitching"
      right={
        <Segmented
          value={group}
          onChange={setGroup}
          options={[
            { v: "std", label: "Standard" },
            { v: "adv", label: "Advanced" },
          ]}
        />
      }
    >
      <div className="mb-3 space-y-2">
        <Filters>{f.ui}</Filters>
        <Filters>
          <Segmented
            value={role}
            onChange={setRole}
            options={[
              { v: "All", label: "All pitchers" },
              { v: "SP", label: "Starters" },
              { v: "RP", label: "Relievers" },
            ]}
          />
        </Filters>
      </div>
      <StatTable
        key={`${group}${f.season}${f.split}`}
        rows={rows}
        cols={[...base, ...(group === "std" ? std : adv)]}
        defaultSort="war"
        isQual={(r) => r.qual}
        highlight={(r) => r.team === league.userTeam}
      />
    </Card>
  );
}

function Teams({ league }: { league: League }) {
  const [lg, setLg] = useState<Scope>("MLB");
  const [group, setGroup] = useState<"bat" | "pit">("bat");
  const all = useMemo(() => teamRows(league), [league]);
  const rows = all.filter((r) => lg === "MLB" || r.lg === lg);
  const base: Array<Col<TeamRow>> = [
    { key: "name", label: "Team", text: true, sticky: true, get: (r) => r.name, render: (r) => <TeamCell league={league} id={r.id} /> },
    { key: "w", label: "W", get: (r) => r.w },
    { key: "l", label: "L", get: (r) => r.l, low: true },
    { key: "pct", label: "W-L%", get: (r) => r.pct, fmt: f3 },
    { key: "rd", label: "RD", get: (r) => r.rd, fmt: (v) => (v > 0 ? `+${v}` : String(v)) },
  ];
  const bat: Array<Col<TeamRow>> = [
    { key: "rpg", label: "R/G", get: (r) => r.rpg, fmt: f2 },
    { key: "rs", label: "R", get: (r) => r.rs },
    { key: "hr", label: "HR", get: (r) => r.hr },
    { key: "sb", label: "SB", get: (r) => r.sb },
    { key: "bbPct", label: "BB%", get: (r) => r.bbPct, fmt: pct1 },
    { key: "kPct", label: "K%", get: (r) => r.kPct, fmt: pct1, low: true },
    { key: "avg", label: "AVG", get: (r) => r.avg, fmt: f3 },
    { key: "obp", label: "OBP", get: (r) => r.obp, fmt: f3 },
    { key: "slg", label: "SLG", get: (r) => r.slg, fmt: f3 },
    { key: "ops", label: "OPS", get: (r) => r.ops, fmt: f3 },
    { key: "woba", label: "wOBA", get: (r) => r.woba, fmt: f3 },
    { key: "wrcPlus", label: "wRC+", get: (r) => r.wrcPlus },
    { key: "batWar", label: "Bat WAR", get: (r) => r.batWar, fmt: f1 },
  ];
  const pit: Array<Col<TeamRow>> = [
    { key: "ra", label: "RA", get: (r) => r.ra, low: true },
    { key: "era", label: "ERA", get: (r) => r.era, fmt: f2, low: true },
    { key: "fip", label: "FIP", get: (r) => r.fip, fmt: f2, low: true },
    { key: "whip", label: "WHIP", get: (r) => r.whip, fmt: f2, low: true },
    { key: "k9", label: "K/9", get: (r) => r.k9, fmt: f2 },
    { key: "pitKPct", label: "K%", get: (r) => r.pitKPct, fmt: pct1 },
    { key: "pitBbPct", label: "BB%", get: (r) => r.pitBbPct, fmt: pct1, low: true },
    { key: "hrAllowed", label: "HR", get: (r) => r.hrAllowed, low: true },
    { key: "sv", label: "SV", get: (r) => r.sv },
    { key: "pitWar", label: "Pit WAR", get: (r) => r.pitWar, fmt: f1 },
  ];
  return (
    <Card
      title={`${league.season} team stats`}
      right={
        <div className="flex flex-wrap gap-2">
          <Segmented
            value={group}
            onChange={setGroup}
            options={[
              { v: "bat", label: "Batting" },
              { v: "pit", label: "Pitching" },
            ]}
          />
          <Segmented
            value={lg}
            onChange={setLg}
            options={[
              { v: "MLB", label: "MLB" },
              { v: "AL", label: "AL" },
              { v: "NL", label: "NL" },
            ]}
          />
        </div>
      }
    >
      <p className="mb-2 text-xs text-secondary">Click a team for its Statcast profile.</p>
      <StatTable key={group} rows={rows} cols={[...base, ...(group === "bat" ? bat : pit), { key: "war", label: "WAR", get: (r) => r.war, fmt: f1 }]} defaultSort="pct" highlight={(r) => r.id === league.userTeam} pageSize={30} />
    </Card>
  );
}

// ---------------------------------------------------------------- awards

function PickRow({ league, label, p, extra }: { league: League; label?: string; p?: AwardPick | null; extra?: string }) {
  if (!p) return null;
  const pl = league.players[p.id];
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1">
      <div className="flex items-center gap-2">
        {label && <span className="w-8 text-xs font-semibold text-secondary">{label}</span>}
        <NameCell id={p.id} name={pl?.name ?? "—"} />
        {league.teams[p.team] && <TeamDot id={p.team} abbrev={league.teams[p.team].abbrev} className="text-xs text-secondary" />}
        {extra && <span className="text-xs text-secondary">{extra}</span>}
      </div>
      <span className="text-xs tabular-nums text-secondary">{p.line}</span>
    </div>
  );
}

function Ballot({ league, title, rows, max }: { league: League; title: string; rows: AwardPick[] | undefined; max: number }) {
  if (!rows?.length) return null;
  const share = (pts: number) => `${Math.round((pts / (30 * max)) * 100)}%`;
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-secondary">{title}</h3>
      <table className="w-full text-[13px] tabular-nums">
        <thead>
          <tr className="text-[11px] uppercase text-muted">
            <th className="w-6 text-right font-medium">#</th>
            <th className="px-2 text-left font-medium">Player</th>
            <th className="px-2 text-right font-medium">Pts</th>
            <th className="px-2 text-right font-medium">Share</th>
            <th className="hidden px-2 text-left font-medium sm:table-cell">Season</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={cn("border-t border-border/40", league.players[r.id]?.team === league.userTeam && "bg-emerald-500/10", i === 0 && "font-semibold")}>
              <td className="text-right text-muted">{i + 1}</td>
              <td className="px-2 py-1">
                <span className="inline-flex flex-wrap items-center gap-1">
                  <NameCell id={r.id} name={league.players[r.id]?.name ?? "—"} />
                  {league.teams[r.team] && <span className="text-xs text-secondary">{league.teams[r.team].abbrev}</span>}
                </span>
                <div className="text-[11px] font-normal text-secondary sm:hidden">{r.line}</div>
              </td>
              <td className="px-2 text-right">{r.pts}</td>
              <td className="px-2 text-right">{share(r.pts ?? 0)}</td>
              <td className="hidden px-2 text-[12px] font-normal text-secondary sm:table-cell">{r.line}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AllStarList({ league, a, lg }: { league: League; a: Awards["allStar"]; lg: MLBLeague }) {
  const r = a?.[lg];
  if (!r) return <p className="text-sm text-secondary">Selected at the All-Star break.</p>;
  const n = (id: number) => <NameCell id={id} name={league.players[id]?.name ?? "—"} />;
  const tm = (id: number) => <span className="text-xs text-secondary">{league.teams[league.players[id]?.team]?.abbrev}</span>;
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-3">
      <div>
        <h4 className="mb-1 text-[11px] font-semibold uppercase text-secondary">Starters</h4>
        {r.starters.map((s) => (
          <div key={s.id} className="flex items-center gap-1.5">
            <span className="w-6 text-xs text-muted">{s.pos}</span>
            {n(s.id)} {tm(s.id)}
          </div>
        ))}
      </div>
      <div>
        <h4 className="mb-1 text-[11px] font-semibold uppercase text-secondary">Reserves</h4>
        {r.reserves.map((id) => (
          <div key={id} className="flex items-center gap-1.5">
            <span className="w-6 text-xs text-muted">{league.players[id]?.pos}</span>
            {n(id)} {tm(id)}
          </div>
        ))}
      </div>
      <div>
        <h4 className="mb-1 text-[11px] font-semibold uppercase text-secondary">Pitchers</h4>
        {r.pitchers.map((id) => (
          <div key={id} className="flex items-center gap-1.5">
            {n(id)} {tm(id)}
          </div>
        ))}
      </div>
    </div>
  );
}

function AwardsView({ league }: { league: League }) {
  const seasons = statSeasons(league);
  const [season, setSeason] = useState(league.awards.at(-1)?.season ?? league.season);
  const a = league.awards.find((x) => x.season === season);
  const allStar = a?.allStar ?? league.allStars?.[season];
  const nm = (id: number) => (id ? (league.players[id]?.name ?? "—") : "—");
  return (
    <div className="space-y-4">
      <Filters>
        <Select label="Season" value={season} onChange={setSeason} options={seasons.map((s) => ({ v: s, label: String(s) }))} />
      </Filters>
      {!a && <p className="text-sm text-secondary">Season awards are announced when the regular season ends{allStar ? "; All-Star rosters are below." : "."}</p>}
      {a && (
        <div className="grid gap-4 lg:grid-cols-2">
          {LEAGUES.map((lg) => (
            <Card key={lg} title={`${lg === "AL" ? "American" : "National"} League`}>
              <div className="space-y-4">
                {a.ballots ? (
                  <>
                    <Ballot league={league} title="Most Valuable Player" rows={a.ballots.mvp[lg]} max={14} />
                    <Ballot league={league} title="Cy Young Award" rows={a.ballots.cy[lg]} max={7} />
                    <Ballot league={league} title="Rookie of the Year" rows={a.ballots.roy[lg]} max={5} />
                  </>
                ) : (
                  <div className="text-sm">
                    MVP {nm(a.mvp[lg])} · Cy Young {nm(a.cy[lg])} · Rookie {nm(a.roy[lg])}
                  </div>
                )}
                {(a.relief?.[lg] || a.aaron?.[lg]) && (
                  <div>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-secondary">More honors</h3>
                    {a.aaron?.[lg] && <PickRow league={league} p={a.aaron[lg]} extra="Hank Aaron Award" />}
                    {a.relief?.[lg] && <PickRow league={league} p={a.relief[lg]} extra={RELIEF_NAME[lg].replace(/ (AL|NL) /, " ")} />}
                  </div>
                )}
                {a.silver && (
                  <div>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-secondary">Silver Sluggers</h3>
                    {SLUGGER_POS.map((p) => (
                      <PickRow key={p} league={league} label={p} p={a.silver![lg][p]} />
                    ))}
                  </div>
                )}
                {a.gold && (
                  <div>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-secondary">Gold Gloves</h3>
                    {GLOVE_POS.map((p) => (
                      <PickRow key={p} league={league} label={p} p={a.gold![lg][p]} />
                    ))}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      {allStar && (
        <div className="grid gap-4 lg:grid-cols-2">
          {LEAGUES.map((lg) => (
            <Card key={lg} title={`${season} ${lg} All-Stars`}>
              <AllStarList league={league} a={allStar} lg={lg} />
            </Card>
          ))}
        </div>
      )}
      <AwardHistory league={league} />
    </div>
  );
}

function AwardHistory({ league }: { league: League }) {
  if (!league.awards.length && !league.champions.length) return null;
  const champ = (s: number) => league.champions.find((c) => c.season === s);
  const rows = [...league.awards].reverse();
  const nm = (id?: number) => (id ? <NameCell id={id} name={league.players[id]?.name ?? "—"} /> : <span className="text-muted">—</span>);
  return (
    <Card title="Franchise history">
      <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        <table className="w-full min-w-max text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase text-secondary">
              {["Year", "Champion", "Lg", "MVP", "Cy Young", "Rookie", "Hank Aaron", "Reliever"].map((h) => (
                <th key={h} className="border-b border-border px-2 py-1.5 text-left font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((a) =>
              LEAGUES.map((lg, i) => (
                <tr key={`${a.season}${lg}`} className="border-b border-border/40">
                  {i === 0 && (
                    <>
                      <td rowSpan={2} className="px-2 py-1 align-top font-semibold">
                        {a.season}
                      </td>
                      <td rowSpan={2} className="px-2 py-1 align-top">
                        {champ(a.season) ? <TeamDot id={champ(a.season)!.team} abbrev={league.teams[champ(a.season)!.team]?.abbrev ?? ""} /> : <span className="text-muted">—</span>}
                      </td>
                    </>
                  )}
                  <td className="px-2 py-1 text-secondary">{lg}</td>
                  <td className="px-2 py-1">{nm(a.mvp[lg])}</td>
                  <td className="px-2 py-1">{nm(a.cy[lg])}</td>
                  <td className="px-2 py-1">{nm(a.roy[lg])}</td>
                  <td className="px-2 py-1">{nm(a.aaron?.[lg]?.id)}</td>
                  <td className="px-2 py-1">{nm(a.relief?.[lg]?.id)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function StatsTab({ league }: TabProps) {
  const [view, setView] = useState<View>("batting");
  return (
    <div className="space-y-4">
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { v: "batting", label: "Batting" },
          { v: "pitching", label: "Pitching" },
          { v: "teams", label: "Teams" },
          { v: "awards", label: "Awards & All-Stars" },
        ]}
      />
      {view === "batting" && <Batting league={league} />}
      {view === "pitching" && <Pitching league={league} />}
      {view === "teams" && <Teams league={league} />}
      {view === "awards" && <AwardsView league={league} />}
    </div>
  );
}
