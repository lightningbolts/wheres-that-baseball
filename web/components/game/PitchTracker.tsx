"use client";

/**
 * Statcast-style pitch tracking for the game being played: this at-bat pitch by pitch,
 * each pitcher's arsenal (velocity, spin, movement, whiffs, CSW, chase…) with a
 * movement chart, and the full pitch log. Colours match the rest of WTBB.
 */
import { useMemo, useState, type ReactNode } from "react";
import { pitchName } from "@/components/game/controller";
import { MARK_BALL_R, MARK_COLOR, zoneBox } from "@/components/game/scene/view";
import { ariaSort, sortRows, useSort, type SortState, type SortVal } from "@/components/game/sort";
import { battingSide, gameSummary, isSweetSpot, type Side, type StarterMix, type TeamBatting, type TeamPitching } from "@/lib/game/stats/gameSummary";
import { arsenalSummary, pitchersInLog, type ArsenalLine, type PitchRecord } from "@/lib/game/stats/pitchLog";

/** Baseball Savant's pitch-type colours (movement chart and type chips). */
export const PITCH_TYPE_COLOR: Record<string, string> = {
  FF: "#d22d49",
  FA: "#d22d49",
  SI: "#fe9d00",
  FC: "#933f2c",
  SL: "#eee716",
  ST: "#ddb33a",
  SV: "#93afd4",
  CU: "#00d1ed",
  KC: "#6236cd",
  CS: "#0068ff",
  CH: "#1dbe3a",
  FS: "#3bacac",
  FO: "#55ccab",
  SC: "#60db33",
  KN: "#3c44cd",
  EP: "#888888",
};
const typeColor = (t: string) => PITCH_TYPE_COLOR[t] ?? "#9ca3af";

/** The record's result in WTBB / Gameday colours. */
export function recordKind(p: PitchRecord): keyof typeof MARK_COLOR {
  if (p.result === "hbp") return "hbp";
  if (p.inPlay) return p.hit === 0 && p.paResult !== "Reached on error" ? "in_play_out" : "in_play";
  if (p.result === "ball") return "ball";
  if (p.foul) return "foul";
  return p.called ? "called_strike" : "swinging_strike";
}

export function recordText(p: PitchRecord): string {
  if (p.inPlay) return p.paResult ?? "In play";
  if (p.foul && p.result === "in_play") return p.bunt ? "Foul bunt" : "Foul";
  switch (p.result) {
    case "ball":
      return p.paResult === "Walk" ? "Ball 4 — walk" : "Ball";
    case "called_strike":
      return p.paResult === "Strikeout" ? "Called strike 3" : "Called strike";
    case "swinging_strike":
      return p.bunt ? "Missed bunt" : p.paResult === "Strikeout" ? "Swinging strike 3" : "Swinging strike";
    case "foul_tip":
      return p.paResult === "Strikeout" ? "Foul tip — strike 3" : "Foul tip";
    case "foul":
      return p.paResult === "Strikeout" ? "Foul bunt — strike 3" : p.bunt ? "Foul bunt" : "Foul";
    case "hbp":
      return "Hit by pitch";
    default:
      return p.paResult ?? "In play";
  }
}

