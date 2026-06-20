"use client";

import { useEffect, useRef } from "react";

/**
 * Fixed-interval poll loop. Overlaps requests when a fetch outlasts the interval
 * so pitch latency is not gated on the previous round-trip finishing.
 */
export function useIntervalPoll(
  poll: () => void | Promise<void>,
  intervalMs: number,
  enabled: boolean,
  resetKey: unknown,
): void {
  const pollRef = useRef(poll);
  pollRef.current = poll;

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      void pollRef.current();
    };

    tick();
    const intervalId = window.setInterval(tick, intervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, intervalMs, resetKey]);
}
