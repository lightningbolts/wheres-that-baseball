/** Drive a game pitch by pitch with any mix of human / CPU controllers. */
import { playPitch, type Controller, type PitchResult } from "@/lib/game/engine/atBat";
import { resolvePlay, type PlayResult } from "@/lib/game/play/resolvePlay";
import { BaseballGame, type GameEvent } from "@/lib/game/rules/game";
import { batSide } from "@/lib/game/ratings";
import { chargeBunt } from "@/lib/game/play/defense";
import type { Rng } from "@/lib/game/math";
import { cpuChallenge } from "@/lib/game/rules/abs";
import { cpuPickoff, pickoffOutcome } from "@/lib/game/ai/pickoff";
import { cpuWantsSteal, resolveSteal, stealRace, withPitchSpeed, type StealFrom } from "@/lib/game/ai/baserunning";

export interface Controllers {
  away: Controller;
  home: Controller;
  /** Offense's steal decision for this pitch; defaults to the CPU's. */
  wantsSteal?: (game: BaseballGame, rng: Rng) => StealFrom[] | null;
}

export interface PitchStep {
  /** Absent when the step was a pickoff throw instead of a pitch. */
  result?: PitchResult;
  play?: PlayResult;
  events: GameEvent[];
}

/** Resolve one pitch end to end (physics → fielding → rules). */
export function stepPitch(game: BaseballGame, ctl: Controllers, rng: Rng): PitchStep {
  const change = game.managePitching(rng);
  const pre: GameEvent[] = change ? [change] : [];
  // A throw over instead of a pitch (its own step, like GameSession's).
  if (game.pickoffs) {
    const from = cpuPickoff(game);
    if (from != null) return { events: [...pre, ...game.applyPickoff(from, pickoffOutcome(game, from))] };
  }
  const ctx = game.pitchContext();
  const pitching = game.top ? ctl.home : ctl.away;
  const batting = game.top ? ctl.away : ctl.home;
  const wants = (ctl.wantsSteal ?? cpuWantsSteal)(game, rng);
  const race = wants?.length ? stealRace(game, wants) : null;
  let result = playPitch(ctx, pitching, batting, rng);
  // ABS: CPU clubs challenge clear misses (deterministic, no dice).
  const absEvents: GameEvent[] = [];
  const challenger = game.absChallenger(result);
  if (challenger) {
    const by = cpuChallenge({
      result,
      zoneBottom: ctx.batter.zoneBottom,
      zoneTop: ctx.batter.zoneTop,
      balls: game.balls,
      strikes: game.strikes,
      outs: game.outs,
      inning: game.inning,
      regulation: game.regulation,
      left: game.abs?.[challenger] ?? 0,
      runnersOn: game.bases.filter(Boolean).length,
      margin: challenger === "away" ? game.score.away - game.score.home : game.score.home - game.score.away,
    });
    const r = by ? game.absChallenge(result, by) : null;
    if (r) {
      result = r.result;
      absEvents.push(r.event);
    }
  }
  let play: PlayResult | undefined;
  if (result.kind === "in_play" && result.path && result.contact) {
    const b = ctx.batter;
    const bases = game.bases;
    play = resolvePlay({
      path: result.path,
      park: game.park,
      fielders: result.bunt ? chargeBunt(game.fielders()) : game.fielders(),
      runners: [bases[0], bases[1], bases[2]].map((r, i) =>
        r ? { playerId: r.playerId, sprint: r.sprint, going: !!race?.legs.some((l) => l.from === i) } : null,
      ) as [
        { playerId: number; sprint: number } | null,
        { playerId: number; sprint: number } | null,
        { playerId: number; sprint: number } | null,
      ],
      batter: { playerId: b.id, sprint: b.sprint, bats: batSide(b, ctx.pitcher.throws), bunt: !!result.bunt },
      outs: game.outs,
      situation: { inning: game.inning, scoreDiff: game.top ? game.score.away - game.score.home : game.score.home - game.score.away },
      rng,
      launch: { ev: result.contact.exitSpeedMph ?? 0, la: result.contact.launchAngleDeg ?? 0 },
    });
  }
  const events = game.apply(result, play);
  // The runner was going: on a take or a miss the catcher throws (foul/in-play send him back or move him anyway).
  const noContact = result.kind === "called_strike" || result.kind === "swinging_strike" || (result.kind === "ball" && !result.wildPitch);
  if (race && noContact && !game.final && race.legs.every((l) => game.bases[l.from]?.playerId === l.runnerId)) {
    events.push(...game.applySteals(resolveSteal(withPitchSpeed(race, result.flight.releaseSpeedMph), rng)));
  }
  return { result, play, events: [...pre, ...absEvents, ...events] };
}

export function simulateGame(game: BaseballGame, ctl: Controllers, rng: Rng, maxPitches = 1200): BaseballGame {
  let n = 0;
  while (!game.final && n < maxPitches) {
    stepPitch(game, ctl, rng);
    n += 1;
  }
  return game;
}
