"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import type { GameSetup, PitchInput } from "@/lib/game/session/session";
import type { TeamModel } from "@/lib/game/ratings";
import { meterAt } from "@/lib/game/session/humanInput";
import { getTeamColor } from "@/lib/mlb/teamColors";
import { getTeamById } from "@/lib/mlb/teams";
import { ordinal } from "@/lib/game/rules/game";
import { GameController, pitchName, setAbbrevLookup, type HudSnapshot } from "@/components/game/controller";
import { MARK_COLOR, zoneBox } from "@/components/game/scene/view";
import { createPlayback } from "@/components/game/scene/playback";
import { sfx } from "@/components/game/audio";
import { BoxScore } from "@/components/game/BoxScore";

const GameScene = dynamic(() => import("@/components/game/scene/GameScene"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-white/70">Building the ballpark…</div>,
});

const abbrev = (id: number) => getTeamById(id)?.abbrev ?? String(id);
setAbbrevLookup(abbrev);

export function GameView({
  setup,
  teams,
  inputs,
  onExit,
}: {
  setup: GameSetup;
  teams: Map<number, TeamModel>;
  inputs?: PitchInput[];
  onExit: () => void;
}) {
  const pb = useMemo(() => createPlayback(), []);
  const ctl = useMemo(() => new GameController(setup, teams, pb, inputs ?? []), [setup, teams, pb, inputs]);
  const snap = useSyncExternalStore(ctl.subscribe.bind(ctl), ctl.getSnapshot, ctl.getSnapshot);
  const [showLog, setShowLog] = useState(false);
  const [muted, setMuted] = useState(sfx.muted);
  const [showBox, setShowBox] = useState(false);

  useEffect(() => {
    ctl.start();
    return () => {
      ctl.dispose();
      sfx.stopCrowd();
    };
  }, [ctl]);

  // Keyboard controls.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const k = e.key;
      if (k === " " || k === "Enter") {
        e.preventDefault();
        // A held key must not lock the target and stop the meter (or swing) by itself.
        if (e.repeat) return;
        // A focused HUD button would also "click" on Space: the key belongs to the game.
        if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
        ctl.primary();
      } else if (k === "Escape") ctl.cancelAim();
      else if (/^[1-7]$/.test(k)) ctl.selectPitch(Number(k) - 1);
      else if (e.repeat && (k === "Shift" || /^[pstPST]$/.test(k))) return;
      else if (k === "Shift" || k === "p" || k === "P") ctl.togglePower();
      else if (k === "s" || k === "S") ctl.toggleSteal();
      else if (k === "t" || k === "T") ctl.toggleTurbo();
      // px grows toward the 1B side: screen-right from behind the plate, screen-left from behind the mound.
      else if (k === "ArrowLeft" || k === "a") ctl.nudgeAim(ctl.getSnapshot().humanPitching ? 0.12 : -0.12, 0);
      else if (k === "ArrowRight" || k === "d") ctl.nudgeAim(ctl.getSnapshot().humanPitching ? -0.12 : 0.12, 0);
      else if (k === "ArrowUp" || k === "w") ctl.nudgeAim(0, 0.12);
      else if (k === "ArrowDown") ctl.nudgeAim(0, -0.12);
      else return;
      if (k.startsWith("Arrow")) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctl]);

  const onAim = useCallback((px: number, pz: number) => ctl.setAim(px, pz), [ctl]);
  const onPrimary = useCallback(() => ctl.primary(), [ctl]);
  // Phones and tablets get on-screen action buttons whatever the screen width.
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(pointer: coarse)");
    if (!mq) return;
    const on = () => setTouch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const g = ctl.session.game;
  const awayId = setup.awayTeamId;
  const homeId = setup.homeTeamId;

  return (
    <div className="relative min-h-0 w-full flex-1 select-none overflow-hidden bg-[#0d1a12] text-white">
      <GameScene park={g.park} pb={pb} homeColor={getTeamColor(homeId)} onAim={onAim} onPrimary={onPrimary} />

      <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1.5 sm:left-3 sm:top-3">
        <ScoreBug snap={snap} awayId={awayId} homeId={homeId} />
        <PitchReadout snap={snap} />
      </div>

      <div className="absolute right-2 top-2 flex flex-wrap items-center justify-end gap-1.5 sm:right-3 sm:top-3">
        <WinProb p={snap.winProbHome} awayId={awayId} homeId={homeId} />
        <HudButton onClick={() => ctl.toggleTurbo()} active={snap.turbo} title="Fast-forward (T)">
          {snap.turbo ? "4×" : "1×"}
        </HudButton>
        <HudButton onClick={() => ctl.simHalf()} title="Sim the rest of this half-inning">
          Sim ½
        </HudButton>
        <HudButton onClick={() => setShowBox((v) => !v)} active={showBox} title="Box score">
          Box
        </HudButton>
        <HudButton onClick={() => setShowLog((v) => !v)} active={showLog} title="Play-by-play">
          Log
        </HudButton>
        <HudButton
          onClick={() => {
            sfx.setMuted(!muted);
            setMuted(!muted);
          }}
          title={muted ? "Unmute" : "Mute"}
        >
          {muted ? "Sound off" : "Sound on"}
        </HudButton>
        <HudButton onClick={onExit} title="Back to menu (the game is saved)">
          Menu
        </HudButton>
      </div>

      <MatchupCard snap={snap} />
      <Banner snap={snap} />
      <Feedback snap={snap} />
      <Controls snap={snap} ctl={ctl} touch={touch} />

      {showLog && <PlayLog snap={snap} onClose={() => setShowLog(false)} />}
      {(snap.final || showBox) && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-3">
          <div className="max-h-full w-full max-w-3xl overflow-auto rounded-xl border border-white/15 bg-[#10161d]/95 p-4 shadow-2xl">
            {snap.final && (
              <div className="mb-3 text-center">
                <div className="text-xs uppercase tracking-widest text-white/60">Final{g.inning > setup.innings ? ` / ${g.inning}` : ""}</div>
                <div className="text-2xl font-bold">
                  {abbrev(awayId)} {snap.score.away} — {abbrev(homeId)} {snap.score.home}
                </div>
              </div>
            )}
            <BoxScore game={g} awayId={awayId} homeId={homeId} />
            <div className="mt-4 flex justify-center gap-2">
              {!snap.final && (
                <button className="rounded-md bg-white/10 px-4 py-2 text-sm hover:bg-white/20" onClick={() => setShowBox(false)}>
                  Back to the game
                </button>
              )}
              {snap.final && (
                <button className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400" onClick={onExit}>
                  New game
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HudButton({ children, onClick, active, title }: { children: React.ReactNode; onClick: () => void; active?: boolean; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        // Keep keyboard focus on the game, or the next Space would press this button again.
        e.currentTarget.blur();
        sfx.unlock();
        onClick();
      }}
      className={`rounded-md border px-2 py-1 text-xs font-medium backdrop-blur transition-colors ${
        active ? "border-amber-300/70 bg-amber-300/25 text-amber-100" : "border-white/15 bg-black/45 text-white/85 hover:bg-black/65"
      }`}
    >
      {children}
    </button>
  );
}

function ScoreBug({ snap, awayId, homeId }: { snap: HudSnapshot; awayId: number; homeId: number }) {
  const row = (id: number, runs: number, batting: boolean) => (
    <div className="flex items-center gap-2">
      <span className="h-4 w-1.5 rounded-sm" style={{ background: getTeamColor(id) }} />
      <span className="w-10 font-semibold">{abbrev(id)}</span>
      <span className="w-6 text-right text-lg font-bold tabular-nums">{runs}</span>
      {batting && <span className="text-[10px] text-amber-300">●</span>}
    </div>
  );
  const pips = (label: string, n: number, max: number, on: string) => (
    <div className="flex items-center gap-1">
      <span className="w-2.5">{label}</span>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`h-2 w-2 rounded-full ${n > i ? on : "bg-white/20"}`} />
      ))}
    </div>
  );
  return (
    <div className="flex items-stretch gap-3 rounded-lg border border-white/10 bg-black/55 px-3 py-2 text-sm shadow-lg backdrop-blur">
      <div className="flex flex-col justify-center gap-0.5">
        {row(awayId, snap.score.away, snap.top)}
        {row(homeId, snap.score.home, !snap.top)}
      </div>
      <div className="flex flex-col items-center justify-center border-l border-white/10 pl-3">
        <div className="text-xs font-semibold">
          {snap.top ? "▲" : "▼"} {ordinal(snap.inning)}
        </div>
        <Diamond bases={snap.bases} />
      </div>
      <div className="flex flex-col justify-center gap-1 border-l border-white/10 pl-3 text-[10px] font-semibold text-white/60" aria-label={`Count ${snap.balls} and ${snap.strikes}, ${snap.outs} out`}>
        {pips("B", snap.balls, 3, "bg-sky-400")}
        {pips("S", snap.strikes, 2, "bg-rose-500")}
        {pips("O", snap.outs, 2, "bg-amber-300")}
      </div>
    </div>
  );
}

