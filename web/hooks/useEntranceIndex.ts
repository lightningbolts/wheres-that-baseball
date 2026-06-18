"use client";

import { useEffect, useRef } from "react";

/**
 * Returns the index from which list items should animate in (items at or above
 * this index are newly arrived). Resets when length drops (new at-bat / inning).
 */
export function useEntranceIndex(length: number, enabled: boolean): number {
  const seenLengthRef = useRef(enabled ? length : 0);
  const prevLengthRef = useRef(length);

  if (!enabled) return length;

  if (length === 0) {
    seenLengthRef.current = 0;
  } else if (length < prevLengthRef.current) {
    seenLengthRef.current = 0;
  }

  const entranceFromIndex = seenLengthRef.current;
  prevLengthRef.current = length;

  useEffect(() => {
    if (!enabled) return;
    seenLengthRef.current = length;
  }, [enabled, length]);

  return entranceFromIndex;
}
