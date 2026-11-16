// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BREAK_LINGER_MS, useBreakLinger, type BreakLingerResult } from "@/hooks/useBreakLinger";
import type { LiveGameState, PlayByPlayEntry, PlayPitch } from "@/types/mlb-live";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pitch = (balls: number, strikes: number) => ({ balls, strikes }) as PlayPitch;

function state(over: Partial<LiveGameState>): LiveGameState {
  return {
    gamePk: 1,
    gameStatus: "Live",
    inning: 3,
    inningState: "Top",
    inningHalf: "top",
    batterId: 10,
    batterName: "A",
    pitcherId: 99,
    pitcherName: "P",
    balls: 0,
    strikes: 0,
    outs: 2,
    awayRuns: 0,
    homeRuns: 0,
    atBatPitches: [],
    plays: [],
    ...over,
  } as LiveGameState;
}

let root: Root;
const seen: { out: BreakLingerResult | null } = { out: null };
function Probe({ s, sink }: { s: LiveGameState | null; sink: (r: BreakLingerResult) => void }) {
  sink(useBreakLinger(s));
  return null;
}
const render = (s: LiveGameState | null) => act(() => root.render(createElement(Probe, { s, sink: (r: BreakLingerResult) => (seen.out = r) })));

describe("useBreakLinger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    root = createRoot(document.createElement("div"));
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("holds the final at-bat through the break, then shows the break UI", () => {
    const pitches = [pitch(0, 1), pitch(0, 2)];
    render(state({ atBatPitches: pitches, strikes: 2 }));
    expect(seen.out!.showBreakUI).toBe(false);
    expect(seen.out!.atBatViewState?.atBatPitches).toHaveLength(2);

    const brk = state({ inningState: "Middle", atBatPitches: [], batterId: 20, plays: [] as PlayByPlayEntry[] });
    render(brk);
    expect(seen.out!.isLingering).toBe(true);
    expect(seen.out!.showBreakUI).toBe(false);
    expect(seen.out!.atBatViewState?.batterId).toBe(10);
    expect(seen.out!.atBatViewState?.atBatPitches).toHaveLength(2);

    act(() => vi.advanceTimersByTime(BREAK_LINGER_MS + 50));
    expect(seen.out!.isLingering).toBe(false);
    expect(seen.out!.showBreakUI).toBe(true);
    expect(seen.out!.atBatViewState).toBe(brk);

    // Re-rendering the same break doesn't restart the linger.
    render(brk);
    expect(seen.out!.showBreakUI).toBe(true);
  });

  it("passes active play straight through and resets on a new game", () => {
    const s = state({ atBatPitches: [pitch(1, 0)] });
    render(s);
    expect(seen.out!.atBatViewState).toBe(s);
    expect(seen.out!.isLingering).toBe(false);
    const next = state({ gamePk: 2, inningState: "End", atBatPitches: [] });
    render(next);
    // No at-bat seen in game 2: waits for the feed briefly, then shows the break.
    expect(seen.out!.atBatViewState).toBe(next);
    act(() => vi.advanceTimersByTime(6000));
    expect(seen.out!.showBreakUI).toBe(true);
  });
});