function Diamond({ bases }: { bases: [boolean, boolean, boolean] }) {
  const b = (on: boolean, x: number, y: number) => (
    <rect x={x} y={y} width={8} height={8} transform={`rotate(45 ${x + 4} ${y + 4})`} fill={on ? "#fcd34d" : "transparent"} stroke="#fff" strokeOpacity={0.6} />
  );
  return (
    <svg width={34} height={26} viewBox="0 0 34 26" className="mt-1" aria-label="Runners on base">
      {b(bases[1], 13, 2)}
      {b(bases[2], 3, 12)}
      {b(bases[0], 23, 12)}
    </svg>
  );
}

function WinProb({ p, awayId, homeId }: { p: number; awayId: number; homeId: number }) {
  const pct = Math.round(p * 100);
  return (
    <div className="hidden items-center gap-1.5 rounded-md border border-white/15 bg-black/45 px-2 py-1 text-[11px] backdrop-blur md:flex" title="Win probability">
      <span>{abbrev(awayId)}</span>
      <div className="relative h-1.5 w-20 overflow-hidden rounded-full" style={{ background: getTeamColor(awayId) }}>
        <div className="absolute inset-y-0 right-0" style={{ width: `${pct}%`, background: getTeamColor(homeId) }} />
      </div>
      <span>
        {abbrev(homeId)} {pct}%
      </span>
    </div>
  );
}

