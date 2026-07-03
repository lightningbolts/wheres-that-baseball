"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import {
  blockScrollPersist,
  buildScrollKey,
  getReturnScrollY,
  getSavedScrollY,
  restoreScrollPosition,
} from "@/lib/scrollRestoration";

/** Re-run scroll restoration after async content finishes loading. */
export function useRestoreScrollWhenReady(ready: boolean, enabled = true): void {
  const pathname = usePathname();
  const scrollKeyRef = useRef("");
  const restoredRef = useRef(false);

  useLayoutEffect(() => {
    const query = window.location.search.replace(/^\?/, "");
    scrollKeyRef.current = buildScrollKey(pathname, query);
    restoredRef.current = false;
    blockScrollPersist(2000);
  }, [pathname]);

  useEffect(() => {
    if (!enabled || !ready || restoredRef.current) return;

    const query = window.location.search.replace(/^\?/, "");
    const savedY =
      getReturnScrollY(pathname, query) ?? getSavedScrollY(scrollKeyRef.current);
    if (savedY === undefined) return;

    restoredRef.current = true;
    window.scrollTo(0, 0);
    return restoreScrollPosition(savedY);
  }, [enabled, ready, pathname]);
}
