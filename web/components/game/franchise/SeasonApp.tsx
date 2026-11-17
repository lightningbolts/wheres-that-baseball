"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppNav } from "@/components/features/AppNav";
import { GameView } from "@/components/game/GameView";
import { clearSave, loadSave } from "@/components/game/save";
import { sfx } from "@/components/game/audio";
import { createLeague } from "@/lib/game/franchise/league";
import type { ProjectionFile } from "@/lib/game/franchise/projections";
import { boxFromSession, buildManualGame, recordManualResult, rosterIndex, type ManualGame } from "@/lib/game/franchise/manual";
import { deleteSlot, listSlots, loadLeague, saveLeague, SLOT_COUNT, type SlotMeta } from "@/lib/game/franchise/save";
import { advanceDay, prepareDay, simDone, userGameToday, type SimTarget } from "@/lib/game/franchise/season";
import type { League } from "@/lib/game/franchise/types";
import type { PitchInput } from "@/lib/game/session/session";
import type { RosterFile } from "@/lib/game/types";
import { FranchiseHub } from "./FranchiseHub";
import { NewFranchise } from "./NewFranchise";
import type { Act } from "./ui";

export interface SimState {
  label: string;
  done: number;
  total: number;
}

interface Manual extends ManualGame {
  inputs: PitchInput[];
}

export function SeasonApp() {
  const [rosters, setRosters] = useState<RosterFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<Array<SlotMeta | null> | null>(null);
  const [league, setLeague] = useState<League | null>(null);
  const [slot, setSlot] = useState(0);
  const [manual, setManual] = useState<Manual | null>(null);
  const [sim, setSim] = useState<SimState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const cancel = useRef(false);
  const proj = useRef<ProjectionFile | undefined>(undefined);
  const [projData, setProjData] = useState<ProjectionFile | undefined>(undefined);
  // Bumped by each sim run and by Save & exit: a run that no longer owns the token drops its result.
  const simToken = useRef(0);

  useEffect(() => {
    let alive = true;
    import("@/data/game/rosters.json")
      .then((m) => alive && setRosters((m.default ?? m) as unknown as RosterFile))
      .catch(() => alive && setError("Couldn't load rosters."));
    // Optional: without it a new league rates players on 2026 alone.
    import("@/data/game/franchise-proj.json")
      .then((m) => {
        if (!alive) return;
        proj.current = (m.default ?? m) as unknown as ProjectionFile;
        setProjData(proj.current);
      })
      .catch(() => undefined);
    listSlots()
      .then((s) => alive && setSlots(s))
      .catch(() => alive && setSlots(Array.from({ length: SLOT_COUNT }, () => null)));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const idx = useMemo(() => (rosters ? rosterIndex(rosters) : null), [rosters]);

  const persist = useCallback(
    (l: League) => {
      void saveLeague(l, slot).then((ok) => {
        if (!ok) setToast("Couldn't save (storage unavailable).");
      });
    },
    [slot],
  );

  const act: Act = useCallback(
    (fn, opts) => {
      if (!league) return;
      const next = structuredClone(league);
      let msg: string | void;
      try {
        msg = fn(next);
      } catch (e) {
        setToast(e instanceof Error ? e.message : "Something went wrong.");
        return;
      }
      setLeague(next);
      if (msg) setToast(msg);
      if (opts?.save !== false) persist(next);
    },
    [league, persist],
  );

  const runSim = useCallback(
    async (target: SimTarget, stopAtUserGame: boolean) => {
      if (!league || sim) return;
      const l = structuredClone(league);
      prepareDay(l);
      const start = l.day;
      const total =
        target === "day"
          ? 1
          : target === "week"
            ? 7
            : target === "deadline"
              ? Math.max(1, l.calendar.deadlineDay - l.day + 1)
              : target === "season"
                ? Math.max(1, l.calendar.endDay - l.day + 1)
                : 32;
      const label = { day: "Simming a day", week: "Simming a week", deadline: "Simming to the deadline", season: "Simming the season", postseason: "Simming the postseason", series: "Simming the series" }[target];
      cancel.current = false;
      const token = ++simToken.current;
      setSim({ label, done: 0, total });
      let n = 0;
      while (!simDone(l, target, start) && n < 400) {
        if (l.phase !== "regular" && l.phase !== "postseason") break;
        if (cancel.current) break;
        // Stop before simming any of the user's games, today's included ("Sim today" passes false).
        if (stopAtUserGame && userGameToday(l)) break;
        advanceDay(l);
        n += 1;
        if (n % 3 === 0) {
          setSim({ label, done: n, total });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (token !== simToken.current) return;
      prepareDay(l);
      setSim(null);
      setLeague(l);
      persist(l);
      if (stopAtUserGame && userGameToday(l) && !simDone(l, target, start)) setToast("Stopped: your club plays today.");
    },
    [league, sim, persist],
  );

  const startManual = useCallback(
    (gameId: number) => {
      if (!league || !idx) return;
      const l = structuredClone(league);
      const m = buildManualGame(l, gameId, idx);
      if (!m) {
        setToast("This game can't be played manually (roster incomplete).");
        return;
      }
      const saved = loadSave();
      const inputs = saved && saved.setup.seed === m.setup.seed && saved.setup.homeTeamId === m.setup.homeTeamId ? saved.inputs : [];
      if (!inputs.length) clearSave();
      setLeague(l);
      persist(l);
      sfx.unlock();
      setManual({ ...m, inputs });
    },
    [league, idx, persist],
  );

  if (manual && league) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
        <AppNav />
        <GameView
          key={`${manual.setup.seed}-${manual.inputs.length}`}
          setup={manual.setup}
          teams={manual.teams}
          inputs={manual.inputs}
          onGameOver={({ awayRuns, homeRuns, session }) => {
            const l = structuredClone(league);
            if (recordManualResult(l, manual.game.id, boxFromSession(session, awayRuns, homeRuns))) {
              setLeague(l);
              persist(l);
              clearSave();
            }
          }}
          onExit={() => setManual(null)}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-4 sm:py-8">
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!error && (!rosters || !slots) && <p className="text-sm text-secondary">Loading…</p>}
        {rosters && slots && !league && (
          <NewFranchise
            slots={slots}
            onLoad={async (s) => {
              const l = await loadLeague(s);
              if (!l) {
                setToast("That save couldn't be read.");
                return;
              }
              prepareDay(l);
              setSlot(s);
              setLeague(l);
            }}
            onDelete={async (s) => {
              await deleteSlot(s);
              setSlots(await listSlots());
            }}
            onCreate={(s, opts) => {
              const l = createLeague(rosters, { ...opts, proj: proj.current });
              setSlot(s);
              setLeague(l);
              void saveLeague(l, s);
            }}
          />
        )}
        {league && (
          <FranchiseHub
            league={league}
            act={act}
            sim={sim}
            onSim={runSim}
            onCancelSim={() => {
              cancel.current = true;
            }}
            onPlay={startManual}
            onQuit={async () => {
              cancel.current = true;
              simToken.current += 1;
              setSim(null);
              setLeague(null);
              setSlots(await listSlots());
            }}
            slot={slot}
            rosters={rosters}
            proj={projData}
          />
        )}
      </main>
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div className="pointer-events-auto max-w-md rounded-lg border border-border bg-surface-elevated px-4 py-2 text-sm shadow-lg">{toast}</div>
        </div>
      )}
    </div>
  );
}
