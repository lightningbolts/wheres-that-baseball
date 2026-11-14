"use client";

import { useEffect, useMemo, useState } from "react";
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

type Mode = "play-away" | "play-home" | "watch";

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
            bat-ball collisions, drag and lift, the park&apos;s real fences. You pitch, hit and pick throws; fielders run their routes on their own.
          </p>
        </header>
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

  const rot = (id: number) => rosters.teams[String(id)]?.rotation ?? [];
  useEffect(() => setMyStarter(0), [mine]);
  useEffect(() => setOppStarter(Math.floor(Math.random() * Math.max(1, rot(opp).length))), [opp]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    const homeIsMine = mode !== "play-away";
    const human: HumanSide = mode === "watch" ? "none" : mode === "play-home" ? "home" : "away";
    onStart({
      awayTeamId: homeIsMine ? opp : mine,
      homeTeamId: homeIsMine ? mine : opp,
      human,
      innings,
      difficulty,
      seed: Math.floor(Math.random() * 2 ** 31),
      awayStarter: homeIsMine ? oppStarter : myStarter,
      homeStarter: homeIsMine ? myStarter : oppStarter,
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
        }, -1, mode === "watch" ? "Team A" : "Your team")}
        {teamSelect(opp, setOpp, mine, mode === "watch" ? "Team B" : "CPU opponent")}
        {starterSelect(mine, myStarter, setMyStarter, mode === "watch" ? "Team A starter" : "Your starting pitcher")}
        {starterSelect(opp, oppStarter, setOppStarter, mode === "watch" ? "Team B starter" : "CPU starting pitcher")}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <div className="mb-1 text-xs font-medium text-secondary">You are</div>
          {seg(mode, setMode, [
            ["play-home", "Home"],
            ["play-away", "Away"],
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
    ["Hitting", "Move the plate-coverage box over the ball and swing with Space or a click. Shift switches between contact and power swings (power has a smaller sweet spot and more bat speed). S sends the runner from first."],
    ["Fielding", "Fielders run to the ball on their own. When they field it you pick the throw (1–4 for the bases, H to hold), or let the AI choose."],
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
