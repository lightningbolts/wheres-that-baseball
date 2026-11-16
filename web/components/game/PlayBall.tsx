"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppNav } from "@/components/features/AppNav";
import { MLB_TEAMS, getTeamById } from "@/lib/mlb/teams";
import { getTeamColor } from "@/lib/mlb/teamColors";
import { teamsFromRosters, type Difficulty, type GameSetup, type HumanSide, type PitchInput } from "@/lib/game/session/session";
import type { RosterFile } from "@/lib/game/types";
import type { TeamModel } from "@/lib/game/ratings";
import { GameView } from "@/components/game/GameView";
import { clearSave, loadSave, type SavedGame } from "@/components/game/save";
import { DIFFICULTY } from "@/lib/game/session/humanInput";
import { sfx } from "@/components/game/audio";

type Mode = "play-away" | "play-home" | "two-player" | "watch";

export function PlayBall() {
  const [rosters, setRosters] = useState<RosterFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [game, setGame] = useState<{ setup: GameSetup; inputs: PitchInput[] } | null>(null);
  const [save, setSave] = useState<SavedGame | null>(null);

  useEffect(() => {
    let alive = true;
    import("@/data/game/rosters.json")
      .then((m) => alive && setRosters((m.default ?? m) as unknown as RosterFile))
      .catch(() => alive && setError("Couldn't load rosters."));
    setSave(loadSave());
    return () => {
      alive = false;
    };
  }, []);

  const teams = useMemo<Map<number, TeamModel> | null>(() => (rosters ? teamsFromRosters(rosters) : null), [rosters]);

  if (game && teams) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
        <AppNav />
        <GameView
          key={`${game.setup.seed}-${game.inputs.length}`}
          setup={game.setup}
          teams={teams}
          inputs={game.inputs}
          onExit={() => {
            setGame(null);
            setSave(loadSave());
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppNav />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Play Ball</h1>
          <p className="mt-1 max-w-2xl text-sm text-secondary">
            Nine innings against the CPU with real rosters. Every pitch, swing and batted ball runs through the same physics: Statcast pitch movement,
            bat-ball collisions, drag and lift, the park&apos;s real fences. You pitch and hit; the defense fields and throws on its own.
          </p>
        </header>
        <Link
          href="/play/season"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 hover:bg-hover"
        >
          <div>
            <div className="text-xs uppercase tracking-wider text-secondary">New: franchise mode</div>
            <div className="text-base font-semibold">2027 Season</div>
            <div className="text-xs text-secondary">Run a club through 162 games and the postseason: trades, free agency, payroll, and play any game yourself.</div>
          </div>
          <span className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">Start</span>
        </Link>
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!rosters && !error && <p className="text-sm text-secondary">Loading rosters…</p>}
        {rosters && teams && (
          <>
            {save && teams.has(save.setup.awayTeamId) && teams.has(save.setup.homeTeamId) && (
              <ResumeCard
                save={save}
                onResume={() => {
                  sfx.unlock();
                  setGame({ setup: save.setup, inputs: save.inputs });
                }}
                onDiscard={() => {
                  clearSave();
                  setSave(null);
                }}
              />
            )}
            <SetupForm
              rosters={rosters}
              onStart={(setup) => {
                sfx.unlock();
                clearSave();
                setGame({ setup, inputs: [] });
              }}
            />
            <Controls />
          </>
        )}
      </main>
    </div>
  );
}

function ResumeCard({ save, onResume, onDiscard }: { save: SavedGame; onResume: () => void; onDiscard: () => void }) {
  const a = getTeamById(save.setup.awayTeamId);
  const h = getTeamById(save.setup.homeTeamId);
  return (
    <section className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-secondary">Game in progress</div>
        <div className="text-base font-semibold">
          {a?.name ?? save.setup.awayTeamId} at {h?.name ?? save.setup.homeTeamId}
        </div>
        <div className="text-xs text-secondary">
          {save.inputs.length} pitches · saved {new Date(save.savedAt).toLocaleString()}
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onDiscard} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-hover">
          Discard
        </button>
        <button type="button" onClick={onResume} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
          Resume
        </button>
      </div>
    </section>
  );
}

