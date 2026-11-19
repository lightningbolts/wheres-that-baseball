"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import type { GameSession, GameSetup, PitchInput } from "@/lib/game/session/session";
import type { TeamModel } from "@/lib/game/ratings";
import { meterAt } from "@/lib/game/session/humanInput";
import { getTeamColor } from "@/lib/mlb/teamColors";
import { getTeamById } from "@/lib/mlb/teams";
import { mlbTeamLogoUrl } from "@/lib/mlb/teamAssets";
import { ordinal } from "@/lib/game/rules/game";
import { GameController, pitchName, setAbbrevLookup, type HudSnapshot, type ManagerArm, type ManagerBat } from "@/components/game/controller";
import { MARK_BALL_R, MARK_COLOR, zoneBox } from "@/components/game/scene/view";
import { createPlayback } from "@/components/game/scene/playback";
import { registerTeams } from "@/components/game/scene/character/roster";
import { sfx } from "@/components/game/audio";
import { nextSetting, setQualitySetting, SETTING_LABEL, useQuality } from "@/components/game/scene/quality";
import { BoxScore } from "@/components/game/BoxScore";
import { GameStatcastSummary, PitchTracker } from "@/components/game/PitchTracker";
import { CelebrationOverlay } from "@/components/game/Celebration";

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
  onGameOver,
  exitLabel,
}: {
  setup: GameSetup;
  teams: Map<number, TeamModel>;
  inputs?: PitchInput[];
  onExit: () => void;
  /** Fired once when the game goes final (season mode records the result). */
  onGameOver?: (r: { awayRuns: number; homeRuns: number; session: GameSession }) => void;
  /** Label of the button on the final box score (default "New game"). */
  exitLabel?: string;
}) {
  const pb = useMemo(() => createPlayback(), []);
  // Draw everyone as himself (name, number, skin tone), including players rosters.json lacks.
  useMemo(() => registerTeams(teams.values()), [teams]);
  const ctl = useMemo(() => new GameController(setup, teams, pb, inputs ?? []), [setup, teams, pb, inputs]);
  const snap = useSyncExternalStore(ctl.subscribe.bind(ctl), ctl.getSnapshot, ctl.getSnapshot);
  const [showLog, setShowLog] = useState(false);
  const [muted, setMuted] = useState(sfx.muted);
  const [showBox, setShowBox] = useState(false);
  const [showPitches, setShowPitches] = useState(false);
  const [showMgr, setShowMgr] = useState(false);

  useEffect(() => {
    ctl.start();
    // Dev-only handle for scripted visual QA (headless screenshots of specific plays).
    if (process.env.NODE_ENV === "development") (window as unknown as { __playball?: unknown }).__playball = { ctl, pb };
    return () => {
      ctl.dispose();
      sfx.stopCrowd();
    };
  }, [ctl, pb]);

  // Season mode: report the final once.
  const reported = useRef(false);
  const onGameOverRef = useRef(onGameOver);
  useEffect(() => {
    onGameOverRef.current = onGameOver;
  }, [onGameOver]);
  useEffect(() => {
    if (!snap.final || reported.current) return;
    reported.current = true;
    const s = ctl.session;
    onGameOverRef.current?.({ awayRuns: s.game.score.away, homeRuns: s.game.score.home, session: s });
  }, [snap.final, ctl]);

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
      } else if (k === "Escape") {
        ctl.cancelAim();
        ctl.skipCelebration();
      }
      else if (k === "c" || k === "C") {
        if (!e.repeat) ctl.decideChallenge(true);
      }
      else if (/^[1-7]$/.test(k)) ctl.selectPitch(Number(k) - 1);
      else if (e.repeat && (k === "Shift" || /^[pstbPSTB]$/.test(k))) return;
      else if (k === "Shift" || k === "p" || k === "P") ctl.togglePower();
      else if (k === "s" || k === "S") ctl.toggleSteal();
      else if (k === "o" || k === "O") {
        if (!e.repeat) ctl.pickoff();
      }
      else if (k === "b" || k === "B") ctl.toggleBunt();
      else if (k === "t" || k === "T") ctl.toggleTurbo();
      else if (k === "i" || k === "I") setShowPitches((v) => !v);
      else if (k === "m" || k === "M") {
        if (ctl.getSnapshot().canManage) setShowMgr((v) => !v);
      }
      // px grows toward the 1B side: screen-right from behind the plate, screen-left from behind the mound.
      else if (k === "ArrowLeft" || k === "a") ctl.nudgeAim(pitchView(ctl.getSnapshot()) ? 0.12 : -0.12, 0);
      else if (k === "ArrowRight" || k === "d") ctl.nudgeAim(pitchView(ctl.getSnapshot()) ? -0.12 : 0.12, 0);
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
  // The final screen waits for the postgame celebration (snap.final is true as soon as the last out is made).
  const over = snap.phase === "final";
  const awayId = setup.awayTeamId;
  const homeId = setup.homeTeamId;

  return (
    <div className="relative min-h-0 w-full flex-1 select-none overflow-hidden bg-[#0d1a12] text-white">
      <GameScene park={g.park} pb={pb} homeColor={getTeamColor(homeId)} awayColor={getTeamColor(awayId)} onAim={onAim} onPrimary={onPrimary} />
      {/* A broadcast cut dips to black (quick down, a little slower up); the inning bumper sits on it. */}
      <div aria-hidden className={`pointer-events-none absolute inset-0 bg-black transition-opacity ${snap.curtain ? "opacity-100 duration-[130ms] ease-in" : "opacity-0 duration-300 ease-out"}`} />
      <Bumper snap={snap} awayId={awayId} homeId={homeId} />

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
        {setup.human !== "none" && (
          <HudButton onClick={() => setShowMgr((v) => !v)} active={showMgr} pulse={snap.pitcherTired && !showMgr} title="Manage: bullpen, pinch hitters, pinch runners, defense (M)">
            {snap.pitcherTired ? "Bullpen ⚠" : "Manage"}
          </HudButton>
        )}
        <HudButton onClick={() => setShowBox((v) => !v)} active={showBox} title="Box score">
          Box
        </HudButton>
        <HudButton onClick={() => setShowPitches((v) => !v)} active={showPitches} title="Pitch tracker: velocity, spin, movement, whiffs (I)">
          Pitches
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
        <GraphicsButton />
        <HudButton onClick={onExit} title="Back to menu (the game is saved)">
          Menu
        </HudButton>
      </div>

      <MatchupCard snap={snap} />
      <BasesPanel snap={snap} ctl={ctl} />
      <Banner snap={snap} />
      <Feedback snap={snap} />
      <Controls snap={snap} ctl={ctl} touch={touch} />
      <ChallengePrompt snap={snap} ctl={ctl} awayId={awayId} homeId={homeId} />
      <ReviewCard snap={snap} awayId={awayId} homeId={homeId} />
      <TurnTag snap={snap} />
      <Handoff snap={snap} ctl={ctl} />
      <CelebrationOverlay celebration={snap.celebration} onSkip={() => ctl.skipCelebration()} />

      {showLog && <PlayLog snap={snap} onClose={() => setShowLog(false)} />}
      {showPitches && !snap.final && (
        <PitchTracker
          log={snap.pitchLog}
          zone={snap.zone}
          currentPitcherId={ctl.session.currentContext?.pitcher.id ?? null}
          teams={{ away: abbrev(awayId), home: abbrev(homeId) }}
          onClose={() => setShowPitches(false)}
        />
      )}
      {showMgr && !snap.final && <ManagerPanel ctl={ctl} snap={snap} onClose={() => setShowMgr(false)} />}
      {(over || showBox) && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-3">
          <div className="max-h-full w-full max-w-3xl overflow-auto rounded-xl border border-white/15 bg-[#10161d]/95 p-4 shadow-2xl">
            {over && (
              <div className="mb-3 text-center">
                <div className="text-xs uppercase tracking-widest text-white/60">Final{g.inning > setup.innings ? ` / ${g.inning}` : ""}</div>
                <div className="text-2xl font-bold">
                  {abbrev(awayId)} {snap.score.away} — {abbrev(homeId)} {snap.score.home}
                </div>
              </div>
            )}
            <BoxScore game={g} awayId={awayId} homeId={homeId} />
            {snap.pitchLog.length > 0 && (
              <details className="mt-4 rounded-lg border border-white/10 p-2 sm:p-3" open={over || undefined}>
                <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-white/70">Statcast summary</summary>
                <div className="mt-3">
                  <GameStatcastSummary log={snap.pitchLog} teams={{ away: abbrev(awayId), home: abbrev(homeId) }} />
                </div>
              </details>
            )}
            <div className="mt-4 flex justify-center gap-2">
              {!over && (
                <button className="rounded-md bg-white/10 px-4 py-2 text-sm hover:bg-white/20" onClick={() => setShowBox(false)}>
                  Back to the game
                </button>
              )}
              {over && (
                <button className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400" onClick={onExit}>
                  {exitLabel ?? "New game"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The pitcher's view is up (aim directions are mirrored from the catcher's view). */
const pitchView = (s: HudSnapshot) => s.humanPitching && (s.phase === "aim" || s.phase === "meter" || !s.humanBatting);

/** ABS: the umpire has called it; the human club may challenge for a few seconds. */
function ChallengePrompt({ snap, ctl, awayId, homeId }: { snap: HudSnapshot; ctl: GameController; awayId: number; homeId: number }) {
  const c = snap.challenge;
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!c) return;
    let raf = 0;
    const tick = () => {
      setNow(performance.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [c]);
  if (!c) return null;
  const left = snap.abs?.[c.side] ?? 0;
  const frac = Math.max(0, Math.min(1, (c.until - now) / c.ms));
  const who = c.call === "strike" ? "batter" : "catcher";
  const team = c.side === "away" ? awayId : homeId;
  const btn = (e: React.PointerEvent, yes: boolean) => {
    e.stopPropagation();
    e.preventDefault();
    ctl.decideChallenge(yes);
  };
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-2 z-20 flex justify-center px-2 sm:bottom-3">
      <div className="pointer-events-auto w-full max-w-sm animate-play_in overflow-hidden rounded-xl border border-white/15 bg-black/75 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-3 px-3 pt-2.5">
          <span className={`rounded px-2 py-0.5 text-sm font-extrabold uppercase ${c.call === "strike" ? "bg-red-500/90" : "bg-green-600/90"}`}>{c.call}</span>
          <div className="min-w-0 flex-1 text-xs leading-tight text-white/80">
            <div className="font-semibold text-white">
              {snap.twoPlayer ? `${c.side === "away" ? "P1" : "P2"} · ` : ""}
              {abbrev(team)} {who} can challenge
            </div>
            <div>
              ABS zone decides · {left} challenge{left === 1 ? "" : "s"} left (kept if you win)
            </div>
          </div>
        </div>
        <div className="flex gap-2 p-2.5">
          <button type="button" onPointerDown={(e) => btn(e, false)} className="flex-1 rounded-md bg-white/10 py-2 text-sm font-semibold hover:bg-white/20">
            Accept <span className="hidden text-white/50 sm:inline">(Space)</span>
          </button>
          <button type="button" onPointerDown={(e) => btn(e, true)} className="flex-1 rounded-md bg-amber-400 py-2 text-sm font-bold text-black hover:bg-amber-300">
            Challenge <span className="hidden text-black/60 sm:inline">(C)</span>
          </button>
        </div>
        <div className="h-1 bg-white/10">
          <div className="h-full bg-amber-400" style={{ width: `${frac * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

/** The Hawk-Eye measurement: how far in or out of the zone the pitch crossed. */
function missText(m: NonNullable<HudSnapshot["review"]>["miss"]): string {
  const x = Math.max(0.1, Math.round(m.inches * 10) / 10).toFixed(1);
  if (m.inZone) return `In the zone by ${x}″`;
  const where = m.side === "wide" ? "off the plate" : m.side === "corner" ? "off the corner" : m.side;
  return `Missed ${where} by ${x}″`;
}

/**
 * ABS review, for either club: who tapped, the call hanging while the zone is checked,
 * then the verdict popping in (green when it goes your way, red when it doesn't).
 */
function ReviewCard({ snap, awayId, homeId }: { snap: HudSnapshot; awayId: number; homeId: number }) {
  const r = snap.review;
  if (!r) return null;
  const team = r.side === "away" ? awayId : homeId;
  const role = r.by === "batter" ? "" : ` (${r.by === "catcher" ? "C" : "P"})`;
  const verdict = r.stage === "verdict";
  const now = r.call === "strike" ? "ball" : "strike";
  const color = !verdict ? "text-white" : r.good == null ? "text-amber-300" : r.good ? "text-emerald-300" : "text-rose-300";
  const head = !verdict ? "ABS review" : r.overturned ? "Overturned" : "Call stands";
  const sub = !verdict
    ? "Checking the zone…"
    : r.overturned
      ? r.flip === "strikeout"
        ? "Strike three!"
        : r.flip === "walk"
          ? "Ball four — take your base!"
          : `It's a ${now}`
      : `Still a ${r.call}`;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-2 z-20 flex justify-center px-2 sm:bottom-3" role="status" aria-live="polite">
      <div className="w-full max-w-sm animate-play_in overflow-hidden rounded-xl border border-white/15 bg-black/80 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-3 px-3 pt-2.5">
          <TeamMark id={team} size={28} />
          <div className="min-w-0 flex-1 text-xs leading-tight text-white/80">
            <div className="truncate font-semibold text-white">
              {abbrev(team)} · {r.name}
              {role} challenges
            </div>
            <div>
              The <span className={r.call === "strike" ? "font-bold text-red-300" : "font-bold text-green-300"}>{r.call}</span> call is under review
            </div>
          </div>
        </div>
        <div className="px-3 pb-2 pt-1.5 text-center">
          <div key={head} className={`text-2xl font-extrabold uppercase ${color} ${verdict ? "animate-verdict_pop" : "animate-pulse"}`}>
            {head}
          </div>
          <div className="text-xs text-white/75">{sub}</div>
          {verdict && <div className="mt-0.5 text-[11px] font-semibold tabular-nums text-white/60">{missText(r.miss)}</div>}
        </div>
        <div className="relative h-1 overflow-hidden bg-white/10">
          {verdict ? (
            <div className={`h-full ${r.good == null ? "bg-amber-400" : r.good ? "bg-emerald-400" : "bg-rose-400"}`} />
          ) : (
            <div className="absolute inset-y-0 w-2/5 animate-abs_scan bg-gradient-to-r from-transparent via-amber-300 to-transparent" />
          )}
        </div>
      </div>
    </div>
  );
}

/** Two players: whose turn it is at the controls. */
function TurnTag({ snap }: { snap: HudSnapshot }) {
  const t = snap.turn;
  if (!t || snap.handoff || snap.phase === "between" || snap.phase === "play") return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-[88px] z-10 -translate-x-1/2 md:top-3">
      <div className="flex items-center gap-2 rounded-full border border-white/15 bg-black/60 px-3 py-1 text-xs font-semibold shadow-lg backdrop-blur">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${t.player === "P1" ? "bg-sky-400 text-black" : "bg-rose-400 text-black"}`}>{t.player}</span>
        <TeamMark id={t.teamId} size={16} />
        <span>{t.role === "pitch" ? "Pitching" : "Batting"}</span>
      </div>
    </div>
  );
}

/** Two players, pass-the-device: an opaque card while the controls change hands. */
function Handoff({ snap, ctl }: { snap: HudSnapshot; ctl: GameController }) {
  const h = snap.handoff;
  if (!h) return null;
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-[#05080b] px-4"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        sfx.unlock();
        ctl.primary();
      }}
    >
      <div className="animate-play_in text-center">
        <div className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-300">Hand it over</div>
        <div className="mt-2 text-2xl font-extrabold">{h.title}</div>
        <div className="mx-auto mt-2 max-w-xs text-sm text-white/65">{h.sub}</div>
        <div className="mt-5 inline-block rounded-md bg-emerald-500 px-6 py-2.5 text-sm font-bold text-black">Ready — tap or press Space</div>
      </div>
    </div>
  );
}

/** Graphics quality: Auto → High → Medium → Low (saved in this browser). */
function GraphicsButton() {
  const q = useQuality();
  const auto = q.setting === "auto" ? ` (running ${SETTING_LABEL[q.live.tier]})` : "";
  return (
    <HudButton onClick={() => setQualitySetting(nextSetting(q.setting))} title={`Graphics quality: ${SETTING_LABEL[q.setting]}${auto}. Lower it if the game runs slowly.`}>
      {`GFX ${SETTING_LABEL[q.setting]}`}
    </HudButton>
  );
}

function HudButton({ children, onClick, active, title, pulse }: { children: React.ReactNode; onClick: () => void; active?: boolean; title?: string; pulse?: boolean }) {
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
        active ? "border-amber-300/70 bg-amber-300/25 text-amber-100" : pulse ? "animate-pulse border-amber-300/80 bg-amber-500/30 text-amber-50" : "border-white/15 bg-black/45 text-white/85 hover:bg-black/65"
      }`}
    >
      {children}
    </button>
  );
}

/** Keep showing something for a moment after it is gone, so it can animate out instead of popping off. */
function useLinger<T>(value: T | null, ms = 200): { item: T | null; leaving: boolean } {
  const [held, setHeld] = useState<T | null>(value);
  if (value !== null && value !== held) setHeld(value);
  useEffect(() => {
    if (value !== null) return;
    const id = setTimeout(() => setHeld(null), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return { item: value ?? held, leaving: value === null && held !== null };
}

const HUD_IN = "animate-play_in";
const HUD_OUT = "animate-toast_out [animation-duration:200ms]";

/** Between half-innings: the line score card that covers the teams changing sides. */
function Bumper({ snap, awayId, homeId }: { snap: HudSnapshot; awayId: number; homeId: number }) {
  const { item: b, leaving } = useLinger(snap.bumper, 260);
  if (!b) return null;
  const side = (id: number, runs: number) => (
    <div className="flex items-center gap-2.5">
      <TeamMark id={id} size={40} />
      <span className="text-lg font-semibold tracking-wide text-white/80">{abbrev(id)}</span>
      <span className="text-4xl font-extrabold tabular-nums">{runs}</span>
    </div>
  );
  return (
    <div className={`pointer-events-none absolute inset-0 flex items-center justify-center px-4 transition-opacity duration-200 ${leaving ? "opacity-0" : "opacity-100"}`} aria-live="polite">
      <div className="animate-play_in rounded-2xl border border-white/10 bg-white/[0.06] px-7 py-5 text-center shadow-2xl">
        <div className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-300">{b.title}</div>
        <div className="mt-3 flex items-center justify-center gap-6">
          {side(awayId, snap.score.away)}
          <span className="text-white/30">–</span>
          {side(homeId, snap.score.home)}
        </div>
        <div className="mt-3 text-xs text-white/60">{b.sub}</div>
      </div>
    </div>
  );
}

function ScoreBug({ snap, awayId, homeId }: { snap: HudSnapshot; awayId: number; homeId: number }) {
  const row = (id: number, runs: number, batting: boolean) => (
    <div className="flex items-center gap-2 rounded-md pr-1" style={{ background: `linear-gradient(90deg, ${getTeamColor(id)}cc, ${getTeamColor(id)}33 70%, transparent)` }}>
      <span className="flex h-6 w-7 items-center justify-center">
        <TeamMark id={id} size={20} />
      </span>
      <span className="w-10 font-semibold tracking-wide">{abbrev(id)}</span>
      {/* Keyed on the score so a run flashes the moment it crosses the plate. */}
      <span key={runs} className="w-6 animate-play_in text-right text-lg font-bold tabular-nums">
        {runs}
      </span>
      <span className={`text-[10px] ${batting ? "text-amber-300" : "text-transparent"}`}>●</span>
    </div>
  );
  const pips = (label: string, n: number, max: number, on: string) => (
    <div className="flex items-center gap-1">
      <span className="w-2.5">{label}</span>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`h-2 w-2 rounded-full transition-colors duration-200 ${n > i ? on : "bg-white/20"}`} />
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
        <div key={`${snap.top}-${snap.inning}`} className="animate-play_in text-xs font-semibold">
          {snap.top ? "▲" : "▼"} {ordinal(snap.inning)}
        </div>
        <Diamond bases={snap.bases} />
      </div>
      <div className="flex flex-col justify-center gap-1 border-l border-white/10 pl-3 text-[10px] font-semibold text-white/60" aria-label={`Count ${snap.balls} and ${snap.strikes}, ${snap.outs} out`}>
        {pips("B", snap.balls, 3, "bg-green-500")}
        {pips("S", snap.strikes, 2, "bg-red-500")}
        {pips("O", snap.outs, 2, "bg-amber-300")}
      </div>
      {snap.abs && (
        <div className="flex flex-col justify-center gap-1 border-l border-white/10 pl-3 text-[10px] font-semibold text-white/60" title="ABS challenges left" aria-label={`ABS challenges left: ${abbrev(awayId)} ${snap.abs.away}, ${abbrev(homeId)} ${snap.abs.home}`}>
          <div className="text-[9px] tracking-wider text-white/45">ABS</div>
          {(["away", "home"] as const).map((side) => (
            <div key={side} className="flex gap-1">
              {Array.from({ length: Math.max(2, snap.abs![side]) }, (_, i) => (
                <span key={i} className={`h-2 w-2 rounded-sm ${snap.abs![side] > i ? "bg-sky-400" : "bg-white/15"}`} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Real club mark (MLB static SVG, on-dark), falling back to the abbreviation. */
function TeamMark({ id, size }: { id: number; size: number }) {
  const [bad, setBad] = useState(false);
  if (bad) return <span className="text-[9px] font-bold">{abbrev(id)}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={mlbTeamLogoUrl(id, "dark")} alt="" width={size} height={size} style={{ width: size, height: size }} className="object-contain drop-shadow" onError={() => setBad(true)} />;
}

/**
 * Bottom-right: the bases as they stand right now (updated mid-play), who is on each
 * one, the outs, and — when batting — a tap on a runner sends him (multi-base steals).
 */
function BasesPanel({ snap, ctl }: { snap: HudSnapshot; ctl: GameController }) {
  const canSend = snap.stealOpts.length > 0;
  const going = new Set(snap.steals);
  // Diamond geometry (SVG units): home at the bottom.
  const P: Array<[number, number]> = [
    [112, 62],
    [70, 22],
    [28, 62],
  ];
  const label = ["2nd", "3rd", "home"];
  const { item: call, leaving: callLeaving } = useLinger(snap.call);
  return (
    <div className="pointer-events-none absolute bottom-2 right-2 z-10 w-[148px] select-none sm:bottom-3 sm:right-3 sm:w-[170px]" aria-label="Runners on base">
      <div className="pointer-events-auto relative rounded-xl border border-white/10 bg-black/60 p-2 shadow-xl backdrop-blur">
        <svg viewBox="0 0 140 104" className="w-full">
          <path d="M70 100 L112 62 L70 22 L28 62 Z" fill="none" stroke="#ffffff" strokeOpacity={0.25} strokeWidth={1.5} />
          <rect x={65} y={95} width={10} height={8} fill="#fff" opacity={0.5} />
          {P.map(([x, y], i) => {
            const on = snap.bases[i];
            const r = snap.runners[i];
            const sendable = canSend && snap.stealOpts.includes(i);
            const isGoing = going.has(i);
            return (
              <g
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  if (sendable) ctl.toggleSteal(i);
                }}
                style={{ cursor: sendable ? "pointer" : "default" }}
              >
                <rect
                  x={x - 9}
                  y={y - 9}
                  width={18}
                  height={18}
                  transform={`rotate(45 ${x} ${y})`}
                  fill={on ? (isGoing ? "#f59e0b" : "#fcd34d") : "rgba(255,255,255,0.06)"}
                  stroke={isGoing ? "#fff" : "#fff"}
                  strokeOpacity={isGoing ? 1 : 0.55}
                  strokeWidth={isGoing ? 2.5 : 1.2}
                >
                  {isGoing && <animate attributeName="stroke-opacity" values="1;0.3;1" dur="0.8s" repeatCount="indefinite" />}
                </rect>
                {r && (
                  <text x={x} y={y + (i === 1 ? -15 : 24)} textAnchor="middle" fontSize={9} fontWeight={600} fill="#fff">
                    {(r.name.split(" ").slice(-1)[0] ?? r.name).slice(0, 11)}
                  </text>
                )}
                {r && (
                  <text x={x} y={y + (i === 1 ? -25 : 33)} textAnchor="middle" fontSize={7} fill="#cbd5e1">
                    {r.sprint.toFixed(1)} ft/s{r.sb ? ` · ${r.sb} SB` : ""}
                  </text>
                )}
                {sendable && (
                  <text x={x} y={y + 3} textAnchor="middle" fontSize={8} fontWeight={700} fill="#111">
                    {isGoing ? "GO" : ""}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <div className="mt-0.5 flex items-center justify-between text-[10px] font-semibold text-white/70">
          <span className="flex items-center gap-1">
            OUT
            {[0, 1, 2].map((i) => (
              <span key={i} className={`h-2 w-2 rounded-full ${snap.outs > i ? "bg-amber-300" : "bg-white/20"}`} />
            ))}
          </span>
          <span className="tabular-nums">
            {snap.balls}-{snap.strikes}
          </span>
        </div>
        {canSend && (
          <div className="mt-1 text-center text-[10px] leading-tight text-white/60">
            {snap.steals.length ? `Sending: ${snap.steals.map((f) => label[f]).join(" + ")}` : "Tap a runner (or S) to steal"}
          </div>
        )}
        {call && (
          <div
            key={call.id}
            className={`pointer-events-none absolute inset-x-0 top-1/3 ${callLeaving ? HUD_OUT : HUD_IN} text-center text-xl font-black italic tracking-wider drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] ${
              call.tone === "good" ? "text-emerald-300" : call.tone === "bad" ? "text-rose-400" : "text-white"
            }`}
          >
            {call.text}
          </div>
        )}
      </div>
    </div>
  );
}

function Diamond({ bases }: { bases: [boolean, boolean, boolean] }) {
  const b = (on: boolean, x: number, y: number) => (
    <rect x={x} y={y} width={8} height={8} transform={`rotate(45 ${x + 4} ${y + 4})`} fill="#fcd34d" fillOpacity={on ? 1 : 0} stroke="#fff" strokeOpacity={0.6} className="transition-[fill-opacity] duration-200" />
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
        <div className="absolute inset-y-0 right-0 transition-[width] duration-500 ease-out" style={{ width: `${pct}%`, background: getTeamColor(homeId) }} />
      </div>
      <span>
        {abbrev(homeId)} {pct}%
      </span>
    </div>
  );
}

/** Same result colours as the zone markers (WTBB / Gameday). */
const RESULT_TONE: Record<string, string> = {
  ball: "text-green-400",
  called_strike: "text-red-400",
  swinging_strike: "text-red-400",
  foul: "text-red-400",
  in_play: "text-blue-400",
  in_play_out: "text-purple-400",
  hbp: "text-neutral-300",
  pending: "text-white/70",
};

/** The pitch on its way (type and speed), then the call. */
function PitchReadout({ snap }: { snap: HudSnapshot }) {
  const { item: r, leaving } = useLinger(snap.readout);
  if (!r) return null;
  return (
    <div key={r.id} className={`${leaving ? HUD_OUT : HUD_IN} rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-sm shadow-lg backdrop-blur`} aria-live="polite">
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

/** Ball radius in the mini zone diagrams' SVG units (26 per ft): markers are drawn true to size. */
const ZR = MARK_BALL_R * 26;

/** This at-bat's pitches on a small strike zone (catcher's view), each dot the ball's true size. */
function PitchChart({ snap }: { snap: HudSnapshot }) {
  if (!snap.pitches.length) return null;
  const last = snap.pitches.length - 1;
  return (
    <svg width={70} height={88} viewBox="4 6 92 116" className="shrink-0" role="img" aria-label={`Pitch locations this at-bat: ${snap.pitches.length}`}>
      <ZoneFrame zone={snap.zone} />
      {snap.pitches.map((m, i) => (
        <g key={m.n} opacity={i === last ? 1 : 0.75}>
          {i === last && <circle cx={ZX(m.px)} cy={ZY(m.pz)} r={ZR + 2.2} fill="none" stroke="#fff" strokeWidth={1.2} />}
          <circle cx={ZX(m.px)} cy={ZY(m.pz)} r={ZR} fill={MARK_COLOR[m.kind]} stroke="#0a0f18" strokeWidth={0.6} />
        </g>
      ))}
    </svg>
  );
}

function MatchupCard({ snap }: { snap: HudSnapshot }) {
  const last = snap.pitches[snap.pitches.length - 1];
  const rec = snap.pitchLog[snap.pitchLog.length - 1];
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100vw-180px)] sm:max-w-[58vw] items-center gap-2.5 rounded-lg border border-white/10 bg-black/55 px-3 py-2 text-xs shadow-lg backdrop-blur sm:bottom-3 sm:left-3">
      <PitchChart snap={snap} />
      <div className="min-w-0">
        <div className="truncate">
          <span className="text-white/55">AB </span>
          {/* Keyed on the name: a new batter eases in. */}
          <span key={snap.batterName} className="inline-block animate-play_in font-semibold">
            {snap.batterName}
          </span>
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
            {rec && rec.paPitch === last.n && rec.type === last.type && (
              <span className="font-mono text-[11px] tabular-nums text-white/45">
                {" "}· {Math.round(rec.spinRpm)} rpm · IVB {rec.ivb.toFixed(0)}″ · HB {Math.abs(rec.hb).toFixed(0)}″
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Banner({ snap }: { snap: HudSnapshot }) {
  const { item: b, leaving } = useLinger(snap.banner);
  if (!b) return null;
  const tone = b.tone === "good" ? "text-emerald-300" : b.tone === "bad" ? "text-rose-300" : "text-white";
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[18%] flex justify-center px-4">
      <div key={b.text} className={`max-w-xl ${leaving ? HUD_OUT : HUD_IN} rounded-xl bg-black/50 px-5 py-2 text-center shadow-xl backdrop-blur`}>
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
  const { item: f, leaving } = useLinger(snap.feedback);
  if (!f) return null;
  const tone = f.tone === "good" ? "text-emerald-300" : f.tone === "bad" ? "text-amber-300" : "text-white";
  const sw = f.swing;
  const t = f.timingMs;
  const covered = sw ? Math.abs(sw.ball.px - sw.pci.px) <= sw.pci.w && Math.abs(sw.ball.pz - sw.pci.pz) <= sw.pci.h : false;
  return (
    <div className="pointer-events-none absolute right-2 top-[26%] flex justify-end sm:right-[max(0.75rem,calc(50%-21rem))]">
      <div key={f.id} className={`flex ${leaving ? HUD_OUT : HUD_IN} items-center gap-2.5 rounded-lg border border-white/10 bg-black/60 px-3 py-2 shadow-lg backdrop-blur`}>
        {sw && (
          <svg width={62} height={77} viewBox="4 6 92 116" className="shrink-0" role="img" aria-label={covered ? "The ball was inside your coverage box" : "The ball was outside your coverage box"}>
            <ZoneFrame zone={sw.zone} />
            <rect x={ZX(sw.pci.px - sw.pci.w)} y={ZY(sw.pci.pz + sw.pci.h)} width={sw.pci.w * 52} height={sw.pci.h * 52} fill="rgba(255,225,77,0.18)" stroke="#ffe14d" strokeWidth={2} />
            <circle cx={ZX(sw.ball.px)} cy={ZY(sw.ball.pz)} r={ZR} fill="#fff" stroke={covered ? "#39d98a" : "#ff4d43"} strokeWidth={1.2} />
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
  const panel = "animate-play_in rounded-xl border border-white/10 bg-black/60 px-3 py-2 shadow-xl backdrop-blur";
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
          {!metering && snap.pickoffs.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-1">
              {snap.pickoffs.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.currentTarget.blur();
                    ctl.pickoff(f as 0 | 1);
                  }}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${snap.disengagements >= 2 ? "bg-rose-500/80 hover:bg-rose-500" : "bg-white/10 hover:bg-white/25"}`}
                  title={snap.disengagements >= 2 ? "Third throw-over: if he gets back, it's a balk" : "Throw over to hold the runner (O)"}
                >
                  Throw over to {f === 0 ? "1st" : "2nd"}
                  {f === snap.pickoffs[0] && <span className="opacity-60"> (O)</span>}
                </button>
              ))}
              <span className={`text-[11px] ${snap.disengagements >= 2 ? "text-rose-300" : "text-white/55"}`}>
                {snap.disengagements >= 2 ? "Out of throw-overs — balk risk" : `${2 - snap.disengagements} of 2 throw-overs left`}
              </span>
            </div>
          )}
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
          {snap.canBunt && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.currentTarget.blur();
                ctl.toggleBunt();
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${snap.bunt ? "bg-sky-300 text-black" : "bg-white/10 hover:bg-white/25"}`}
              title="Square to bunt (B): third-base line, then first-base line, then off"
            >
              {snap.bunt === 1 ? "Bunt → 3B line" : snap.bunt === 2 ? "Bunt → 1B line" : "Bunt (B)"}
            </button>
          )}
          {snap.canSteal && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.currentTarget.blur();
                ctl.toggleSteal();
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${snap.stealOn ? "bg-amber-300 text-black" : "bg-white/10 hover:bg-white/25"}`}
              title="Steal (S): lead runner, then everyone, then hold — or tap runners on the bases panel"
            >
              {snap.stealOn ? `Going: ${snap.steals.map((f) => ["2nd", "3rd", "home"][f]).join(" + ")}` : "Steal (S)"}
            </button>
          )}
          <button type="button" onPointerDown={press} className={action}>
            {snap.phase === "ready" ? "Ready" : snap.bunt ? "Pull back" : "Swing"}
          </button>
          <div className={hint}>
            {snap.bunt
              ? "Squared to bunt — it goes down by itself · Space / click to pull the bat back"
              : snap.phase === "ready"
                ? "Space / click when you are ready for the pitch"
                : "Move the box over the ball · Space / click to swing just before it arrives"}
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

const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

/**
 * The manager's card: bullpen when your club is in the field, pinch hitters and pinch
 * runners when it bats, and defensive replacements. Moves happen between pitches.
 */
function ManagerPanel({ ctl, snap, onClose }: { ctl: GameController; snap: HudSnapshot; onClose: () => void }) {
  // Re-read on every snapshot (the panel stays open across pitches).
  const v = useMemo(() => ctl.managerView(), [ctl, snap]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tab, setTab] = useState<"pen" | "ph" | "pr" | "def">(() => (v?.fielding ? "pen" : "ph"));
  const [outId, setOutId] = useState<number | null>(null);
  const [runBase, setRunBase] = useState<0 | 1 | 2 | null>(null);
  if (!v) return null;
  const tabs: Array<["pen" | "ph" | "pr" | "def", string, boolean]> = [
    ["pen", "Bullpen", v.fielding],
    ["ph", "Pinch hit", !v.fielding],
    ["pr", "Pinch run", !v.fielding && v.runners.length > 0],
    ["def", "Defense", true],
  ];
  const cur = tabs.find((t) => t[0] === tab && t[2]) ? tab : (tabs.find((t) => t[2])?.[0] ?? "def");
  const act = (sub: Parameters<GameController["substitute"]>[0]) => {
    if (ctl.substitute(sub)) onClose();
  };
  const row = "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-xs hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent";
  const arm = (p: ManagerArm) => (
    <button key={p.id} className={row} disabled={!v.allowed} onClick={() => act({ kind: "pitcher", inId: p.id })}>
      <span className="w-6 text-center font-mono text-white/60">{p.throws}HP</span>
      <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
      <span className="w-14 text-right tabular-nums text-white/70">{p.topMph} mph</span>
      <span className="w-16 text-right tabular-nums">K {pct(p.kPct)}</span>
      <span className="w-16 text-right tabular-nums text-white/70">BB {pct(p.bbPct)}</span>
      <span className="hidden w-28 truncate text-right text-white/50 sm:block">{p.pitches.map(pitchName).join(", ")}</span>
    </button>
  );
  const batRow = (b: ManagerBat, onPick: () => void, extra?: React.ReactNode) => (
    <button key={b.id} className={row} disabled={!v.allowed} onClick={onPick}>
      <span className="w-8 font-mono text-white/60">{b.natural}</span>
      <span className="min-w-0 flex-1 truncate font-semibold">
        {b.name}
        {b.platoon && <span className="ml-1.5 rounded bg-emerald-500/25 px-1 text-[10px] text-emerald-200">platoon edge</span>}
      </span>
      <span className="w-6 text-center text-white/60">{b.bats}</span>
      {extra ?? (
        <>
          <span className="w-14 text-right tabular-nums">{b.hr ?? "—"} HR</span>
          <span className="w-14 text-right tabular-nums text-white/70">K {pct(b.kPct)}</span>
          <span className="hidden w-16 text-right tabular-nums text-white/70 sm:block">{b.ev ? `${b.ev.toFixed(1)} EV` : "—"}</span>
        </>
      )}
    </button>
  );
  const speed = (b: ManagerBat) => <span className="w-24 text-right tabular-nums">{b.sprint.toFixed(1)} ft/s</span>;
  const glove = (b: ManagerBat) => <span className="w-24 text-right tabular-nums">glove {Math.round(b.glove * 100)}</span>;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 p-3" onClick={onClose}>
      <div className="max-h-full w-full max-w-2xl overflow-auto rounded-xl border border-white/15 bg-[#10161d]/95 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-widest text-white/50">Manager</div>
            <div className="text-sm">
              On the mound: <span className="font-semibold">{v.pitcher.name}</span>{" "}
              <span className={v.pitcher.tired ? "font-semibold text-amber-300" : "text-white/60"}>
                · {v.pitcher.count} pitches{v.pitcher.runs ? `, ${v.pitcher.runs} R` : ""}
                {v.pitcher.tired ? " · tiring" : ""}
              </span>
            </div>
          </div>
          <button className="rounded-md bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="mb-3 flex gap-1.5">
          {tabs
            .filter((t) => t[2])
            .map(([k, label]) => (
              <button
                key={k}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${cur === k ? "bg-amber-300/25 text-amber-100" : "bg-white/5 text-white/75 hover:bg-white/10"}`}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
        </div>
        {!v.allowed && <div className="mb-2 rounded-md bg-white/5 px-3 py-2 text-xs text-white/60">Moves can be made between pitches.</div>}
        {cur === "pen" && (v.bullpen.length ? v.bullpen.map(arm) : <Empty>The bullpen is empty.</Empty>)}
        {cur === "ph" &&
          (v.bench.length ? (
            <>
              <div className="mb-1 px-2.5 text-[11px] text-white/50">Bat for {v.lineup.find((b) => b.id === v.batterId)?.name}:</div>
              {v.bench.map((b) => batRow(b, () => act({ kind: "pinchHit", inId: b.id })))}
            </>
          ) : (
            <Empty>No one left on the bench.</Empty>
          ))}
        {cur === "pr" && (
          <>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {v.runners.map((r) => (
                <button
                  key={r.base}
                  className={`rounded-md px-2.5 py-1 text-xs ${runBase === r.base ? "bg-sky-400/30 text-sky-100" : "bg-white/5 hover:bg-white/10"}`}
                  onClick={() => setRunBase(r.base)}
                >
                  {["1st", "2nd", "3rd"][r.base]}: {r.name}
                </button>
              ))}
            </div>
            {runBase == null ? (
              <Empty>Pick the runner to replace.</Empty>
            ) : v.bench.length ? (
              [...v.bench].sort((a, b) => b.sprint - a.sprint).map((b) => batRow(b, () => act({ kind: "pinchRun", base: runBase, inId: b.id }), speed(b)))
            ) : (
              <Empty>No one left on the bench.</Empty>
            )}
          </>
        )}
        {cur === "def" && (
          <>
            <div className="mb-1 px-2.5 text-[11px] text-white/50">Take out:</div>
            <div className="mb-3 grid grid-cols-1 gap-0.5 sm:grid-cols-2">
              {v.lineup.map((b) => (
                <button
                  key={b.id}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs ${outId === b.id ? "bg-sky-400/25 text-sky-100" : "hover:bg-white/10"}`}
                  onClick={() => setOutId(b.id)}
                >
                  <span className="w-8 font-mono text-white/60">{b.pos}</span>
                  <span className="truncate">{b.name}</span>
                </button>
              ))}
            </div>
            {outId == null ? (
              <Empty>Pick the player to replace; his sub takes the same spot in the order and the same position.</Empty>
            ) : v.bench.length ? (
              v.bench.map((b) => batRow(b, () => act({ kind: "defense", outId, inId: b.id }), glove(b)))
            ) : (
              <Empty>No one left on the bench.</Empty>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 py-3 text-xs text-white/55">{children}</div>;
}
