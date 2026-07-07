import type { CSSProperties } from "react";

import type { NerdStatCategory } from "@/lib/mlb/nerdStats/types";

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

const CATEGORY_TINT: Record<NerdStatCategory, string> = {
  traditional: "rgba(28, 43, 42, 0.05)",
  drama: "rgba(251, 191, 36, 0.05)",
  misfortune: "rgba(248, 113, 113, 0.05)",
  baserunning: "rgba(52, 211, 153, 0.05)",
  contact: "rgba(96, 165, 250, 0.05)",
  pace: "rgba(167, 139, 250, 0.05)",
  defense: "rgba(45, 212, 191, 0.05)",
  chaos: "rgba(251, 146, 60, 0.05)",
  vibes: "rgba(244, 114, 182, 0.05)",
};

const TEXTURE_PATTERNS = [
  "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.055) 1px, transparent 0)",
  "linear-gradient(135deg, rgba(255,255,255,0.03) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.03) 75%, transparent 75%, transparent)",
  "repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 9px)",
  "repeating-linear-gradient(90deg, rgba(255,255,255,0.028) 0 1px, transparent 1px 11px)",
  "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.04) 0.6px, transparent 0.7px)",
  "linear-gradient(25deg, rgba(255,255,255,0.02), rgba(255,255,255,0.05))",
  "repeating-linear-gradient(45deg, rgba(255,255,255,0.02) 0 2px, transparent 2px 8px)",
  "conic-gradient(from 180deg at 50% 50%, rgba(255,255,255,0.03), transparent 25%, rgba(255,255,255,0.02) 50%, transparent 75%)",
] as const;

const TEXTURE_SIZES = [
  "12px 12px",
  "10px 10px",
  "100% 9px",
  "11px 100%",
  "14px 14px",
  "100% 100%",
  "8px 8px",
  "100% 100%",
] as const;

export function nerdStatCardSurfaceStyle(statId: string, category: NerdStatCategory): CSSProperties {
  const variant = hashString(statId) % TEXTURE_PATTERNS.length;
  const tint = CATEGORY_TINT[category] ?? "rgba(255,255,255,0.03)";

  return {
    backgroundImage: `${TEXTURE_PATTERNS[variant]}, linear-gradient(160deg, ${tint}, transparent 72%)`,
    backgroundSize: `${TEXTURE_SIZES[variant]}, auto`,
  };
}
