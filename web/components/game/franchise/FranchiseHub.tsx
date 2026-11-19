"use client";

import { useState } from "react";
import { payroll } from "@/lib/game/franchise/contracts";
import { faFinished, faRound } from "@/lib/game/franchise/freeAgency";
import { startNextSeason, startOffseason } from "@/lib/game/franchise/offseason";
import { fmtDate } from "@/lib/game/franchise/schedule";
import { userGameToday, type SimTarget } from "@/lib/game/franchise/season";
import type { League } from "@/lib/game/franchise/types";
import { cbtThreshold } from "@/lib/game/franchise/data";
import { cn } from "@/lib/utils";
import type { SimState } from "./SeasonApp";
import { Btn, money, TeamDot, type Act } from "./ui";
import { Dashboard } from "./tabs/Dashboard";
import { RosterTab } from "./tabs/RosterTab";
import { LineupTab } from "./tabs/LineupTab";
import { StandingsTab } from "./tabs/StandingsTab";
import { StatsTab } from "./tabs/StatsTab";
import { ProfilesProvider } from "./Profiles";
import type { ProjectionFile } from "@/lib/game/franchise/projections";
import type { RosterFile } from "@/lib/game/types";
import { TradesTab } from "./tabs/TradesTab";
import { FreeAgencyTab } from "./tabs/FreeAgencyTab";
import { FinancesTab } from "./tabs/FinancesTab";
import { PlayoffsTab } from "./tabs/PlayoffsTab";
import { UmpiresTab } from "./tabs/UmpiresTab";

