"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

function buildScrollKey(pathname: string, searchParams: URLSearchParams): string {
  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function restoreScrollY(targetY: number): void {
  const attempt = (tries = 0) => {
    window.scrollTo(0, targetY);
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    if (tries < 12 && maxScroll < targetY - 8) {
      window.requestAnimationFrame(() => attempt(tries + 1));
    }
  };

  window.requestAnimationFrame(() => attempt());
}

/** Remembers window scroll per route when navigating away and restores on return. */
export function ScrollRestoration() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scrollPositions = useRef(new Map<string, number>());
  const scrollKey = buildScrollKey(pathname, searchParams);

  useEffect(() => {
    const savedY = scrollPositions.current.get(scrollKey);
    if (savedY === undefined) {
      window.scrollTo(0, 0);
      return;
    }

    restoreScrollY(savedY);
    const retry = window.setTimeout(() => restoreScrollY(savedY), 150);
    return () => window.clearTimeout(retry);
  }, [scrollKey]);

  useEffect(() => {
    return () => {
      scrollPositions.current.set(scrollKey, window.scrollY);
    };
  }, [scrollKey]);

  return null;
}
