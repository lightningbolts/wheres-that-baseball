"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import {
  buildScrollKey,
  getSavedScrollY,
  restoreScrollPosition,
  saveScrollPosition,
} from "@/lib/scrollRestoration";

/** Remembers window scroll per route and restores on return (incl. async pages). */
export function ScrollRestoration() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scrollKey = buildScrollKey(pathname, searchParams.toString());
  const scrollKeyRef = useRef(scrollKey);
  scrollKeyRef.current = scrollKey;

  useEffect(() => {
    let throttleId: number | null = null;

    const persistScroll = () => {
      saveScrollPosition(scrollKeyRef.current, window.scrollY);
    };

    const onScroll = () => {
      if (throttleId != null) return;
      throttleId = window.setTimeout(() => {
        throttleId = null;
        persistScroll();
      }, 80);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (throttleId != null) window.clearTimeout(throttleId);
      persistScroll();
    };
  }, []);

  useEffect(() => {
    const savedY = getSavedScrollY(scrollKey);

    if (savedY === undefined) {
      window.scrollTo(0, 0);
      return;
    }

    return restoreScrollPosition(savedY);
  }, [scrollKey]);

  return null;
}
