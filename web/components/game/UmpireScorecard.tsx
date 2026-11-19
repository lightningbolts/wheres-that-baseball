"use client";

import type { BaseballGame } from "@/lib/game/rules/game";
import { getTeamById } from "@/lib/mlb/teams";
import { describeMiss, pct } from "@/lib/game/umpires/scorecard";

const p1 = (v: number) => `${(v * 100).toFixed(1)}%`;

/** One-line plate-umpire scorecard under the box score. */
export function UmpireScorecard({
  game,
  awayId,
  homeId,
}: {
  game: BaseballGame;
  awayId: number;
  homeId: number;
}) {
  const c = game.umpCard.card();
  if (!c.n) return null;
  const who = game.ump?.name ?? "Plate umpire";
  const abbr = (id: number) => getTeamById(id)?.abbrev ?? String(id);
  const fav =
    Math.abs(c.fav) < 0.005
      ? "even"
      : `${Math.abs(c.fav).toFixed(2)} runs to ${abbr(c.fav > 0 ? homeId : awayId)}`;
  return (
    <div className="rounded-md border border-white/10 px-2 py-1.5 text-white/70">
      <span className="font-semibold text-white">HP: {who}</span> · {c.n} called
      pitches, {c.n - c.ok} missed · accuracy {p1(pct(c.ok, c.n))} (expected{" "}
      {p1(pct(c.xa, c.n))}) · consistency {p1(pct(c.con, c.n))} · favor {fav}
      {c.big && (
        <div className="text-white/50">Biggest miss: {describeMiss(c.big)}</div>
      )}
    </div>
  );
}
