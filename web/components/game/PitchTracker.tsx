"use client";

/**
 * Statcast-style pitch tracking for the game being played: this at-bat pitch by pitch,
 * each pitcher's arsenal (velocity, spin, movement, whiffs, CSW, chase…) with a
 * movement chart, and the full pitch log. Colours match the rest of WTBB.
 */
import { useMemo, useState } from "react";
import { pitchName } from "@/components/game/controller";
import { MARK_BALL_R, MARK_COLOR, zoneBox } from "@/components/game/scene/view";
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

const COLS: Array<{ k: string; label: string; title: string; v: (l: ArsenalLine, throws: "L" | "R") => string }> = [
  { k: "n", label: "#", title: "Pitches", v: (l) => String(l.n) },
  { k: "use", label: "Use%", title: "Usage", v: (l) => pct(l.usage) },
  { k: "mph", label: "Velo", title: "Average release speed, mph", v: (l) => num(l.mph) },
  { k: "max", label: "Max", title: "Top speed, mph", v: (l) => num(l.mphMax) },
  { k: "spr", label: "Spread", title: "Velocity spread (slowest–fastest), mph", v: (l) => (l.n > 1 ? `${l.mphMin.toFixed(0)}–${l.mphMax.toFixed(0)}` : "—") },
  { k: "spin", label: "Spin", title: "Spin rate, rpm", v: (l) => Math.round(l.spinRpm).toString() },
  { k: "ivb", label: "IVB", title: "Induced vertical break, in", v: (l) => num(l.ivb) },
  { k: "hb", label: "HB", title: "Horizontal break, in (arm / glove side)", v: (l, t) => hbText(l.hb, t) },
  { k: "ext", label: "Ext", title: "Extension, ft", v: (l) => num(l.ext) },
  { k: "loc", label: "Loc±", title: "Location spread (SD from the average spot), in", v: (l) => (l.n > 1 ? num(l.locSpreadIn, 0) : "—") },
  { k: "zone", label: "Zone%", title: "In the strike zone", v: (l) => pct(l.zonePct) },
  { k: "sw", label: "Swing%", title: "Swing rate", v: (l) => pct(l.swingPct) },
  { k: "wh", label: "Whiff%", title: "Whiffs per swing", v: (l) => pct(l.whiffPct) },
  { k: "csw", label: "CSW%", title: "Called strikes + whiffs per pitch", v: (l) => pct(l.cswPct) },
  { k: "ch", label: "Chase%", title: "Swings at pitches outside the zone", v: (l) => pct(l.chasePct) },
  { k: "pa", label: "PutAway%", title: "Two-strike pitches that ended in a strikeout", v: (l) => pct(l.putAwayPct) },
  { k: "k", label: "K", title: "Strikeouts", v: (l) => String(l.ks) },
  { k: "h", label: "H", title: "Hits allowed", v: (l) => String(l.hits) },
  { k: "ev", label: "EV", title: "Average exit velocity on balls in play, mph", v: (l) => num(l.evAvg) },
  { k: "hh", label: "HH%", title: "Hard-hit rate (95+ mph)", v: (l) => pct(l.hardHitPct) },
];

function ArsenalTab({ log, currentPitcherId }: { log: PitchRecord[]; currentPitcherId: number | null }) {
  const pitchers = useMemo(() => pitchersInLog(log), [log]);
  const [pick, setPick] = useState<number | null>(null);
  const id = pick ?? (pitchers.some((p) => p.id === currentPitcherId) ? currentPitcherId : pitchers[pitchers.length - 1]?.id) ?? null;
  const me = pitchers.find((p) => p.id === id);
  const { lines, all } = useMemo(() => (id == null ? { lines: [], all: null } : arsenalSummary(log, id)), [log, id]);
  if (!me || !all) return <Empty />;
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
              <th className="py-1.5 pr-2 text-left font-medium">Pitch</th>
              {COLS.map((c) => (
                <th key={c.k} title={c.title} className="px-1.5 py-1.5 font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...lines, all].map((l) => (
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

function LogTab({ log }: { log: PitchRecord[] }) {
  const rows = useMemo(() => [...log].reverse().slice(0, 400), [log]);
  if (!rows.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-xs tabular-nums">
        <thead className="text-white/55">
          <tr className="border-b border-white/10">
            {["Inn", "Pitcher", "Batter", "Count", "Pitch", "Velo", "Spin", "IVB", "HB", "Result", "EV", "LA", "Dist"].map((h) => (
              <th key={h} className="px-1.5 py-1.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.n} className="border-b border-white/5 text-white/85">
              <td className="px-1.5 py-1">
                {p.top ? "▲" : "▼"}
                {p.inning}
              </td>
              <td className="max-w-[120px] truncate px-1.5 py-1">{p.pitcherName}</td>
              <td className="max-w-[120px] truncate px-1.5 py-1">{p.batterName}</td>
              <td className="px-1.5 py-1 font-mono">
                {p.balls}-{p.strikes}
              </td>
              <td className="px-1.5 py-1">
                <TypeChip t={p.type} />
              </td>
              <td className="px-1.5 py-1 font-mono">{p.mph.toFixed(1)}</td>
              <td className="px-1.5 py-1 font-mono">{Math.round(p.spinRpm)}</td>
              <td className="px-1.5 py-1 font-mono">{p.ivb.toFixed(1)}</td>
              <td className="px-1.5 py-1 font-mono">{hbText(p.hb, p.pThrows)}</td>
              <td className="px-1.5 py-1">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: MARK_COLOR[recordKind(p)] }} />
                  {recordText(p)}
                </span>
              </td>
              <td className="px-1.5 py-1 font-mono">{num(p.ev)}</td>
              <td className="px-1.5 py-1 font-mono">{p.la == null ? "—" : Math.round(p.la)}</td>
              <td className="px-1.5 py-1 font-mono">{p.dist == null ? "—" : Math.round(p.dist)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  onClose,
}: {
  log: PitchRecord[];
  zone: { bottom: number; top: number };
  currentPitcherId: number | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"ab" | "arsenal" | "log">("ab");
  const tabs = [
    ["ab", "At-bat"],
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
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-2.5">
          <div className="flex items-center gap-1" role="tablist">
            {tabs.map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`rounded-md px-3 py-1.5 text-sm ${tab === k ? "bg-white/15 font-semibold" : "text-white/70 hover:bg-white/10"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-white/45 sm:inline">{log.length} pitches tracked</span>
            <button type="button" onClick={onClose} className="rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20" aria-label="Close pitch tracker">
              Close
            </button>
          </div>
        </div>
        <div className="min-h-0 overflow-auto p-4">
          {tab === "ab" && <AtBatTab log={log} zone={zone} />}
          {tab === "arsenal" && <ArsenalTab log={log} currentPitcherId={currentPitcherId} />}
          {tab === "log" && <LogTab log={log} />}
        </div>
      </div>
    </div>
  );
}
