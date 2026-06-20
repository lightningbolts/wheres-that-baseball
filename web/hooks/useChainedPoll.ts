"use client";

import { useEffect, useRef } from "react";

/**
 * Runs `poll` in a loop with at least `minGapMs` between the start of each attempt.
 * The next cycle begins as soon as the previous fetch finishes (no fixed interval tail).
 * On tab focus / visibility resume, polls immediately to catch up missed at-bats.
 */
export function useChainedPoll(
  poll: () => Promise<void>,
  minGapMs: number,
  enabled: boolean,
  resetKey: unknown,
): void {
  const pollRef = useRef(poll);
  pollRef.current = poll;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timeoutId = 0;
    let running = false;
    let pendingCatchUp = false;

    const run = async () => {
      if (cancelled) return;
      if (running) {
        pendingCatchUp = true;
        return;
      }

      running = true;
      pendingCatchUp = false;
      const started = performance.now();

      try {
        await pollRef.current();
      } catch {
        // Caller owns error handling inside poll.
      } finally {
        running = false;
      }

      if (cancelled) return;

      if (pendingCatchUp) {
        void run();
        return;
      }

      const elapsed = performance.now() - started;
      const delay = Math.max(0, minGapMs - elapsed);
      timeoutId = window.setTimeout(() => void run(), delay);
    };

    const catchUp = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      window.clearTimeout(timeoutId);
      void run();
    };

    void run();
    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("focus", catchUp);
    window.addEventListener("pageshow", catchUp);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("focus", catchUp);
      window.removeEventListener("pageshow", catchUp);
    };
  }, [enabled, minGapMs, resetKey]);
}
