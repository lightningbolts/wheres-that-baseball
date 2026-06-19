import type { HitType } from "@/lib/mlb/gameHits";

/** CSS variable names for spray-chart hit colors (higher contrast than list badges). */
export const SPRAY_HIT_COLOR_VAR: Record<HitType, string> = {
  Single: "var(--spray-hit-single)",
  Double: "var(--spray-hit-double)",
  Triple: "var(--spray-hit-triple)",
  "Home Run": "var(--spray-hit-hr)",
};

export const SPRAY_HIT_SHADOW = "var(--spray-hit-shadow)";
export const SPRAY_HIT_BALL_OUTLINE = "var(--spray-hit-ball-outline)";
export const SPRAY_CONTACT_COLOR = "var(--spray-hit-contact)";
