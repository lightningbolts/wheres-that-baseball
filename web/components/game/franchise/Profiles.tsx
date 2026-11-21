"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { awardTags } from "@/lib/game/franchise/awards";
import { steamerWins, type ProjectionFile } from "@/lib/game/franchise/projections";
import { projProfile, realProfile, scProfile, talentProfile, teamProfile, type Metric, type TeamMetric } from "@/lib/game/franchise/statcast";
import { avg, batWar, era, fip, obp, pitWar, slg, whip } from "@/lib/game/franchise/stats";
import type { BatLine, League, PitLine, Player } from "@/lib/game/franchise/types";
import type { RosterFile } from "@/lib/game/types";
import { cn } from "@/lib/utils";
import { contractDetail, injuryStr, Ovr, Segmented } from "./ui";
import { f1, f2, f3, ipFmt } from "./StatTable";
import { GameDetail } from "./GameDetail";

interface Ctx {
  openPlayer: (id: number) => void;
  openTeam: (id: number) => void;
  /** A finished game's box score and play-by-play. */
  openGame: (id: number) => void;
  /** Multi-year + Steamer projection file and the real-roster snapshot, when loaded. */
  proj?: ProjectionFile;
  rosters?: RosterFile | null;
  /** The franchise's save slot (its stored game logs live under it). */
  slot?: number;
}

const ProfileCtx = createContext<Ctx>({
  openPlayer: () => {},
  openTeam: () => {},
  openGame: () => {},
});

export const useProfiles = (): Ctx => useContext(ProfileCtx);

type Open = { kind: "player"; id: number } | { kind: "team"; id: number } | { kind: "game"; id: number } | null;

/** Click any player or club name inside to open its Baseball Savant-style profile. */
export function ProfilesProvider({ league, rosters, proj, slot, children }: { league: League; rosters?: RosterFile | null; proj?: ProjectionFile; slot: number; children: ReactNode }) {
  const [stack, setStack] = useState<Open[]>([]);
  const openPlayer = useCallback((id: number) => setStack((s) => [...s, { kind: "player", id }]), []);
  const openTeam = useCallback((id: number) => setStack((s) => [...s, { kind: "team", id }]), []);
  const openGame = useCallback((id: number) => setStack((s) => [...s, { kind: "game", id }]), []);
  const ctx = useMemo(() => ({ openPlayer, openTeam, openGame, proj, rosters, slot }), [openPlayer, openTeam, openGame, proj, rosters, slot]);
  const top = stack[stack.length - 1] ?? null;
  const back = () => setStack((s) => s.slice(0, -1));
  const close = () => setStack([]);

  useEffect(() => {
    if (!top) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setStack((s) => s.slice(0, -1));
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [top]);

  return (
    <ProfileCtx.Provider value={ctx}>
      {children}
      {top && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-2 sm:p-6" onClick={close}>
          <div className="relative w-full max-w-4xl rounded-xl border border-border bg-surface p-4 shadow-2xl sm:p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-between text-xs text-secondary">
              <button type="button" className={cn("hover:text-foreground", stack.length < 2 && "invisible")} onClick={back}>
                ‹ Back
              </button>
              <button type="button" className="hover:text-foreground" onClick={close} aria-label="Close profile">
                ✕ Close
              </button>
            </div>
            {top.kind === "game" ? (
              <GameDetail key={`g${top.id}`} league={league} slot={slot} id={top.id} />
            ) : top.kind === "player" ? (
              <PlayerProfile key={`p${top.id}`} league={league} id={top.id} rosters={rosters ?? undefined} proj={proj} />
            ) : (
              <TeamProfile key={`t${top.id}`} league={league} id={top.id} rosters={rosters ?? undefined} proj={proj} />
            )}
          </div>
        </div>
      )}
    </ProfileCtx.Provider>
  );
}

// ------------------------------------------------------------- percentile bars

