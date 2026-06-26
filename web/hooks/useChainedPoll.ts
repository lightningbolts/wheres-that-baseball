"use client";

import { useEffect, useRef } from "react";

/**
 * Runs `poll` in a loop with at least `minGapVisibleMs` / `minGapHiddenMs` between
 * the start of each attempt. On tab focus / visibility resume, polls immediately
 * and keeps chaining until the queue drains so missed at-bats land quickly.
 */
export function useChainedPoll(
  poll: () => Promise<void>,
  minGapVisibleMs: number,
  minGapHiddenMs: number,
  enabled: boolean,
  resetKey: unknown,
  onError?: (error: unknown) => void,
): void {
  const pollRef = useRef(poll);
  pollRef.current = poll;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timeoutId = 0;
    let running = false;
    let pendingCatchUp = false;

    const minGap = () =>
      document.visibilityState === "hidden" ? minGapHiddenMs : minGapVisibleMs;

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
      } catch (err) {
        onError?.(err);
      } finally {
        running = false;
      }

      if (cancelled) return;

      if (pendingCatchUp) {
        void run();
        return;
      }

      const elapsed = performance.now() - started;
      const delay = Math.max(0, minGap() - elapsed);
      timeoutId = window.setTimeout(() => void run(), delay);
    };

    const catchUp = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      window.clearTimeout(timeoutId);
      pendingCatchUp = true;
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
  }, [enabled, minGapVisibleMs, minGapHiddenMs, resetKey]);
}
