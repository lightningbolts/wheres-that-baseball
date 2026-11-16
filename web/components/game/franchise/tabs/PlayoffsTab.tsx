"use client";

import { ROUND_NAME, ROUNDS } from "@/lib/game/franchise/postseason";
import { playoffSeeds } from "@/lib/game/franchise/standings";
import type { League, Series } from "@/lib/game/franchise/types";
import type { MLBLeague } from "@/lib/mlb/teams";
import { cn } from "@/lib/utils";
import { Card, TeamDot, type TabProps } from "../ui";

function SeriesCard({ league, s }: { league: League; s: Series }) {
  const row = (id: number, seed: number, w: number) => {
    const t = league.teams[id];
    const won = s.winner === id;
    const lost = s.winner != null && !won;
    return (
      <div className={cn("flex items-center justify-between gap-2", lost && "text-muted", id === league.userTeam && "font-semibold")}>
        <span className="flex items-center gap-1">
          {seed > 0 && <span className="w-3 text-[10px] text-secondary">{seed}</span>}
          <TeamDot id={id} abbrev={t?.abbrev ?? "?"} />
        </span>
        <span className={cn("tabular-nums", won && "text-emerald-500")}>{w}</span>
      </div>
    );
  };
  return (
    <div className={cn("rounded-lg border p-2 text-sm", s.hi === league.userTeam || s.lo === league.userTeam ? "border-emerald-500/60" : "border-border")}>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-secondary">
        Best of {s.bestOf}
        {s.winner ? " · final" : ""}
      </div>
      {row(s.hi, s.hiSeed, s.wins[0])}
      {row(s.lo, s.loSeed, s.wins[1])}
    </div>
  );
}

function Projected({ league }: { league: League }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(["AL", "NL"] as MLBLeague[]).map((lg) => (
        <Card key={lg} title={`${lg} seeds if the season ended today`}>
          <ol className="space-y-1 text-sm">
            {playoffSeeds(league, lg).map((id, i) => {
              const t = league.teams[id];
              return (
                <li key={id} className={cn("flex justify-between", id === league.userTeam && "font-semibold text-emerald-500")}>
                  <span>
                    <span className="mr-2 text-muted">{i + 1}</span>
                    <TeamDot id={id} abbrev={t.name} />
                  </span>
                  <span className="tabular-nums text-secondary">
                    {t.w}-{t.l}
                    {i < 2 ? " · bye" : i < 3 ? " · division" : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
      ))}
    </div>
  );
}

export function PlayoffsTab({ league }: TabProps) {
  const b = league.bracket;
  if (!b || league.phase === "regular") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-secondary">
          Twelve teams make it: three division winners and three wild cards per league. Seeds 1–2 get byes; 3–6 play a best-of-3 Wild Card Series at the higher
          seed, then best-of-5 Division Series, best-of-7 LCS and World Series.
        </p>
        {league.phase === "regular" && <Projected league={league} />}
        {!b && league.phase !== "regular" && <p className="text-sm text-secondary">No bracket this season.</p>}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {b.champion && (
        <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4 text-center">
          <div className="text-xs uppercase tracking-wider text-secondary">{league.season} World Series champions</div>
          <div className="mt-1 text-xl font-bold">
            <TeamDot id={b.champion} abbrev={league.teams[b.champion].name} />
          </div>
        </div>
      )}
      <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        <div className="grid min-w-[44rem] grid-cols-4 gap-3">
          {ROUNDS.map((r) => {
            const list = b.series.filter((s) => s.round === r);
            return (
              <div key={r} className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-secondary">{ROUND_NAME[r]}</div>
                {(["AL", "NL", "MLB"] as const).map((lg) => {
                  const ss = list.filter((s) => s.league === lg);
                  if (!ss.length) return null;
                  return (
                    <div key={lg} className="space-y-2">
                      {r !== "ws" && <div className="text-[10px] uppercase text-muted">{lg}</div>}
                      {ss.map((s) => (
                        <SeriesCard key={s.id} league={league} s={s} />
                      ))}
                    </div>
                  );
                })}
                {!list.length && <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted">TBD</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