/** Savant's scale: deep blue (1st) → grey (50th) → deep red (100th). */
function pctColor(p: number): string {
  const blue = [50, 90, 210];
  const grey = [190, 190, 190];
  const red = [215, 40, 70];
  const t = Math.max(0, Math.min(1, p / 100));
  const [a, b, u] = t < 0.5 ? [blue, grey, t / 0.5] : [grey, red, (t - 0.5) / 0.5];
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * u));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function PctBar({ label, pct, value }: { label: string; pct: number | null; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,12.5rem)_1fr_3.8rem] items-center gap-2 py-[3px] text-xs">
      <span className="truncate text-secondary" title={label}>
        {label}
      </span>
      <div className="relative h-[14px] rounded-full bg-hover">
        {pct != null && (
          <>
            <div
              className="absolute inset-y-[5px] left-0 rounded-full"
              style={{
                width: `${pct}%`,
                background: pctColor(pct),
                opacity: 0.55,
              }}
            />
            <div
              className="absolute top-1/2 flex h-[20px] w-[20px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[10px] font-bold text-white shadow"
              style={{
                left: `${Math.max(4, Math.min(96, pct))}%`,
                background: pctColor(pct),
              }}
            >
              {pct}
            </div>
          </>
        )}
      </div>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

function MetricBars({ metrics }: { metrics: Metric[] }) {
  const shown = metrics.filter((m) => m.value != null);
  if (!shown.length) return <p className="text-xs text-muted">No data.</p>;
  return (
    <div>
      {shown.map((m) => (
        <PctBar key={m.key} label={m.label} pct={m.pct} value={m.fmt(m.value!)} />
      ))}
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border/70 p-3">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {sub && <p className="mb-1.5 text-[11px] text-muted">{sub}</p>}
      <div className={cn(!sub && "mt-1.5")}>{children}</div>
    </section>
  );
}

// ----------------------------------------------------------------- player

const pctStr = (v: number) => `${(v * 100).toFixed(1)}%`;

