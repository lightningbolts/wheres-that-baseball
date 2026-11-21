"use client";

import { useEffect, useMemo, useState } from "react";
import { rosterIndex } from "@/lib/game/franchise/manual";
import { pitchLogPlayers } from "@/lib/game/franchise/pitchReplay";
import { buildSeasonStatcast, type SeasonStatcast } from "@/lib/game/franchise/seasonStatcast";
import type { League } from "@/lib/game/franchise/types";
import type { RosterFile } from "@/lib/game/types";

export interface SeasonStatcastState {
  key: string;
  sc: SeasonStatcast | null;
  done: number;
  total: number;
  err?: boolean;
}

/** Loads (or replays) the season's pitch logs; null while working. */
export function useSeasonStatcast(league: League, season: number, split: "reg" | "post", rosters: RosterFile | null | undefined, slot: number | undefined) {
  const idx = useMemo(() => (rosters ? rosterIndex(rosters) : null), [rosters]);
  const [state, setState] = useState<SeasonStatcastState>({ key: "", sc: null, done: 0, total: 0 });
  // Re-read once more games are stored (a sim finished).
  const played = useMemo(() => league.schedule.filter((g) => g.result).length, [league.schedule]);
  const key = `${slot}:${season}:${split}:${played}`;
  useEffect(() => {
    if (slot == null) return;
    let dead = false;
    const who = pitchLogPlayers(league.players, idx);
    buildSeasonStatcast({
      slot,
      season,
      split,
      league,
      who,
      onProgress: (done, total) => !dead && setState({ key, sc: null, done, total }),
      cancelled: () => dead,
    })
      .then((sc) => !dead && sc && setState({ key, sc, done: 0, total: 0 }))
      .catch(() => !dead && setState({ key, sc: null, done: 0, total: 0, err: true }));
    return () => {
      dead = true;
    };
    // league changes on every action; the key covers what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, idx]);
  return state.key === key ? state : { key, sc: null, done: 0, total: 0 };
}