const RESULT_TONE: Record<string, string> = {
  ball: "text-sky-300",
  called_strike: "text-rose-300",
  swinging_strike: "text-rose-300",
  foul: "text-amber-300",
  in_play: "text-emerald-300",
  hbp: "text-violet-300",
  pending: "text-white/70",
};

/** The pitch on its way (type and speed), then the call. */
function PitchReadout({ snap }: { snap: HudSnapshot }) {
  const r = snap.readout;
  if (!r) return null;
  return (
    <div key={r.id} className="animate-play_in rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-sm shadow-lg backdrop-blur" aria-live="polite">
      <span className="font-mono text-base font-bold tabular-nums">{r.mph}</span>
      <span className="text-[10px] text-white/60"> mph </span>
      <span className="font-semibold">{pitchName(r.type)}</span>
      {r.result && <span className={`ml-2 font-bold ${RESULT_TONE[r.kind] ?? "text-white"}`}>{r.result}</span>}
    </div>
  );
}

/** px/pz (ft, catcher's view: +px to the right) → the mini zone diagrams' SVG units. */
const ZX = (px: number) => 50 + px * 26;
const ZY = (pz: number) => 118 - pz * 26;

function ZoneFrame({ zone }: { zone: { bottom: number; top: number } }) {
  const b = zoneBox(zone.bottom, zone.top);
  return <rect x={ZX(b.x0)} y={ZY(b.y1)} width={ZX(b.x1) - ZX(b.x0)} height={ZY(b.y0) - ZY(b.y1)} fill="rgba(255,255,255,0.06)" stroke="#fff" strokeOpacity={0.85} strokeWidth={1.5} />;
}

/** This at-bat's pitches on a small strike zone (catcher's view). */
function PitchChart({ snap }: { snap: HudSnapshot }) {
  if (!snap.pitches.length) return null;
  const last = snap.pitches.length - 1;
  return (
    <svg width={58} height={72} viewBox="4 6 92 116" className="shrink-0" role="img" aria-label={`Pitch locations this at-bat: ${snap.pitches.length}`}>
      <ZoneFrame zone={snap.zone} />
      {snap.pitches.map((m, i) => (
        <g key={m.n} opacity={i === last ? 1 : 0.7}>
          <circle cx={ZX(m.px)} cy={ZY(m.pz)} r={i === last ? 6.5 : 5.5} fill={MARK_COLOR[m.kind]} stroke="#0a0f18" strokeWidth={1} />
          <text x={ZX(m.px)} y={ZY(m.pz) + 3} textAnchor="middle" fontSize={8.5} fontWeight={700} fill={m.kind === "pending" ? "#111" : "#fff"}>
            {m.n}
          </text>
        </g>
      ))}
    </svg>
  );
}

function MatchupCard({ snap }: { snap: HudSnapshot }) {
  const last = snap.pitches[snap.pitches.length - 1];
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[58vw] items-center gap-2.5 rounded-lg border border-white/10 bg-black/55 px-3 py-2 text-xs shadow-lg backdrop-blur sm:bottom-3 sm:left-3">
      <PitchChart snap={snap} />
      <div className="min-w-0">
        <div className="truncate">
          <span className="text-white/55">AB </span>
          <span className="font-semibold">{snap.batterName}</span>
          <span className="text-white/55"> · {snap.batterLine}</span>
        </div>
        <div className="truncate">
          <span className="text-white/55">P </span>
          <span className="font-semibold">{snap.pitcherName}</span>
          <span className="text-white/55"> · {snap.pitchCount} pitches</span>
        </div>
        {last && last.kind !== "pending" && (
          <div className="truncate text-white/60">
            #{last.n}: {pitchName(last.type)} {last.mph} mph
          </div>
        )}
      </div>
    </div>
  );
}

