"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { GAMEDAY_PITCH_FX_ASPECT } from "@/lib/mlb/gamedayAssets";

export interface PitchFxFrameSize {
  width: number;
  height: number;
}

/** Fit the Gameday 4:3 pitch-fx field inside a container. */
export function usePitchFxFrameSize(
  containerRef: RefObject<HTMLElement | null>,
): PitchFxFrameSize {
  const [size, setSize] = useState<PitchFxFrameSize>({ width: 0, height: 0 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const update = (width: number, height: number) => {
      if (width <= 0 || height <= 0) {
        setSize({ width: 0, height: 0 });
        return;
      }

      let frameWidth = width;
      let frameHeight = frameWidth / GAMEDAY_PITCH_FX_ASPECT;
      if (frameHeight > height) {
        frameHeight = height;
        frameWidth = frameHeight * GAMEDAY_PITCH_FX_ASPECT;
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
