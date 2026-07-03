"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import {
  blockScrollPersist,
  buildScrollKey,
  getSavedScrollY,
  isAsyncScrollRoute,
  restoreScrollPosition,
  saveScrollPosition,
  shouldPersistScroll,
} from "@/lib/scrollRestoration";

/** Remembers window scroll per route and restores on return (sync pages only). */
export function ScrollRestoration() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scrollKey = buildScrollKey(pathname, searchParams.toString());
  const scrollKeyRef = useRef(scrollKey);
  scrollKeyRef.current = scrollKey;

  useLayoutEffect(() => {
    if (isAsyncScrollRoute(pathname)) {
      blockScrollPersist(2000);
    }
  }, [pathname, scrollKey]);

  useEffect(() => {
    let throttleId: number | null = null;

    const persistScroll = () => {
      if (!shouldPersistScroll()) return;
      saveScrollPosition(scrollKeyRef.current, window.scrollY);
    };

    const onScroll = () => {
      if (!shouldPersistScroll()) return;
      if (throttleId != null) return;
      throttleId = window.setTimeout(() => {
        throttleId = null;
        if (!shouldPersistScroll()) return;
        persistScroll();
      }, 80);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (throttleId != null) window.clearTimeout(throttleId);
      if (shouldPersistScroll()) persistScroll();
    };
  }, []);

  useEffect(() => {
    if (isAsyncScrollRoute(pathname)) return;

    const savedY = getSavedScrollY(scrollKey);
    if (savedY === undefined) {
      window.scrollTo(0, 0);
      return;
    }

    return restoreScrollPosition(savedY);
  }, [pathname, scrollKey]);

  return null;
}