function Banner({ snap }: { snap: HudSnapshot }) {
  const b = snap.banner;
  if (!b) return null;
  const tone = b.tone === "good" ? "text-emerald-300" : b.tone === "bad" ? "text-rose-300" : "text-white";
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[18%] flex justify-center px-4">
      <div key={b.text} className="max-w-xl animate-play_in rounded-xl bg-black/50 px-5 py-2 text-center shadow-xl backdrop-blur">
        <div className={`text-2xl font-extrabold tracking-tight sm:text-3xl ${tone}`}>{b.text}</div>
        {b.sub && <div className="mt-0.5 text-xs text-white/75 sm:text-sm">{b.sub}</div>}
      </div>
    </div>
  );
}

/**
 * Instant swing feedback: timing on the press, where the bat's coverage box was
 * against where the ball crossed, then exit velocity / launch angle on contact.
 * It sits beside the plate, so it stays readable when the camera leaves for the play.
 */
function Feedback({ snap }: { snap: HudSnapshot }) {
  const f = snap.feedback;
  if (!f) return null;
  const tone = f.tone === "good" ? "text-emerald-300" : f.tone === "bad" ? "text-amber-300" : "text-white";
  const sw = f.swing;
  const t = f.timingMs;
  const covered = sw ? Math.abs(sw.ball.px - sw.pci.px) <= sw.pci.w && Math.abs(sw.ball.pz - sw.pci.pz) <= sw.pci.h : false;
  return (
    <div className="pointer-events-none absolute right-2 top-[26%] flex justify-end sm:right-[max(0.75rem,calc(50%-21rem))]">
      <div key={f.id} className="flex animate-play_in items-center gap-2.5 rounded-lg border border-white/10 bg-black/60 px-3 py-2 shadow-lg backdrop-blur">
        {sw && (
          <svg width={62} height={77} viewBox="4 6 92 116" className="shrink-0" role="img" aria-label={covered ? "The ball was inside your coverage box" : "The ball was outside your coverage box"}>
            <ZoneFrame zone={sw.zone} />
            <rect x={ZX(sw.pci.px - sw.pci.w)} y={ZY(sw.pci.pz + sw.pci.h)} width={sw.pci.w * 52} height={sw.pci.h * 52} fill="rgba(255,225,77,0.18)" stroke="#ffe14d" strokeWidth={2} />
            <circle cx={ZX(sw.ball.px)} cy={ZY(sw.ball.pz)} r={4.5} fill="#fff" stroke={covered ? "#39d98a" : "#ff4d43"} strokeWidth={2.5} />
          </svg>
        )}
        <div className="min-w-[6.5rem]">
          <div className={`text-sm font-bold uppercase tracking-wide sm:text-base ${tone}`}>{f.text}</div>
          {t != null && (
            <div className="mt-1" aria-label={`Swing timing ${Math.round(Math.abs(t))} milliseconds ${t < 0 ? "early" : "late"}`}>
              <div className="relative h-1.5 w-full rounded-full bg-gradient-to-r from-amber-500/70 via-emerald-400 to-amber-500/70">
                <div className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-white shadow" style={{ left: `${50 + Math.max(-50, Math.min(50, (t / 60) * 50))}%` }} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] uppercase text-white/50">
                <span>Early</span>
                <span className="font-mono tabular-nums text-white/75">
                  {t < 0 ? "−" : "+"}
                  {Math.round(Math.abs(t))} ms
                </span>
                <span>Late</span>
              </div>
            </div>
          )}
          {sw && <div className="mt-0.5 text-[10px] text-white/65">{covered ? "Ball inside your box" : "Ball outside your box"}</div>}
          {f.sub && <div className="font-mono text-[11px] text-white/85 sm:text-xs">{f.sub}</div>}
        </div>
      </div>
    </div>
  );
}

function Meter({ start }: { start: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setV(meterAt((performance.now() - start) / 1000));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [start]);
  return (
    <div className="relative h-4 w-64 max-w-[70vw] overflow-hidden rounded-full border border-white/25 bg-gradient-to-r from-rose-600 via-emerald-400 to-rose-600">
      <div className="absolute inset-y-0 left-1/2 w-[8%] -translate-x-1/2 bg-white/35" />
      <div className="absolute inset-y-[-2px] w-1 rounded bg-white shadow" style={{ left: `calc(${v * 100}% - 2px)` }} />
    </div>
  );
}

