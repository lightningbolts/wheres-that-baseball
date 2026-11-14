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
        if (ctl.getSnapshot().prompt) return;
        ctl.primary();
      } else if (k === "Escape") ctl.cancelAim();
      else if (/^[1-7]$/.test(k)) {
        const s = ctl.getSnapshot();
        const n = Number(k);
        if (s.prompt) {
          const opt = s.prompt.options.find((o) => o.base === n);
          if (opt) ctl.chooseThrow(opt.base);
        } else ctl.selectPitch(n - 1);
      } else if (k === "Shift" || k === "p" || k === "P") ctl.togglePower();
      else if (k === "s" || k === "S") ctl.toggleSteal();
      else if (k === "t" || k === "T") ctl.toggleTurbo();
      // px grows toward the 1B side: screen-right from behind the plate, screen-left from behind the mound.
      else if (k === "ArrowLeft" || k === "a") ctl.nudgeAim(ctl.getSnapshot().humanPitching ? 0.12 : -0.12, 0);
      else if (k === "ArrowRight" || k === "d") ctl.nudgeAim(ctl.getSnapshot().humanPitching ? -0.12 : 0.12, 0);
      else if (k === "ArrowUp" || k === "w") ctl.nudgeAim(0, 0.12);
      else if (k === "ArrowDown") ctl.nudgeAim(0, -0.12);
      else if (k === "h" || k === "H") {
        if (ctl.getSnapshot().prompt) ctl.chooseThrow(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctl]);

  const onAim = useCallback((px: number, pz: number) => ctl.setAim(px, pz), [ctl]);
  const onPrimary = useCallback(() => {
    if (ctl.getSnapshot().prompt) return;
    ctl.primary();
  }, [ctl]);

  const g = ctl.session.game;
  const awayId = setup.awayTeamId;
  const homeId = setup.homeTeamId;

  return (
    <div className="relative min-h-0 w-full flex-1 select-none overflow-hidden bg-[#0d1a12] text-white">
      <GameScene park={g.park} pb={pb} homeColor={getTeamColor(homeId)} onAim={onAim} onPrimary={onPrimary} />

      <ScoreBug snap={snap} awayId={awayId} homeId={homeId} />

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
      <Controls snap={snap} ctl={ctl} />

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
  return (
    <div className="absolute left-2 top-2 flex items-stretch gap-3 rounded-lg border border-white/10 bg-black/55 px-3 py-2 text-sm shadow-lg backdrop-blur sm:left-3 sm:top-3">
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
      <div className="flex flex-col items-center justify-center border-l border-white/10 pl-3 text-xs">
        <div className="font-mono text-base font-bold tabular-nums">
          {snap.balls}-{snap.strikes}
        </div>
        <div className="mt-0.5 flex gap-1" aria-label={`${snap.outs} outs`}>
          {[0, 1].map((i) => (
            <span key={i} className={`h-2 w-2 rounded-full ${snap.outs > i ? "bg-amber-300" : "bg-white/20"}`} />
          ))}
        </div>
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

function MatchupCard({ snap }: { snap: HudSnapshot }) {
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 max-w-[48vw] rounded-lg border border-white/10 bg-black/55 px-3 py-2 text-xs shadow-lg backdrop-blur sm:bottom-3 sm:left-3">
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
      {snap.lastPitch && (
        <div className="truncate text-white/60">
          Last: {pitchName(snap.lastPitch.type)} {snap.lastPitch.mph} mph · {snap.lastPitch.result}
        </div>
      )}
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

/** Instant swing feedback: timing on the press, exit velocity / launch angle on contact. */
function Feedback({ snap }: { snap: HudSnapshot }) {
  const f = snap.feedback;
  if (!f) return null;
  const tone = f.tone === "good" ? "text-emerald-300" : f.tone === "bad" ? "text-amber-300" : "text-white";
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[34%] flex justify-center px-4">
      <div key={f.id} className="animate-play_in rounded-lg bg-black/45 px-3 py-1 text-center shadow-lg backdrop-blur">
        <div className={`text-sm font-bold uppercase tracking-wide sm:text-base ${tone}`}>{f.text}</div>
        {f.sub && <div className="font-mono text-[11px] text-white/80 sm:text-xs">{f.sub}</div>}
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

function Controls({ snap, ctl }: { snap: HudSnapshot; ctl: GameController }) {
  const panel = "rounded-xl border border-white/10 bg-black/60 px-3 py-2 shadow-xl backdrop-blur";
  const wrap = "absolute inset-x-0 bottom-2 flex justify-center px-2 sm:bottom-3";

  if (snap.prompt) {
    return (
      <div className={wrap}>
        <div className={`${panel} flex flex-col items-center gap-2`}>
          <div className="text-xs text-white/70">Ball fielded by the {snap.prompt.fielded.pos} — throw to:</div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {snap.prompt.options.map((o) => (
              <button
                key={o.base}
                type="button"
                onClick={() => ctl.chooseThrow(o.base)}
                className={`rounded-md px-3 py-2 text-sm font-semibold ${o.margin > 0.05 ? "bg-emerald-500 text-black hover:bg-emerald-400" : o.margin > -0.15 ? "bg-amber-400 text-black hover:bg-amber-300" : "bg-white/15 hover:bg-white/25"}`}
              >
                {o.base === 4 ? "Home" : `${o.base}${["", "st", "nd", "rd"][o.base]}`}
                <span className="ml-1 text-[10px] font-normal opacity-75">({o.base})</span>
              </button>
            ))}
            <button type="button" onClick={() => ctl.chooseThrow(null)} className="rounded-md bg-white/15 px-3 py-2 text-sm hover:bg-white/25">
              Hold (H)
            </button>
            <button type="button" onClick={() => ctl.chooseThrow(undefined)} className="rounded-md bg-white/15 px-3 py-2 text-sm hover:bg-white/25">
              Auto
            </button>
          </div>
          <div className="text-[10px] text-white/50">Green = likely out, amber = close play</div>
        </div>
      </div>
    );
  }

  if (snap.humanPitching && (snap.phase === "aim" || snap.phase === "meter")) {
    return (
      <div className={wrap}>
        <div className={`${panel} flex flex-col items-center gap-2`}>
          <div className="flex flex-wrap justify-center gap-1">
            {snap.arsenal.map((p, i) => (
              <button
                key={`${p.type}-${i}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  ctl.selectPitch(i);
                }}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${i === snap.pitchIdx ? "bg-amber-300 text-black" : "bg-white/10 hover:bg-white/25"}`}
              >
                <span className="opacity-60">{i + 1}</span> {pitchName(p.type)} <span className="font-normal opacity-70">{p.mph}</span>
              </button>
            ))}
          </div>
          {snap.phase === "meter" && snap.meterStart != null ? (
            <>
              <Meter start={snap.meterStart} />
              <div className="text-[11px] text-white/65">Stop the needle in the middle — Space / click. Esc to re-aim.</div>
            </>
          ) : (
            <div className="text-[11px] text-white/65">Aim with the mouse (or arrows), then click / Space to set the location.</div>
          )}
        </div>
      </div>
    );
  }

  if (snap.humanBatting && !snap.final && snap.phase !== "between" && snap.phase !== "play") {
    return (
      <div className={wrap}>
        <div className={`${panel} flex flex-wrap items-center justify-center gap-2`}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
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
                ctl.toggleSteal();
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${snap.stealOn ? "bg-amber-300 text-black" : "bg-white/10 hover:bg-white/25"}`}
            >
              {snap.stealOn ? "Runner going!" : "Steal 2nd (S)"}
            </button>
          )}
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              ctl.primary();
            }}
            className="rounded-md bg-emerald-500 px-5 py-1.5 text-sm font-bold text-black hover:bg-emerald-400 sm:hidden"
          >
            Swing
          </button>
          <div className="hidden text-[11px] text-white/65 sm:block">Move the box over the ball · Space / click to swing just before it arrives</div>
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