const TABS = [
  { id: "home", label: "Dashboard" },
  { id: "roster", label: "Roster" },
  { id: "lineup", label: "Lineup" },
  { id: "standings", label: "Standings" },
  { id: "stats", label: "Stats" },
  { id: "umps", label: "Umpires" },
  { id: "trades", label: "Trades" },
  { id: "fa", label: "Free Agency" },
  { id: "fin", label: "Finances" },
  { id: "playoffs", label: "Playoffs" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const PHASE_LABEL: Record<League["phase"], string> = {
  regular: "Regular season",
  postseason: "Postseason",
  offseason: "Offseason",
  freeagency: "Free agency",
  preseason: "Preseason",
};

export function FranchiseHub({
  league,
  act,
  sim,
  onSim,
  onCancelSim,
  onPlay,
  onQuit,
  slot,
  rosters,
  proj,
}: {
  league: League;
  act: Act;
  sim: SimState | null;
  onSim: (t: SimTarget, stopAtUserGame: boolean) => void;
  onCancelSim: () => void;
  onPlay: (gameId: number) => void;
  onQuit: () => void;
  slot: number;
  rosters?: RosterFile | null;
  proj?: ProjectionFile;
}) {
  const [tab, setTab] = useState<TabId>("home");
  const [stopOnMine, setStopOnMine] = useState(false);
  const t = league.teams[league.userTeam];
  const pay = payroll(league, t.id);
  const today = userGameToday(league);
  const inSeason = league.phase === "regular" || league.phase === "postseason";
  const dateStr = league.phase === "regular" || league.phase === "postseason" ? fmtDate(league.calendar, league.day, true) : league.opening ? `winter before ${league.season}` : `${league.season} offseason`;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-secondary">
            {league.season} · {PHASE_LABEL[league.phase]} · {dateStr} · slot {slot + 1}
          </div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
            <TeamDot id={t.id} abbrev={t.name} />
            <span className="tabular-nums text-secondary">
              {t.w}-{t.l}
            </span>
          </h1>
          <div className="text-xs text-secondary">
            Payroll {money(pay)} · CBT line {money(cbtThreshold(league.season))} · budget {money(t.fin.budget)} · owner {t.fin.ownerMood}/100
          </div>
        </div>
        <Btn onClick={onQuit}>Save & exit</Btn>
      </header>

      <section className="rounded-xl border border-border bg-surface p-3">
        {sim ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm">{sim.label}…</div>
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-border">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, (sim.done / Math.max(1, sim.total)) * 100)}%` }} />
              </div>
            </div>
            <Btn onClick={onCancelSim}>Stop</Btn>
          </div>
        ) : inSeason ? (
          <div className="flex flex-wrap items-center gap-2">
            {today && !today.result && (
              <Btn tone="primary" onClick={() => onPlay(today.id)}>
                {league.pending?.gameId === today.id ? "Resume" : "Play"} today vs {league.teams[today.home === t.id ? today.away : today.home].abbrev}
              </Btn>
            )}
            <Btn onClick={() => onSim("day", false)}>{today && !today.result ? "Sim today" : "Next day"}</Btn>
            {league.phase === "regular" && (
              <>
                <Btn onClick={() => onSim("week", stopOnMine)}>Sim week</Btn>
                {league.day <= league.calendar.deadlineDay && <Btn onClick={() => onSim("deadline", stopOnMine)}>To deadline</Btn>}
                <Btn onClick={() => onSim("season", stopOnMine)}>To end of season</Btn>
              </>
            )}
            {league.phase === "postseason" && <Btn onClick={() => onSim("postseason", stopOnMine)}>Sim postseason</Btn>}
            <label className="ml-auto flex items-center gap-1.5 text-xs text-secondary">
              <input type="checkbox" checked={stopOnMine} onChange={(e) => setStopOnMine(e.target.checked)} />
              Stop on my games
            </label>
          </div>
        ) : league.phase === "offseason" ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-secondary">The {league.season} season is over.</span>
            <Btn
              tone="primary"
              onClick={() =>
                act((l) => {
                  startOffseason(l);
                  return "Contracts expired, players aged, the draft is done. Free agency is open.";
                })
              }
            >
              Begin offseason
            </Btn>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-secondary">
              Free agency round {Math.min((league.fa?.round ?? 0) + 1, league.fa?.rounds ?? 10)} of {league.fa?.rounds ?? 10}
            </span>
            {!faFinished(league) && (
              <Btn
                onClick={() =>
                  act((l) => {
                    const signed = faRound(l);
                    return `${signed.length} player${signed.length === 1 ? "" : "s"} signed this round.`;
                  })
                }
              >
                Next round
              </Btn>
            )}
            <Btn
              tone="primary"
              onClick={() =>
                act((l) => {
                  startNextSeason(l);
                  return `Welcome to ${l.season}!`;
                })
              }
            >
              {faFinished(league) ? `Start ${league.opening ? league.season : league.season + 1}` : `Finish free agency & start ${league.opening ? league.season : league.season + 1}`}
            </Btn>
          </div>
        )}
      </section>

      <nav className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-1 border-b border-border">
          {TABS.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setTab(x.id)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm",
                tab === x.id ? "border-emerald-500 font-semibold text-foreground" : "border-transparent text-secondary hover:text-foreground",
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
      </nav>

      <ProfilesProvider league={league} rosters={rosters} proj={proj}>
        <div className={cn(sim && "pointer-events-none opacity-60")}>
          {tab === "home" && <Dashboard league={league} act={act} onPlay={onPlay} />}
          {tab === "roster" && <RosterTab league={league} act={act} />}
          {tab === "lineup" && <LineupTab league={league} act={act} />}
          {tab === "standings" && <StandingsTab league={league} act={act} />}
          {tab === "stats" && <StatsTab league={league} act={act} />}
          {tab === "umps" && <UmpiresTab league={league} act={act} />}
          {tab === "trades" && <TradesTab league={league} act={act} />}
          {tab === "fa" && <FreeAgencyTab league={league} act={act} />}
          {tab === "fin" && <FinancesTab league={league} act={act} />}
          {tab === "playoffs" && <PlayoffsTab league={league} act={act} />}
        </div>
      </ProfilesProvider>
    </div>
  );
}