function Controls({ snap, ctl, touch }: { snap: HudSnapshot; ctl: GameController; touch: boolean }) {
  const panel = "rounded-xl border border-white/10 bg-black/60 px-3 py-2 shadow-xl backdrop-blur";
  const wrap = "pointer-events-none absolute inset-x-0 bottom-2 flex justify-center px-2 sm:bottom-3";
  // The big action button: always on touch devices, and on narrow screens.
  const action = `rounded-md bg-emerald-500 px-6 py-2.5 text-sm font-bold text-black hover:bg-emerald-400 ${touch ? "" : "sm:hidden"}`;
  const hint = `text-[11px] text-white/65 ${touch ? "hidden" : "hidden sm:block"}`;
  const press = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    sfx.unlock();
    ctl.primary();
  };

  if (snap.humanPitching && (snap.phase === "aim" || snap.phase === "meter")) {
    const metering = snap.phase === "meter" && snap.meterStart != null;
    return (
      <div className={wrap}>
        <div className={`${panel} pointer-events-auto flex flex-col items-center gap-2`}>
          <div className="flex flex-wrap justify-center gap-1">
            {snap.arsenal.map((p, i) => (
              <button
                key={`${p.type}-${i}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.currentTarget.blur();
                  ctl.selectPitch(i);
                }}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${i === snap.pitchIdx ? "bg-amber-300 text-black" : "bg-white/10 hover:bg-white/25"}`}
              >
                <span className="opacity-60">{i + 1}</span> {pitchName(p.type)} <span className="font-normal opacity-70">{p.mph}</span>
              </button>
            ))}
          </div>
          {metering && <Meter start={snap.meterStart!} />}
          <button type="button" onPointerDown={press} className={action}>
            {metering ? "Throw" : "Set location"}
          </button>
          <div className={hint}>
            {metering ? "Stop the needle in the middle — Space / click. Esc to re-aim." : "Aim with the mouse (or arrows), then click / Space to set the location."}
          </div>
          {touch && <div className="text-[11px] text-white/65">{metering ? "Stop the needle in the middle." : "Drag on the field to move the target."}</div>}
        </div>
      </div>
    );
  }

  if (snap.humanBatting && !snap.final && (snap.phase === "ready" || snap.phase === "pitch")) {
    return (
      <div className={wrap}>
        <div className={`${panel} pointer-events-auto flex flex-wrap items-center justify-center gap-2`}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.currentTarget.blur();
              ctl.togglePower();
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${snap.power ? "bg-rose-500 text-white" : "bg-white/10 hover:bg-white/25"}`}
            title="Power swing: smaller sweet spot, more bat speed (Shift)"
          >
            {snap.power ? "Power swing" : "Contact swing"}
          </button>
          {snap.canSteal && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.currentTarget.blur();
                ctl.toggleSteal();
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${snap.stealOn ? "bg-amber-300 text-black" : "bg-white/10 hover:bg-white/25"}`}
            >
              {snap.stealOn ? "Runner going!" : "Steal 2nd (S)"}
            </button>
          )}
          <button type="button" onPointerDown={press} className={action}>
            {snap.phase === "ready" ? "Ready" : "Swing"}
          </button>
          <div className={hint}>
            {snap.phase === "ready" ? "Space / click when you are ready for the pitch" : "Move the box over the ball · Space / click to swing just before it arrives"}
          </div>
          {touch && <div className="text-[11px] text-white/65">Drag to move the box</div>}
        </div>
      </div>
    );
  }
  return null;
}

function PlayLog({ snap, onClose }: { snap: HudSnapshot; onClose: () => void }) {
  return (
    <div className="absolute bottom-16 right-2 top-14 z-20 flex w-72 max-w-[80vw] flex-col rounded-xl border border-white/10 bg-black/70 shadow-xl backdrop-blur sm:right-3">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs font-semibold">
        Play-by-play
        <button type="button" onClick={onClose} className="text-white/60 hover:text-white" aria-label="Close play-by-play">
          ✕
        </button>
      </div>
      <ol className="flex-1 space-y-1.5 overflow-auto px-3 py-2 text-xs text-white/85">
        {snap.log.length === 0 && <li className="text-white/50">No plays yet.</li>}
        {snap.log.map((l) => (
          <li key={l.id}>{l.text}</li>
        ))}
      </ol>
    </div>
  );
}

export type { HudSnapshot };
