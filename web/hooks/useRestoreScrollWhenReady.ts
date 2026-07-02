"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import {
  buildScrollKey,
  getSavedScrollY,
  restoreScrollPosition,
} from "@/lib/scrollRestoration";

/** Re-run scroll restoration after async content finishes loading. */
export function useRestoreScrollWhenReady(ready: boolean, enabled = true): void {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scrollKey = buildScrollKey(pathname, searchParams.toString());
  const restoredRef = useRef(false);

  useEffect(() => {
    restoredRef.current = false;
  }, [scrollKey]);

  useEffect(() => {
    if (!enabled || !ready || restoredRef.current) return;

    const savedY = getSavedScrollY(scrollKey);
    if (savedY === undefined) return;

    restoredRef.current = true;
    return restoreScrollPosition(savedY);
  }, [enabled, ready, scrollKey]);
}
