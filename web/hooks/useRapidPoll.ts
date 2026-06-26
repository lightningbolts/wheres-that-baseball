"use client";

import { useEffect, useRef } from "react";

/**
 * Fixed-interval polling that overlaps requests (up to `maxInFlight`) so pitch
 * latency is not gated on the previous round-trip finishing. Hidden tabs may
 * throttle timers, so focus/visibility events trigger an immediate catch-up.
 */
export function useRapidPoll(
  poll: () => Promise<void>,
  intervalMs: number,
  maxInFlight: number,
  enabled: boolean,
  resetKey: unknown,
  onError?: (error: unknown) => void,
): void {
  const pollRef = useRef(poll);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useEffect(() => {
    if (!enabled) return;

    let inFlight = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled || inFlight >= maxInFlight) return;
      inFlight += 1;
      void pollRef
        .current()
        .catch((err) => {
          onError?.(err);
        })
        .finally(() => {
          inFlight -= 1;
        });
    };

    tick();
    const intervalId = window.setInterval(tick, intervalMs);
    const catchUp = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      tick();
    };

    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("focus", catchUp);
    window.addEventListener("pageshow", catchUp);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("focus", catchUp);
      window.removeEventListener("pageshow", catchUp);
    };
  }, [enabled, intervalMs, maxInFlight, resetKey]);
}
