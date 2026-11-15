/**
 * Headless CPU-vs-CPU season sim: plays N full 9-inning games with real rosters
 * and physics, then compares league totals to MLB norms.
 *   npm run sim-season -- [games=300] [seed=1] [--log]
 */
import rosters from "../data/game/rosters.json";
import { teamModel } from "../lib/game/ratings";
import type { RosterFile } from "../lib/game/types";
import { leagueSummary } from "../lib/game/engine/leagueStats";
import { simulateSeason } from "../lib/game/engine/season";

const games = Number(process.argv[2] ?? 300);
const seed = Number(process.argv[3] ?? 1);
const teams = Object.values((rosters as unknown as RosterFile).teams).map(teamModel);
const t0 = Date.now();
const played = simulateSeason(teams, games, seed);
const s = leagueSummary(played);
console.log(`${games} games in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.table(s.table);
if (process.argv.includes("--log")) for (const e of played[0].log) if (e.kind !== "pitch") console.log(e.inning, e.top ? "T" : "B", e.text);