const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}`);
const num = (x: number | null, d = 1) => (x == null ? "—" : x.toFixed(d));
/** Horizontal break with the side it moves to, from the pitcher's point of view. */
function hbText(hb: number, throws: "L" | "R"): string {
  const arm = throws === "R" ? -hb : hb;
  const side = Math.abs(arm) < 0.5 ? "" : arm > 0 ? " arm" : " glove";
  return `${Math.abs(hb).toFixed(1)}″${side}`;
}
/** Horizontal break signed toward the pitcher's arm side, for sorting. */
const armHb = (hb: number, throws: "L" | "R") => (throws === "R" ? -hb : hb);

/** Clickable, keyboard-reachable sort header: ▲ ascending, ▼ descending, on the active column. */
function SortTh({
  k,
  label,
  title,
  sort,
  onSort,
  firstAsc = false,
  left = false,
  className = "",
}: {
  k: string;
  label: string;
  title?: string;
  sort: SortState;
  onSort: (k: string, firstAsc?: boolean) => void;
  firstAsc?: boolean;
  left?: boolean;
  className?: string;
}) {
  const active = sort.key === k;
  return (
    <th aria-sort={ariaSort(sort, k)} title={title} className={`px-1.5 py-1.5 font-medium ${left ? "text-left" : "text-right"} ${className}`}>
      <button type="button" onClick={() => onSort(k, firstAsc)} className={`inline-flex items-center gap-0.5 whitespace-nowrap hover:text-white ${active ? "text-emerald-300" : ""}`}>
        {label}
        <span aria-hidden className={`w-2 text-[8px] ${active ? "" : "opacity-0"}`}>
          {active && sort.asc ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

function ResultDot({ p, size = 22 }: { p: PitchRecord; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ width: size, height: size, backgroundColor: MARK_COLOR[recordKind(p)] }}>
      {p.paPitch}
    </span>
  );
}

function TypeChip({ t }: { t: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: typeColor(t) }} />
      {pitchName(t)}
    </span>
  );
}

/* ---------- strike zone and movement charts ---------- */

const ZX = (px: number) => 50 + px * 26;
const ZY = (pz: number) => 118 - pz * 26;
const ZR = MARK_BALL_R * 26;

function ZoneChart({ pitches, zone, size = 190 }: { pitches: PitchRecord[]; zone: { bottom: number; top: number }; size?: number }) {
  const b = zoneBox(zone.bottom, zone.top);
  return (
    <svg width={size} height={size * 1.26} viewBox="-6 4 112 126" role="img" aria-label="Pitch locations, catcher's view">
      <rect x={ZX(b.x0)} y={ZY(b.y1)} width={ZX(b.x1) - ZX(b.x0)} height={ZY(b.y0) - ZY(b.y1)} fill="rgba(255,255,255,0.06)" stroke="#fff" strokeOpacity={0.8} strokeWidth={1.2} />
      {[1, 2].map((i) => (
        <g key={i} stroke="#fff" strokeOpacity={0.18} strokeWidth={0.6}>
          <line x1={ZX(b.x0 + ((b.x1 - b.x0) * i) / 3)} x2={ZX(b.x0 + ((b.x1 - b.x0) * i) / 3)} y1={ZY(b.y1)} y2={ZY(b.y0)} />
          <line y1={ZY(b.y0 + ((b.y1 - b.y0) * i) / 3)} y2={ZY(b.y0 + ((b.y1 - b.y0) * i) / 3)} x1={ZX(b.x0)} x2={ZX(b.x1)} />
        </g>
      ))}
      <path d={`M${ZX(-0.708)} 124 L${ZX(0.708)} 124 L${ZX(0.708)} 126.5 L50 129 L${ZX(-0.708)} 126.5 Z`} fill="#e5e7eb" opacity={0.7} />
      {pitches.map((p) => (
        <g key={p.n}>
          <circle cx={ZX(p.px)} cy={ZY(p.pz)} r={ZR} fill={MARK_COLOR[recordKind(p)]} stroke="#0a0f18" strokeWidth={0.6} />
          <text x={ZX(p.px)} y={ZY(p.pz) + 2.3} textAnchor="middle" fontSize={6.2} fontWeight={700} fill="#fff">
            {p.paPitch}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Savant-style movement plot: induced vertical break vs horizontal break, pitcher's view. */
function MovementChart({ pitches, throws }: { pitches: PitchRecord[]; throws: "L" | "R" }) {
  const R = 24;
  const W = 220;
  const s = (W / 2 - 14) / R;
  // Pitcher's view (catcher's-view pfx_x flipped): third-base side on the right, so a righty's arm side.
  const X = (hb: number) => W / 2 - hb * s;
  const Y = (ivb: number) => W / 2 - ivb * s;
  const types = [...new Set(pitches.map((p) => p.type))];
  return (
    <figure className="flex flex-col items-center">
      <svg width={W} height={W} viewBox={`0 0 ${W} ${W}`} role="img" aria-label="Pitch movement chart">
        <rect x={0} y={0} width={W} height={W} rx={8} fill="rgba(255,255,255,0.03)" />
        {[-18, -12, -6, 6, 12, 18].map((v) => (
          <g key={v} stroke="#fff" strokeOpacity={0.07}>
            <line x1={X(v)} x2={X(v)} y1={8} y2={W - 8} />
            <line y1={Y(v)} y2={Y(v)} x1={8} x2={W - 8} />
          </g>
        ))}
        <line x1={X(0)} x2={X(0)} y1={8} y2={W - 8} stroke="#fff" strokeOpacity={0.3} />
        <line y1={Y(0)} y2={Y(0)} x1={8} x2={W - 8} stroke="#fff" strokeOpacity={0.3} />
        {pitches.map((p) => (
          <circle key={p.n} cx={X(p.hb)} cy={Y(p.ivb)} r={3.6} fill={typeColor(p.type)} fillOpacity={0.85} stroke="#000" strokeOpacity={0.5} strokeWidth={0.6} />
        ))}
        <text x={W - 10} y={Y(0) - 4} textAnchor="end" fontSize={8} fill="#fff" fillOpacity={0.45}>
          {throws === "R" ? "arm side →" : "glove side →"}
        </text>
        <text x={10} y={Y(0) - 4} fontSize={8} fill="#fff" fillOpacity={0.45}>
          {throws === "R" ? "← glove side" : "← arm side"}
        </text>
        <text x={X(0) + 4} y={16} fontSize={8} fill="#fff" fillOpacity={0.45}>
          +{R}″ ride
        </text>
        <text x={X(0) + 4} y={W - 10} fontSize={8} fill="#fff" fillOpacity={0.45}>
          −{R}″ drop
        </text>
      </svg>
      <figcaption className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-white/70">
        {types.map((t) => (
          <TypeChip key={t} t={t} />
        ))}
      </figcaption>
    </figure>
  );
}

/* ---------- tabs ---------- */

function AtBatTab({ log, zone }: { log: PitchRecord[]; zone: { bottom: number; top: number } }) {
  const last = log[log.length - 1];
  const pas = useMemo(() => [...new Set(log.map((p) => p.pa))].reverse(), [log]);
  const [pa, setPa] = useState<number | null>(null);
  if (!last) return <Empty />;
  const which = pa ?? last.pa;
  const ps = log.filter((p) => p.pa === which);
  const i = pas.indexOf(which);
  const head = ps[0];
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2 text-sm">
        <button type="button" className="rounded px-2 py-1 hover:bg-white/10 disabled:opacity-30" disabled={i >= pas.length - 1} onClick={() => setPa(pas[i + 1])} aria-label="Previous at-bat">
          ‹
        </button>
        <div className="min-w-0 text-center">
          <div className="truncate font-semibold">
            {head.batterName} <span className="font-normal text-white/50">vs</span> {head.pitcherName}
          </div>
          <div className="text-xs text-white/55">
            {head.top ? "Top" : "Bottom"} {head.inning} · {head.outs} out · {ps[ps.length - 1].paResult ?? "at-bat in progress"}
          </div>
        </div>
        <button type="button" className="rounded px-2 py-1 hover:bg-white/10 disabled:opacity-30" disabled={i <= 0} onClick={() => setPa(pas[i - 1])} aria-label="Next at-bat">
          ›
        </button>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex justify-center sm:block">
          <ZoneChart pitches={ps} zone={zone} />
        </div>
        <ul className="min-w-0 flex-1 divide-y divide-white/10 text-[13px]">
          {ps.map((p) => (
            <li key={p.n} className="flex items-start gap-2.5 py-2">
              <ResultDot p={p} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{recordText(p)}</div>
                <div className="text-white/60">
                  {p.mph.toFixed(1)} mph <TypeChip t={p.type} />
                </div>
                <div className="font-mono text-[11px] tabular-nums text-white/50">
                  {Math.round(p.spinRpm)} rpm · IVB {p.ivb.toFixed(1)}″ · HB {hbText(p.hb, p.pThrows)}
                  {p.ext != null && ` · ext ${p.ext.toFixed(1)} ft`}
                </div>
                {p.ev != null && (
                  <div className="font-mono text-[11px] tabular-nums text-white/70">
                    EV {p.ev.toFixed(1)} mph · LA {Math.round(p.la ?? 0)}°{p.dist != null && ` · ${Math.round(p.dist)} ft`}
                    {p.barrel ? " · Barrel" : p.hardHit ? " · Hard-hit" : ""}
                  </div>
                )}
              </div>
              <span className="shrink-0 font-mono text-xs tabular-nums text-white/55">
                {p.balls}-{p.strikes}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const COLS: Array<{ k: string; label: string; title: string; v: (l: ArsenalLine, throws: "L" | "R") => string; s: (l: ArsenalLine, throws: "L" | "R") => SortVal }> = [
  { k: "n", label: "#", title: "Pitches", v: (l) => String(l.n), s: (l) => l.n },
  { k: "use", label: "Use%", title: "Usage", v: (l) => pct(l.usage), s: (l) => l.usage },
  { k: "mph", label: "Velo", title: "Average release speed, mph", v: (l) => num(l.mph), s: (l) => l.mph },
  { k: "max", label: "Max", title: "Top speed, mph", v: (l) => num(l.mphMax), s: (l) => l.mphMax },
  { k: "spr", label: "Spread", title: "Velocity spread (slowest–fastest), mph", v: (l) => (l.n > 1 ? `${l.mphMin.toFixed(0)}–${l.mphMax.toFixed(0)}` : "—"), s: (l) => (l.n > 1 ? l.mphMax - l.mphMin : null) },
  { k: "spin", label: "Spin", title: "Spin rate, rpm", v: (l) => Math.round(l.spinRpm).toString(), s: (l) => l.spinRpm },
  { k: "ivb", label: "IVB", title: "Induced vertical break, in", v: (l) => num(l.ivb), s: (l) => l.ivb },
  { k: "hb", label: "HB", title: "Horizontal break, in (arm / glove side; sorts by arm-side run)", v: (l, t) => hbText(l.hb, t), s: (l, t) => armHb(l.hb, t) },
  { k: "ext", label: "Ext", title: "Extension, ft", v: (l) => num(l.ext), s: (l) => l.ext },
  { k: "loc", label: "Loc±", title: "Location spread (SD from the average spot), in", v: (l) => (l.n > 1 ? num(l.locSpreadIn, 0) : "—"), s: (l) => (l.n > 1 ? l.locSpreadIn : null) },
  { k: "zone", label: "Zone%", title: "In the strike zone", v: (l) => pct(l.zonePct), s: (l) => l.zonePct },
  { k: "sw", label: "Swing%", title: "Swing rate", v: (l) => pct(l.swingPct), s: (l) => l.swingPct },
  { k: "wh", label: "Whiff%", title: "Whiffs per swing", v: (l) => pct(l.whiffPct), s: (l) => l.whiffPct },
  { k: "csw", label: "CSW%", title: "Called strikes + whiffs per pitch", v: (l) => pct(l.cswPct), s: (l) => l.cswPct },
  { k: "ch", label: "Chase%", title: "Swings at pitches outside the zone", v: (l) => pct(l.chasePct), s: (l) => l.chasePct },
  { k: "pa", label: "PutAway%", title: "Two-strike pitches that ended in a strikeout", v: (l) => pct(l.putAwayPct), s: (l) => l.putAwayPct },
  { k: "k", label: "K", title: "Strikeouts", v: (l) => String(l.ks), s: (l) => l.ks },
  { k: "h", label: "H", title: "Hits allowed", v: (l) => String(l.hits), s: (l) => l.hits },
  { k: "ev", label: "EV", title: "Average exit velocity on balls in play, mph", v: (l) => num(l.evAvg), s: (l) => l.evAvg },
  { k: "hh", label: "HH%", title: "Hard-hit rate (95+ mph)", v: (l) => pct(l.hardHitPct), s: (l) => l.hardHitPct },
];

function ArsenalTab({ log, currentPitcherId }: { log: PitchRecord[]; currentPitcherId: number | null }) {
  const pitchers = useMemo(() => pitchersInLog(log), [log]);
  const [pick, setPick] = useState<number | null>(null);
  const id = pick ?? (pitchers.some((p) => p.id === currentPitcherId) ? currentPitcherId : pitchers[pitchers.length - 1]?.id) ?? null;
  const me = pitchers.find((p) => p.id === id);
  const { lines, all } = useMemo(() => (id == null ? { lines: [], all: null } : arsenalSummary(log, id)), [log, id]);
  const { sort, toggle } = useSort({ key: "n", asc: false });
  if (!me || !all) return <Empty />;
  // A handful of rows: no need to memoise the sort.
  const col = COLS.find((x) => x.k === sort.key);
  const sorted = sortRows(lines, (l) => (col ? col.s(l, me.throws) : pitchName(l.type)), sort.asc);
  const mine = log.filter((p) => p.pitcherId === id);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {pitchers.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPick(p.id)}
            className={`rounded-md border px-2.5 py-1 text-xs ${p.id === id ? "border-white/40 bg-white/15" : "border-white/10 hover:bg-white/10"}`}
          >
            {p.name} <span className="text-white/50">({p.throws}HP · {p.n})</span>
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-right text-xs tabular-nums">
          <thead className="text-white/55">
            <tr className="border-b border-white/10">
              <SortTh k="type" label="Pitch" sort={sort} onSort={toggle} firstAsc left className="pl-0 pr-2" />
              {COLS.map((c) => (
                <SortTh key={c.k} k={c.k} label={c.label} title={c.title} sort={sort} onSort={toggle} />
              ))}
            </tr>
          </thead>
          <tbody>
            {[...sorted, all].map((l) => (
              <tr key={l.type} className={`border-b border-white/5 ${l.type === "All" ? "font-semibold text-white" : "text-white/85"}`}>
                <td className="py-1.5 pr-2 text-left">{l.type === "All" ? "All pitches" : <TypeChip t={l.type} />}</td>
                {COLS.map((c) => (
                  <td key={c.k} className="px-1.5 py-1.5 font-mono">
                    {c.v(l, me.throws)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-col items-center gap-2 sm:flex-row sm:items-start sm:justify-center sm:gap-8">
        <MovementChart pitches={mine} throws={me.throws} />
        <p className="max-w-xs text-xs leading-relaxed text-white/55">
          Movement is measured against a spinless ball from the same release, like Savant&apos;s induced vertical break (IVB) and horizontal break (HB). Whiff% is whiffs per swing; CSW% is called strikes plus whiffs per pitch; chase is swings at pitches outside the zone.
        </p>
      </div>
    </div>
  );
}

const LOG_COLS: Array<{ k: string; label: string; title?: string; text?: boolean; s: (p: PitchRecord) => SortVal; r: (p: PitchRecord) => ReactNode; cls?: string }> = [
  { k: "n", label: "Inn", title: "Inning (sorts in pitch order)", text: true, s: (p) => p.n, r: (p) => `${p.top ? "▲" : "▼"}${p.inning}` },
  { k: "pitcher", label: "Pitcher", text: true, s: (p) => p.pitcherName, r: (p) => p.pitcherName, cls: "max-w-[120px] truncate" },
  { k: "batter", label: "Batter", text: true, s: (p) => p.batterName, r: (p) => p.batterName, cls: "max-w-[120px] truncate" },
  { k: "count", label: "Count", text: true, s: (p) => p.balls * 10 + p.strikes, r: (p) => `${p.balls}-${p.strikes}`, cls: "font-mono" },
  { k: "type", label: "Pitch", text: true, s: (p) => pitchName(p.type), r: (p) => <TypeChip t={p.type} /> },
  { k: "mph", label: "Velo", title: "Release speed, mph", s: (p) => p.mph, r: (p) => p.mph.toFixed(1), cls: "font-mono" },
  { k: "spin", label: "Spin", title: "Spin rate, rpm", s: (p) => p.spinRpm, r: (p) => Math.round(p.spinRpm), cls: "font-mono" },
  { k: "ivb", label: "IVB", title: "Induced vertical break, in", s: (p) => p.ivb, r: (p) => p.ivb.toFixed(1), cls: "font-mono" },
  { k: "hb", label: "HB", title: "Horizontal break (sorts by arm-side run)", s: (p) => armHb(p.hb, p.pThrows), r: (p) => hbText(p.hb, p.pThrows), cls: "font-mono" },
  {
    k: "result",
    label: "Result",
    text: true,
    s: (p) => recordText(p),
    r: (p) => (
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: MARK_COLOR[recordKind(p)] }} />
        {recordText(p)}
      </span>
    ),
  },
  { k: "ev", label: "EV", title: "Exit velocity, mph", s: (p) => p.ev, r: (p) => num(p.ev), cls: "font-mono" },
  { k: "la", label: "LA", title: "Launch angle, °", s: (p) => p.la, r: (p) => (p.la == null ? "—" : Math.round(p.la)), cls: "font-mono" },
  { k: "dist", label: "Dist", title: "Projected distance, ft", s: (p) => p.dist, r: (p) => (p.dist == null ? "—" : Math.round(p.dist)), cls: "font-mono" },
];

function LogTab({ log }: { log: PitchRecord[] }) {
  // Newest pitch first by default, as before.
  const { sort, toggle } = useSort({ key: "n", asc: false });
  const rows = useMemo(() => {
    const c = LOG_COLS.find((x) => x.k === sort.key) ?? LOG_COLS[0];
    return sortRows(log, c.s, sort.asc).slice(0, 400);
  }, [log, sort]);
  if (!rows.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-xs tabular-nums">
        <thead className="text-white/55">
          <tr className="border-b border-white/10">
            {LOG_COLS.map((c) => (
              <SortTh key={c.k} k={c.k} label={c.label} title={c.title} sort={sort} onSort={toggle} firstAsc={!!c.text && c.k !== "n"} left />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.n} className="border-b border-white/5 text-white/85">
              {LOG_COLS.map((c) => (
                <td key={c.k} className={`px-1.5 py-1 ${c.cls ?? ""}`}>
                  {c.r(p)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- game summary ---------- */

type Teams = Record<Side, string>;

function Tile({ label, value, unit, who, sub }: { label: string; value: ReactNode; unit?: string; who?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2">
      <div className="truncate text-[10px] font-medium uppercase tracking-wide text-white/50">{label}</div>
      <div className="font-mono text-lg font-semibold leading-tight tabular-nums">
        {value}
        {unit && <span className="ml-0.5 text-xs font-normal text-white/55">{unit}</span>}
      </div>
      {who && <div className="truncate text-xs text-white/85">{who}</div>}
      {sub && <div className="line-clamp-2 text-[11px] leading-snug text-white/50">{sub}</div>}
    </div>
  );
}

const half = (p: PitchRecord) => `${p.top ? "▲" : "▼"}${p.inning}`;
const bbSub = (p: PitchRecord, teams: Teams) =>
  [teams[battingSide(p)], p.paResult ?? "In play", p.la != null ? `LA ${Math.round(p.la)}°` : null, p.dist != null ? `${Math.round(p.dist)} ft` : null, half(p)].filter(Boolean).join(" · ");

type Metric<T> = { label: string; title: string; get: (t: T) => number | null; fmt: (v: number) => string; low?: boolean; /** No "better" side to highlight. */ neutral?: boolean };
const pctFmt = (v: number) => `${Math.round(v * 100)}%`;
const BAT_METRICS: Array<Metric<TeamBatting>> = [
  { label: "Avg EV", title: "Average exit velocity on batted balls, mph", get: (t) => t.evAvg, fmt: (v) => v.toFixed(1) },
  { label: "Max EV", title: "Hardest-hit ball, mph", get: (t) => t.evMax, fmt: (v) => v.toFixed(1) },
  { label: "Hard-hit%", title: "Batted balls at 95+ mph", get: (t) => t.hardHitPct, fmt: pctFmt },
  { label: "Barrels", title: "Statcast barrels (ideal EV + launch angle)", get: (t) => t.barrels, fmt: String },
  { label: "Sweet-spot%", title: "Batted balls at 8–32° launch angle", get: (t) => t.sweetSpotPct, fmt: pctFmt },
  { label: "Avg LA", title: "Average launch angle, °", get: (t) => t.laAvg, fmt: (v) => `${Math.round(v)}°`, neutral: true },
  { label: "Batted balls", title: "Tracked batted-ball events", get: (t) => t.bbe, fmt: String, neutral: true },
];
const PIT_METRICS: Array<Metric<TeamPitching>> = [
  { label: "CSW%", title: "Called strikes + whiffs per pitch", get: (t) => t.cswPct, fmt: pctFmt },
  { label: "Whiff%", title: "Whiffs per swing", get: (t) => t.whiffPct, fmt: pctFmt },
  { label: "Chase%", title: "Swings at pitches outside the zone", get: (t) => t.chasePct, fmt: pctFmt },
  { label: "Zone%", title: "Pitches in the strike zone", get: (t) => t.zonePct, fmt: pctFmt, neutral: true },
  { label: "Strikeouts", title: "Strikeouts", get: (t) => t.ks, fmt: String },
  { label: "FB velo", title: "Average four-seam / sinker speed, mph", get: (t) => t.fbVelo, fmt: (v) => v.toFixed(1) },
  { label: "Top velo", title: "Fastest pitch, mph", get: (t) => t.veloMax, fmt: (v) => v.toFixed(1) },
  { label: "Pitches", title: "Pitches thrown", get: (t) => t.pitches, fmt: String, neutral: true },
];

function Compare<T>({ title, metrics, data, teams }: { title: string; metrics: Array<Metric<T>>; data: Record<Side, T>; teams: Teams }) {
  return (
    <table className="w-full text-xs tabular-nums">
      <thead className="text-white/55">
        <tr className="border-b border-white/10">
          <th className="py-1 text-left font-medium">{title}</th>
          <th className="w-16 py-1 text-right font-medium">{teams.away}</th>
          <th className="w-16 py-1 text-right font-medium">{teams.home}</th>
        </tr>
      </thead>
      <tbody>
        {metrics.map((m) => {
          const a = m.get(data.away);
          const h = m.get(data.home);
          const best = m.neutral || a == null || h == null || a === h ? null : (m.low ? a < h : a > h) ? "away" : "home";
          return (
            <tr key={m.label} className="border-b border-white/5" title={m.title}>
              <td className="py-1 text-white/70">{m.label}</td>
              {(["away", "home"] as const).map((s) => {
                const v = s === "away" ? a : h;
                return (
                  <td key={s} className={`py-1 text-right font-mono ${best === s ? "font-bold text-emerald-300" : "text-white/85"}`}>
                    {v == null ? "—" : m.fmt(v)}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MixCard({ s, teams }: { s: StarterMix; teams: Teams }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.04] p-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <div className="min-w-0 text-sm font-semibold">
          {s.name} <span className="font-normal text-white/50">{teams[s.side]} · {s.throws}HP</span>
        </div>
        <div className="shrink-0 font-mono text-[11px] tabular-nums text-white/55">
          {s.pitches} P · {s.ks} K · CSW {pctFmt(s.cswPct)}
        </div>
      </div>
      <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-white/5" role="img" aria-label={`${s.name} pitch mix`}>
        {s.mix.map((m) => (
          <span key={m.type} style={{ width: `${m.usage * 100}%`, backgroundColor: typeColor(m.type) }} title={`${pitchName(m.type)} ${pctFmt(m.usage)}`} />
        ))}
      </div>
      <ul className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-0.5 text-[11px] text-white/75 min-[420px]:grid-cols-2">
        {s.mix.map((m) => (
          <li key={m.type} className="flex items-center justify-between gap-2">
            <TypeChip t={m.type} />
            <span className="font-mono tabular-nums text-white/60">
              {pctFmt(m.usage)} · {m.mph.toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const BB_COLS: Array<{ k: string; label: string; title?: string; text?: boolean; s: (p: PitchRecord) => SortVal; r: (p: PitchRecord, t: Teams) => ReactNode; cls?: string }> = [
  { k: "n", label: "Inn", title: "Inning (sorts in game order)", text: true, s: (p) => p.n, r: half },
  { k: "team", label: "Tm", title: "Batting team", text: true, s: (p) => battingSide(p), r: (p, t) => t[battingSide(p)] },
  { k: "batter", label: "Batter", text: true, s: (p) => p.batterName, r: (p) => p.batterName, cls: "max-w-[130px] truncate" },
  { k: "ev", label: "EV", title: "Exit velocity, mph", s: (p) => p.ev, r: (p) => num(p.ev), cls: "font-mono text-right" },
  { k: "la", label: "LA", title: "Launch angle, °", s: (p) => p.la, r: (p) => (p.la == null ? "—" : Math.round(p.la)), cls: "font-mono text-right" },
  { k: "dist", label: "Dist", title: "Projected distance, ft", s: (p) => p.dist, r: (p) => (p.dist == null ? "—" : Math.round(p.dist)), cls: "font-mono text-right" },
  { k: "result", label: "Result", text: true, s: (p) => p.paResult ?? "", r: (p) => p.paResult ?? "In play" },
  {
    k: "q",
    label: "Quality",
    title: "Barrel > hard-hit (95+) > sweet spot (8–32°)",
    s: (p) => (p.barrel ? 3 : p.hardHit ? 2 : p.la != null && isSweetSpot(p.la) ? 1 : 0),
    r: (p) => (p.barrel ? "Barrel" : p.hardHit ? "Hard-hit" : p.la != null && isSweetSpot(p.la) ? "Sweet spot" : ""),
    cls: "text-white/60",
  },
  { k: "pitcher", label: "Pitcher", text: true, s: (p) => p.pitcherName, r: (p) => p.pitcherName, cls: "max-w-[130px] truncate" },
];

function BattedBalls({ log, teams }: { log: PitchRecord[]; teams: Teams }) {
  const bbe = useMemo(() => log.filter((p) => p.inPlay && p.ev != null), [log]);
  const { sort, toggle } = useSort({ key: "ev", asc: false });
  const rows = useMemo(() => {
    const c = BB_COLS.find((x) => x.k === sort.key) ?? BB_COLS[0];
    return sortRows(bbe, c.s, sort.asc);
  }, [bbe, sort]);
  if (!rows.length) return null;
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/55">Batted balls ({rows.length})</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-xs tabular-nums">
          <thead className="text-white/55">
            <tr className="border-b border-white/10">
              {BB_COLS.map((c) => (
                <SortTh key={c.k} k={c.k} label={c.label} title={c.title} sort={sort} onSort={toggle} firstAsc={!!c.text && c.k !== "n"} left={!!c.text || c.k === "q"} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.n} className={`border-b border-white/5 ${p.hit > 0 ? "text-white" : "text-white/75"}`}>
                {BB_COLS.map((c) => (
                  <td key={c.k} className={`px-1.5 py-1 ${c.cls ?? ""}`}>
                    {c.r(p, teams)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function GameStatcastSummary({ log, teams }: { log: PitchRecord[]; teams: Teams }) {
  const g = useMemo(() => gameSummary(log), [log]);
  if (!log.length) return <Empty />;
  const hr = g.longestHr ?? g.longestBall;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {g.hardestHit && <Tile label="Hardest hit" value={num(g.hardestHit.ev)} unit="mph" who={g.hardestHit.batterName} sub={bbSub(g.hardestHit, teams)} />}
        {hr && <Tile label={g.longestHr ? "Longest home run" : "Longest ball"} value={Math.round(hr.dist ?? 0)} unit="ft" who={hr.batterName} sub={bbSub(hr, teams)} />}
        {g.fastestPitch && (
          <Tile label="Fastest pitch" value={g.fastestPitch.mph.toFixed(1)} unit="mph" who={g.fastestPitch.pitcherName} sub={`${teams[g.fastestPitch.top ? "home" : "away"]} · ${pitchName(g.fastestPitch.type)} · ${half(g.fastestPitch)}`} />
        )}
        {g.topK && <Tile label="Most strikeouts" value={g.topK.ks} unit="K" who={g.topK.name} sub={`${teams[g.topK.side]} · ${g.topK.pitches} pitches`} />}
        {g.topWhiffs && <Tile label="Most whiffs" value={g.topWhiffs.whiffs} unit="SwStr" who={g.topWhiffs.name} sub={`${teams[g.topWhiffs.side]} · CSW ${pctFmt(g.topWhiffs.csw / g.topWhiffs.pitches)}`} />}
        {g.hardLuckOut && <Tile label="Hard-luck out" value={num(g.hardLuckOut.ev)} unit="mph" who={g.hardLuckOut.batterName} sub={bbSub(g.hardLuckOut, teams)} />}
        {g.bloopHit && <Tile label="Softest hit" value={num(g.bloopHit.ev)} unit="mph" who={g.bloopHit.batterName} sub={bbSub(g.bloopHit, teams)} />}
        <Tile
          label="Barrels"
          value={`${g.bat.away.barrels}–${g.bat.home.barrels}`}
          who={`${teams.away}–${teams.home}`}
          sub={`Hard-hit ${g.bat.away.hardHit}–${g.bat.home.hardHit}`}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Compare title="At the plate" metrics={BAT_METRICS} data={g.bat} teams={teams} />
        <Compare title="On the mound" metrics={PIT_METRICS} data={g.pit} teams={teams} />
      </div>
      {g.starters.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/55">Starters&apos; pitch mix</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {g.starters.map((s) => (
              <MixCard key={s.side} s={s} teams={teams} />
            ))}
          </div>
        </section>
      )}
      <BattedBalls log={log} teams={teams} />
    </div>
  );
}

function Empty() {
  return <p className="py-8 text-center text-sm text-white/55">No pitches yet.</p>;
}

export function PitchTracker({
  log,
  zone,
  currentPitcherId,
  teams = { away: "Away", home: "Home" },
  onClose,
}: {
  log: PitchRecord[];
  zone: { bottom: number; top: number };
  currentPitcherId: number | null;
  /** Team abbreviations for the game summary. */
  teams?: Teams;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"ab" | "game" | "arsenal" | "log">("ab");
  const tabs = [
    ["ab", "At-bat"],
    ["game", "Game"],
    ["arsenal", "Arsenal"],
    ["log", "All pitches"],
  ] as const;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-3" onClick={onClose}>
      <div
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-white/15 bg-[#10161d]/95 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Pitch tracker"
      >
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2 py-2.5 sm:px-4">
          <div className="-my-1 flex min-w-0 items-center gap-1 overflow-x-auto py-1" role="tablist">
            {tabs.map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-sm sm:px-3 ${tab === k ? "bg-white/15 font-semibold" : "text-white/70 hover:bg-white/10"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-xs text-white/45 sm:inline">{log.length} pitches tracked</span>
            <button type="button" onClick={onClose} className="rounded-md bg-white/10 px-2.5 py-1.5 text-sm hover:bg-white/20 sm:px-3" aria-label="Close pitch tracker">
              Close
            </button>
          </div>
        </div>
        <div className="min-h-0 overflow-auto p-3 sm:p-4">
          {tab === "ab" && <AtBatTab log={log} zone={zone} />}
          {tab === "game" && <GameStatcastSummary log={log} teams={teams} />}
          {tab === "arsenal" && <ArsenalTab log={log} currentPitcherId={currentPitcherId} />}
          {tab === "log" && <LogTab log={log} />}
        </div>
      </div>
    </div>
  );
}
