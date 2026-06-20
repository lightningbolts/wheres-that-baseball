"use client";

import { useEffect, useRef } from "react";

/**
 * Fixed-interval polling that overlaps requests (up to `maxInFlight`) so pitch
 * latency is not gated on the previous round-trip finishing.
 */
export function useRapidPoll(
  poll: () => Promise<void>,
  intervalMs: number,
  maxInFlight: number,
  enabled: boolean,
  resetKey: unknown,
): void {
  const pollRef = useRef(poll);
  pollRef.current = poll;

  useEffect(() => {
    if (!enabled) return;

    let inFlight = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled || inFlight >= maxInFlight) return;
      inFlight += 1;
      void pollRef
        .current()
        .catch(() => {
          // Caller owns error handling inside poll.
        })
        .finally(() => {
          inFlight -= 1;
        });
    };

    tick();
    const intervalId = window.setInterval(tick, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [enabled, intervalMs, maxInFlight, resetKey]);
}
