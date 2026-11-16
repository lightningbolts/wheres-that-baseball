"use client";

import { useMemo, useState } from "react";
import { MLB_TEAMS } from "@/lib/mlb/teams";
import { TeamLogo } from "@/components/ui/TeamLogo";
import type { NewLeagueOpts } from "@/lib/game/franchise/league";
import type { SlotMeta } from "@/lib/game/franchise/save";
import { cn } from "@/lib/utils";
import { Btn, Card, Segmented } from "./ui";

type Difficulty = NonNullable<NewLeagueOpts["difficulty"]>;

const PHASE: Record<SlotMeta["phase"], string> = {
  regular: "Regular season",
  postseason: "Postseason",
  offseason: "Offseason",
  freeagency: "Free agency",
  preseason: "Preseason",
};

export function NewFranchise({
  slots,
  onLoad,
  onDelete,
  onCreate,
}: {
  slots: Array<SlotMeta | null>;
  onLoad: (slot: number) => void;
  onDelete: (slot: number) => void;
  onCreate: (slot: number, opts: NewLeagueOpts) => void;
}) {
  const teams = useMemo(() => [...MLB_TEAMS].sort((a, b) => a.name.localeCompare(b.name)), []);
  const [team, setTeam] = useState<number>(teams[0]?.id ?? 147);
  const [difficulty, setDifficulty] = useState<Difficulty>("pro");
  const freeSlot = slots.findIndex((s) => !s);
  const [slot, setSlot] = useState(freeSlot >= 0 ? freeSlot : 0);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">2027 Season</h1>
        <p className="mt-1 max-w-2xl text-sm text-secondary">
          Run a club through a full 162-game season and postseason: set the lineup and rotation, make trades before the deadline, sign free agents,
          manage payroll under the luxury tax and keep the owner happy. Sim the days you want, and play any of your games yourself in the 3D ballpark.
        </p>
      </header>

      <Card title="Saved franchises">
        <div className="grid gap-2 sm:grid-cols-3">
          {slots.map((s, i) => (
            <div key={i} className="flex flex-col justify-between gap-2 rounded-lg border border-border p-3">
              {s ? (
                <>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-secondary">Slot {i + 1}</div>
                    <div className="font-semibold">{s.teamName}</div>
                    <div className="text-xs text-secondary">
                      {s.season} · {PHASE[s.phase]} · {s.record}
                    </div>
                    <div className="text-xs text-muted">Saved {new Date(s.savedAt).toLocaleString()}</div>
                  </div>
                  <div className="flex gap-2">
                    <Btn tone="primary" onClick={() => onLoad(i)}>
                      Continue
                    </Btn>
                    {confirmDelete === i ? (
                      <Btn
                        tone="danger"
                        onClick={() => {
                          setConfirmDelete(null);
                          onDelete(i);
                        }}
                      >
                        Delete for good?
                      </Btn>
                    ) : (
                      <Btn onClick={() => setConfirmDelete(i)}>Delete</Btn>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted">Slot {i + 1}: empty</div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card title="New franchise">
        <div className="space-y-4">
          <div>
            <div className="mb-2 text-xs uppercase tracking-wider text-secondary">Pick your club</div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
              {teams.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTeam(t.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm",
                    team === t.id ? "border-emerald-500 bg-emerald-500/10" : "border-border hover:bg-hover",
                  )}
                >
                  <TeamLogo teamId={t.id} size={20} />
                  <span className="truncate">{t.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <div className="mb-1 text-xs uppercase tracking-wider text-secondary">Difficulty (trades, free agency, manual games)</div>
              <Segmented<Difficulty>
                value={difficulty}
                onChange={setDifficulty}
                options={[
                  { v: "rookie", label: "Rookie" },
                  { v: "pro", label: "Pro" },
                  { v: "allstar", label: "All-Star" },
                ]}
              />
            </div>
            <div>
              <div className="mb-1 text-xs uppercase tracking-wider text-secondary">Save slot</div>
              <Segmented<string>
                value={String(slot)}
                onChange={(v) => setSlot(Number(v))}
                options={slots.map((s, i) => ({ v: String(i), label: `${i + 1}${s ? " (overwrite)" : ""}` }))}
              />
            </div>
          </div>
          <Btn tone="primary" className="px-5 py-2" onClick={() => onCreate(slot, { userTeam: team, seed: (Date.now() % 2_000_000_000) >>> 0, difficulty })}>
            Start the 2027 season
          </Btn>
        </div>
      </Card>
    </div>
  );
}