function SetupForm({ rosters, onStart }: { rosters: RosterFile; onStart: (s: GameSetup) => void }) {
  const available = useMemo(() => MLB_TEAMS.filter((t) => rosters.teams[String(t.id)]), [rosters]);
  const [mine, setMine] = useState<number>(() => available[0]?.id ?? 0);
  const [opp, setOpp] = useState<number>(() => available[1]?.id ?? 0);
  const [mode, setMode] = useState<Mode>("play-home");
  const [innings, setInnings] = useState(9);
  const [difficulty, setDifficulty] = useState<Difficulty>("pro");
  const [myStarter, setMyStarter] = useState(0);
  const [oppStarter, setOppStarter] = useState(() => Math.floor(Math.random() * 5));
  const [abs, setAbs] = useState(true);
  const [hidePitch, setHidePitch] = useState(true);
  const two = mode === "two-player";

  const rot = (id: number) => rosters.teams[String(id)]?.rotation ?? [];
  useEffect(() => setMyStarter(0), [mine]);
  useEffect(() => setOppStarter(Math.floor(Math.random() * Math.max(1, rot(opp).length))), [opp]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    // Two players: "mine" is P1 (away), the other club is P2 (home).
    const homeIsMine = mode !== "play-away" && mode !== "two-player";
    const human: HumanSide = mode === "watch" ? "none" : mode === "two-player" ? "both" : mode === "play-home" ? "home" : "away";
    onStart({
      awayTeamId: homeIsMine ? opp : mine,
      homeTeamId: homeIsMine ? mine : opp,
      human,
      innings,
      difficulty,
      seed: Math.floor(Math.random() * 2 ** 31),
      manager: true,
      awayStarter: homeIsMine ? oppStarter : myStarter,
      homeStarter: homeIsMine ? myStarter : oppStarter,
      abs,
      hidePitch: two ? hidePitch : undefined,
    });
  };

  const sel = "w-full rounded-md border border-border bg-background px-2 py-2 text-sm";
  const teamSelect = (value: number, set: (n: number) => void, exclude: number, label: string) => (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-secondary">{label}</span>
      <div className="flex items-center gap-2">
        <span className="h-8 w-1.5 shrink-0 rounded" style={{ background: getTeamColor(value) }} />
        <select className={sel} value={value} onChange={(e) => set(Number(e.target.value))}>
          {available
            .filter((t) => t.id !== exclude)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      </div>
    </label>
  );
  const starterSelect = (teamId: number, value: number, set: (n: number) => void, label: string) => (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-secondary">{label}</span>
      <select className={sel} value={value} onChange={(e) => set(Number(e.target.value))}>
        {rot(teamId).map((p, i) => (
          <option key={p.id} value={i}>
            {p.name} {p.throws ? `(${p.throws}HP)` : ""}
          </option>
        ))}
      </select>
    </label>
  );
  const seg = <T extends string | number>(value: T, set: (v: T) => void, opts: Array<[T, string]>) => (
    <div className="flex flex-wrap gap-1">
      {opts.map(([v, l]) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => set(v)}
          className={`rounded-md border px-3 py-1.5 text-sm ${value === v ? "border-emerald-500 bg-emerald-600 text-white" : "border-border hover:bg-hover"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );

  return (
    <section className="space-y-5 rounded-xl border border-border bg-surface p-4 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {teamSelect(mine, (n) => {
          setMine(n);
          if (n === opp) setOpp(available.find((t) => t.id !== n)?.id ?? opp);
        }, -1, mode === "watch" ? "Team A" : two ? "Player 1 (away)" : "Your team")}
        {teamSelect(opp, setOpp, mine, mode === "watch" ? "Team B" : two ? "Player 2 (home)" : "CPU opponent")}
        {starterSelect(mine, myStarter, setMyStarter, mode === "watch" ? "Team A starter" : two ? "Player 1 starter" : "Your starting pitcher")}
        {starterSelect(opp, oppStarter, setOppStarter, mode === "watch" ? "Team B starter" : two ? "Player 2 starter" : "CPU starting pitcher")}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <div className="mb-1 text-xs font-medium text-secondary">You are</div>
          {seg(mode, setMode, [
            ["play-home", "Home"],
            ["play-away", "Away"],
            ["two-player", "2 players"],
            ["watch", "Watch CPU"],
          ])}
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-secondary">Innings</div>
          {seg(innings, setInnings, [
            [3, "3"],
            [6, "6"],
            [9, "9"],
          ])}
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-secondary">Difficulty</div>
          {seg(difficulty, setDifficulty, (Object.keys(DIFFICULTY) as Difficulty[]).map((d) => [d, DIFFICULTY[d].label] as [Difficulty, string]))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-600" checked={abs} onChange={(e) => setAbs(e.target.checked)} />
          <span>
            <span className="font-medium">ABS challenges</span>
            <span className="block text-xs text-secondary">Two challenges a club on called balls and strikes; the automated zone decides and a winning challenge is kept.</span>
          </span>
        </label>
        {two && (
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-600" checked={hidePitch} onChange={(e) => setHidePitch(e.target.checked)} />
            <span>
              <span className="font-medium">Pass the device</span>
              <span className="block text-xs text-secondary">A cover screen hides each pitch while it&apos;s picked, so the hitter can&apos;t see it. Off for couch play on the honor system.</span>
            </span>
          </label>
        )}
      </div>
      <p className="text-xs text-secondary">
        The game is at the home team&apos;s ballpark: real fence distances and wall heights, with altitude and temperature in the air density.
      </p>
      <button type="button" onClick={start} className="w-full rounded-lg bg-emerald-600 py-3 text-base font-bold text-white hover:bg-emerald-500 sm:w-auto sm:px-10">
        Play ball
      </button>
    </section>
  );
}

function Controls() {
  const rows: Array<[string, string]> = [
    ["Pitching", "Pick a pitch (1–5), aim with the mouse or arrows, click or Space to set it, then stop the meter in the middle. A worse stop costs command."],
    ["Hitting", "You see the pitch from the catcher's view. Move the yellow coverage box over the ball (mouse, arrows, or drag on a touch screen) and swing with Space, a click or the Swing button just before it arrives. Every pitch leaves a numbered marker where it crossed the zone. Shift switches between contact and power swings (power has a smaller sweet spot and more bat speed). S sends the runner from first."],
    ["Fielding", "Fully automatic: fielders run to the ball and make the throws themselves, and the play never stops to wait for you."],
    ["ABS challenges", "After a called ball or strike that goes against you, press C (or tap Challenge) within a few seconds. The automated zone reviews it; win and you keep the challenge. The CPU challenges too."],
    ["Two players", "One device, hot seat: P1 is the away club, P2 the home club. The pitcher picks and throws, then the hitter takes the controls and calls for the pitch. Each player manages his own club with M on his turn."],
    ["Other", "T for fast-forward, Sim ½ to sim the rest of a half-inning. The game saves after every pitch."],
  ];
  return (
    <section className="mt-6 grid gap-3 sm:grid-cols-2">
      {rows.map(([h, t]) => (
        <div key={h} className="rounded-lg border border-border p-3">
          <div className="text-sm font-semibold">{h}</div>
          <p className="mt-1 text-xs text-secondary">{t}</p>
        </div>
      ))}
    </section>
  );
}
