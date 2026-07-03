"use client";

import { useEffect, useState, type RefObject } from "react";

import {
  GAMEDAY_STADIUM_HEIGHT,
  GAMEDAY_STADIUM_WIDTH,
} from "@/lib/mlb/gamedayAssets";

const GAMEDAY_ASPECT = GAMEDAY_STADIUM_WIDTH / GAMEDAY_STADIUM_HEIGHT;

export interface GamedayFrameSize {
  width: number;
  height: number;
}

/** Fit the native Gameday JPEG aspect ratio inside a measured container. */
export function useGamedayFrameSize(
  containerRef: RefObject<HTMLElement | null>,
): GamedayFrameSize {
  const [size, setSize] = useState<GamedayFrameSize>({ width: 0, height: 0 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const update = (width: number, height: number) => {
      if (width <= 0 || height <= 0) {
        setSize({ width: 0, height: 0 });
        return;
      }

      let frameWidth = width;
      let frameHeight = frameWidth / GAMEDAY_ASPECT;
      if (frameHeight > height) {
        frameHeight = height;
        frameWidth = frameHeight * GAMEDAY_ASPECT;
      }

      setSize({
        width: Math.max(0, Math.floor(frameWidth)),
        height: Math.max(0, Math.floor(frameHeight)),
      });
    };

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      update(width, height);
    });

    observer.observe(element);
    update(element.clientWidth, element.clientHeight);

    return () => observer.disconnect();
  }, [containerRef]);

  return size;
}
