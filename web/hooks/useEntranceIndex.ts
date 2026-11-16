"use client";

import { useState } from "react";

/**
 * Returns the index from which list items should animate in (items at or above
 * this index are newly arrived). Resets when length drops (new at-bat / inning).
 */
export function useEntranceIndex(length: number, enabled: boolean): number {
  const [state, setState] = useState({ length, enabled, from: enabled ? length : 0 });

  // Adjust state during render when the inputs change (React's "derive from props" pattern).
  if (state.length !== length || state.enabled !== enabled) {
    let from: number;
    if (!enabled) from = length;
    else if (!state.enabled) from = length;
    else if (length === 0 || length < state.length) from = 0;
    else from = state.length;
    setState({ length, enabled, from });
    return enabled ? from : length;
  }

  return enabled ? state.from : length;
}