function PlayerProfile({ league, id, rosters, proj }: { league: League; id: number; rosters?: RosterFile; proj?: ProjectionFile }) {
  const p = league.players[id];
  const { openTeam } = useProfiles();
  const twoWay = !!p?.twoWay && !!p.bat && !!p.pit;
  const [side, setSide] = useState<"bat" | "pit">(p?.pitcher && !twoWay ? "pit" : "bat");
  if (!p) return <p className="text-sm text-secondary">Player not found.</p>;
  const pitcher = side === "pit";
  const team = league.teams[p.team];
  const real = rosters && p.real ? realProfile(rosters, p.id, pitcher) : null;
  const track = proj && p.real ? projProfile(proj, p.id, pitcher) : null;
  const sc = !pitcher && p.real ? scProfile(proj, rosters, p.id) : null;
  const pitAbs = pitcher && p.real ? scProfile(proj, undefined, p.id) : null;
  const talent = talentProfile(league, p, pitcher);
  const inj = injuryStr(p);
  const fg = proj?.players[String(p.id)]?.fg;
  const lastYear = (proj?.projSeason ?? league.season) - 1;
  const absRows = [...(sc?.abs ?? []), ...(pitAbs?.abs.filter((a) => a.role === "Pitcher") ?? [])];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        {team && <TeamLogo teamId={team.id} abbrev={team.abbrev} size={44} />}
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold leading-tight">{p.name}</h2>
          <p className="text-xs text-secondary">
            {p.pos}
            {twoWay ? " / two-way" : ""} · Age {p.age} · B/T {p.bats}/{p.throws} ·{" "}
            {team ? (
              <button type="button" className="hover:underline" onClick={() => openTeam(team.id)}>
                {team.name}
              </button>
            ) : (
              "Free agent"
            )}
            {p.rookie ? " · Rookie" : ""}
            {p.status !== "active" ? ` · ${p.status}` : ""}
            {inj ? ` · ${inj}` : ""}
          </p>
          <p className="text-xs text-muted">
            {contractDetail(p, league.season)} · {p.service.toFixed(1)} yrs service
            {p.real ? "" : " · generated player"}
          </p>
          {fg && (
            <p className="text-xs text-secondary">
              FanGraphs Steamer {proj?.projSeason}:{" "}
              {fg.bwar != null && (
                <>
                  <b>{fg.bwar.toFixed(1)} WAR</b> in {fg.pa} PA ({f3(fg.woba ?? 0)} wOBA, Def {fg.defr != null ? (fg.defr > 0 ? "+" : "") + fg.defr.toFixed(1) : "—"}, BsR {fg.bsr != null ? (fg.bsr > 0 ? "+" : "") + fg.bsr.toFixed(1) : "—"})
                </>
              )}
              {fg.bwar != null && fg.pwar != null ? " · " : ""}
              {fg.pwar != null && (
                <>
                  <b>{fg.pwar.toFixed(1)} WAR</b> in {fg.bf} BF{fg.gs ? `, ${fg.gs} GS` : ""} ({fg.fip?.toFixed(2)} FIP)
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex gap-4 text-center">
          <div>
            <div className="text-[10px] uppercase text-muted">OVR</div>
            <Ovr v={p.ovr} className="text-2xl" />
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted">POT</div>
            <Ovr v={p.pot} className="text-2xl" />
          </div>
        </div>
      </header>

      {twoWay && (
        <Segmented
          value={side}
          onChange={setSide}
          options={[
            { v: "bat", label: "Hitting" },
            { v: "pit", label: "Pitching" },
          ]}
        />
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {real ? (
          <Section title={`MLB Statcast · ${rosters?.season ?? lastYear}`} sub="Percentile ranks among MLB regulars (100+ PA / BF). Red = elite, blue = poor.">
            <MetricBars metrics={real.metrics} />
          </Section>
        ) : (
          <Section title="MLB Statcast">
            <p className="text-xs text-muted">
              {p.real ? `No ${lastYear} Statcast ${pitcher ? "pitching" : "batting"} sample (injured or in the minors).` : "Generated player: no MLB record."}
            </p>
          </Section>
        )}
        <div className="space-y-3">
          {track && (
            <Section
              title={`Track record · ${proj!.years[0]}–${proj!.years[1]}`}
              sub={`Recency-weighted, aged to ${proj!.projSeason}. ${Math.round(track.career).toLocaleString()} career ${pitcher ? "BF" : "PA"}.`}
            >
              <MetricBars metrics={track.metrics} />
            </Section>
          )}
          <Section title="Franchise talent (now)" sub="Current in-game skills vs. active MLB players; moves with development and aging.">
            <MetricBars metrics={talent} />
          </Section>
        </div>
      </div>

      {!pitcher && sc && (sc.fielding.length > 0 || sc.catching.length > 0 || sc.baserunning.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          {(sc.fielding.length > 0 || sc.catching.length > 0) && (
            <Section title={`Fielding · ${lastYear}`} sub={sc.outs ? `Fielding Run Value and tools · ${sc.outs.toLocaleString()} outs in the field` : "Fielding tools"}>
              <MetricBars metrics={sc.fielding} />
              {sc.catching.length > 0 && (
                <>
                  <p className="mb-0.5 mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Catching</p>
                  <MetricBars metrics={sc.catching} />
                </>
              )}
            </Section>
          )}
          {sc.baserunning.length > 0 && (
            <Section title={`Baserunning · ${lastYear}`} sub={sc.runnerOpps ? `Baserunning Run Value · ${sc.runnerOpps} runner opportunities` : "Speed tools"}>
              <MetricBars metrics={sc.baserunning} />
            </Section>
          )}
        </div>
      )}

      {absRows.length > 0 && (
        <Section title={`ABS challenges · ${lastYear}`} sub="Automated Ball-Strike challenges, ranked against MLB challengers in the same role.">
          <div className="grid gap-3 md:grid-cols-2">
            {absRows.map((a) => (
              <div key={a.role}>
                <p className="mb-0.5 text-xs">
                  <span className="font-semibold">As {a.role.toLowerCase()}:</span> {a.ot} of {a.n} overturned · {a.avail} missed calls against him
                </p>
                <MetricBars metrics={a.metrics} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {pitcher && rosters && real?.raw.pitch?.arsenal?.length ? <Arsenal raw={real.raw} /> : null}

      <CareerTable league={league} p={p} pitcher={pitcher} />
    </div>
  );
}

function Arsenal({ raw }: { raw: NonNullable<ReturnType<typeof realProfile>>["raw"] }) {
  const ars = [...(raw.pitch?.arsenal ?? [])].sort((a, b) => b.usage - a.usage);
  return (
    <Section title="Pitch arsenal">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-xs tabular-nums">
          <thead>
            <tr className="text-[11px] uppercase text-secondary">
              {["Pitch", "Usage", "Velo", "Spin", "Ext"].map((h, i) => (
                <th key={h} className={cn("border-b border-border px-1.5 py-1 font-semibold", i ? "text-right" : "text-left")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ars.map((a) => (
              <tr key={a.type}>
                <td className="border-b border-border/40 px-1.5 py-1">{a.name ?? a.type}</td>
                <td className="border-b border-border/40 px-1.5 py-1 text-right">{pctStr(a.usage > 1 ? a.usage / 100 : a.usage)}</td>
                <td className="border-b border-border/40 px-1.5 py-1 text-right">{a.speed?.toFixed(1) ?? "—"}</td>
                <td className="border-b border-border/40 px-1.5 py-1 text-right">{a.spin != null ? Math.round(a.spin) : "—"}</td>
                <td className="border-b border-border/40 px-1.5 py-1 text-right">{a.ext != null ? a.ext.toFixed(1) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function CareerTable({ league, p, pitcher }: { league: League; p: Player; pitcher: boolean }) {
  const { openTeam } = useProfiles();
  type Row = {
    season: number;
    team: number;
    bat?: BatLine;
    pit?: PitLine;
    tags: string;
    current?: boolean;
  };
  const rows: Row[] = [
    ...(p.history ?? []).map((h) => ({
      season: h.season,
      team: h.team,
      bat: h.bat,
      pit: h.pit,
      tags: awardTags(league, h.season, p.id).join(", "),
    })),
    {
      season: league.season,
      team: p.team,
      bat: p.stats.bat,
      pit: p.stats.pit,
      tags: awardTags(league, league.season, p.id).join(", "),
      current: true,
    },
  ].filter((r) => (pitcher ? r.pit?.bf : r.bat?.pa));
  if (!rows.length) return null;
  const cell = "border-b border-border/40 px-1.5 py-1 text-right";
  const head = pitcher
    ? ["Year", "Tm", "W", "L", "ERA", "G", "GS", "SV", "IP", "SO", "BB", "HR", "WHIP", "FIP", "WAR", "Awards"]
    : ["Year", "Tm", "G", "PA", "HR", "R", "RBI", "SB", "BB%", "K%", "AVG", "OBP", "SLG", "OPS", "WAR", "Awards"];
  return (
    <Section title="Franchise career">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-xs tabular-nums">
          <thead>
            <tr className="text-[11px] uppercase text-secondary">
              {head.map((h, i) => (
                <th key={h} className={cn("border-b border-border px-1.5 py-1 font-semibold", i < 2 || h === "Awards" ? "text-left" : "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const t = league.teams[r.team];
              const tm = (
                <td className="border-b border-border/40 px-1.5 py-1">
                  {t ? (
                    <button type="button" className="hover:underline" onClick={() => openTeam(t.id)}>
                      {t.abbrev}
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
              );
              const yr = (
                <td className="border-b border-border/40 px-1.5 py-1">
                  {r.season}
                  {r.current ? "*" : ""}
                </td>
              );
              const aw = <td className="border-b border-border/40 px-1.5 py-1 text-left text-[11px] text-emerald-600 dark:text-emerald-400">{r.tags}</td>;
              if (pitcher) {
                const s = r.pit!;
                return (
                  <tr key={r.season}>
                    {yr}
                    {tm}
                    <td className={cell}>{s.w}</td>
                    <td className={cell}>{s.l}</td>
                    <td className={cell}>{f2(era(s))}</td>
                    <td className={cell}>{s.g}</td>
                    <td className={cell}>{s.gs}</td>
                    <td className={cell}>{s.sv}</td>
                    <td className={cell}>{ipFmt(s.outs / 3)}</td>
                    <td className={cell}>{s.k}</td>
                    <td className={cell}>{s.bb}</td>
                    <td className={cell}>{s.hr}</td>
                    <td className={cell}>{f2(whip(s))}</td>
                    <td className={cell}>{f2(fip(s))}</td>
                    <td className={cell}>{f1(pitWar(s))}</td>
                    {aw}
                  </tr>
                );
              }
              const b = r.bat!;
              return (
                <tr key={r.season}>
                  {yr}
                  {tm}
                  <td className={cell}>{b.g}</td>
                  <td className={cell}>{b.pa}</td>
                  <td className={cell}>{b.hr}</td>
                  <td className={cell}>{b.r}</td>
                  <td className={cell}>{b.rbi}</td>
                  <td className={cell}>{b.sb}</td>
                  <td className={cell}>{pctStr(b.bb / b.pa)}</td>
                  <td className={cell}>{pctStr(b.k / b.pa)}</td>
                  <td className={cell}>{f3(avg(b))}</td>
                  <td className={cell}>{f3(obp(b))}</td>
                  <td className={cell}>{f3(slg(b))}</td>
                  <td className={cell}>{f3(obp(b) + slg(b))}</td>
                  <td className={cell}>{f1(batWar(p, b))}</td>
                  {aw}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-muted">* current season</p>
    </Section>
  );
}

// ------------------------------------------------------------------- team

function TeamBars({ metrics }: { metrics: TeamMetric[] }) {
  if (!metrics.length) return <p className="text-xs text-muted">No data.</p>;
  return (
    <div>
      {metrics.map((m) => (
        <PctBar key={m.key} label={`${m.label} (${ordinal(m.rank)})`} pct={m.pct} value={m.fmt(m.value)} />
      ))}
    </div>
  );
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

function TeamProfile({ league, id, rosters, proj }: { league: League; id: number; rosters?: RosterFile; proj?: ProjectionFile }) {
  const t = league.teams[id];
  const { openPlayer } = useProfiles();
  const prof = useMemo(() => (t ? teamProfile(league, id, rosters, proj) : null), [league, id, rosters, proj, t]);
  if (!t || !prof) return <p className="text-sm text-secondary">Club not found.</p>;
  const lastYear = (proj?.projSeason ?? league.season) - 1;
  const fgw = steamerWins(league, proj)?.[id];
  const active = Object.values(league.players).filter((p) => p.team === id && p.status === "active");
  const hitters = t.lineup.map((s) => ({ s, p: league.players[s.id] })).filter((x) => x.p);
  const rot = t.rotation.map((x) => league.players[x]).filter(Boolean);
  const pen = active.filter((p) => p.pitcher && !t.rotation.includes(p.id)).sort((a, b) => b.ovr - a.ovr);
  const g = t.w + t.l;
  const name = (p: Player) => (
    <button type="button" className="font-medium hover:text-emerald-500 hover:underline" onClick={() => openPlayer(p.id)}>
      {p.name}
    </button>
  );

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <TeamLogo teamId={t.id} abbrev={t.abbrev} size={52} />
        <div>
          <h2 className="text-xl font-bold leading-tight">{t.name}</h2>
          <p className="text-xs text-secondary">
            {t.league} {t.division} · {g ? `${t.w}–${t.l} (${f3(t.w / g)}) · ${t.rs - t.ra >= 0 ? "+" : ""}${t.rs - t.ra} run diff.` : "Season not started"}
          </p>
          <p className="text-xs text-secondary">
            Preseason projection {league.expected?.[t.id] ?? "—"} W{fgw ? ` · FanGraphs Steamer ${fgw.w} W (${fgw.war.toFixed(1)} roster WAR)` : ""}
          </p>
        </div>
      </header>
      <p className="text-[11px] text-muted">Ranks among all 30 clubs (1st = best). Red = top of MLB, blue = bottom.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Franchise talent" sub="Current rosters' in-game skills (lineup weighted ×3).">
          <TeamBars metrics={prof.talent} />
        </Section>
        <div className="space-y-3">
          {prof.statcast.length > 0 && (
            <Section title={`MLB Statcast · ${lastYear}`} sub="Real Savant numbers of the players on the roster now.">
              <TeamBars metrics={prof.statcast} />
            </Section>
          )}
          {prof.glove.length > 0 && (
            <Section title={`Fielding, baserunning & ABS · ${lastYear}`} sub="Summed run values of the players on the roster now.">
              <TeamBars metrics={prof.glove} />
            </Section>
          )}
          {prof.results.length > 0 && (
            <Section title={`${league.season} results`}>
              <TeamBars metrics={prof.results} />
            </Section>
          )}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Lineup">
          <table className="w-full text-xs tabular-nums">
            <tbody>
              {hitters.map(({ s, p }, i) => (
                <tr key={s.id}>
                  <td className="w-5 py-0.5 text-muted">{i + 1}</td>
                  <td className="w-8 py-0.5 text-secondary">{s.pos}</td>
                  <td className="py-0.5">{name(p)}</td>
                  <td className="py-0.5 text-right">
                    <Ovr v={p.ovr} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="Pitching staff">
          <table className="w-full text-xs tabular-nums">
            <tbody>
              {[...rot.map((p) => ["SP", p] as const), ...pen.map((p) => ["RP", p] as const)].map(([r, p]) => (
                <tr key={p.id}>
                  <td className="w-8 py-0.5 text-secondary">{r}</td>
                  <td className="py-0.5">{name(p)}</td>
                  <td className="py-0.5 text-right">
                    <Ovr v={p.ovr} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  );
}
