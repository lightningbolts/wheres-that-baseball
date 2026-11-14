/** Time of day a game is played at: drives the sky, the sun and whether the lights are on. */
export type TimeOfDay = "day" | "dusk" | "night";

/**
 * Each park has a fixed start time (half are day games, the rest twilight or night), which
 * `?tod=day|dusk|night` in the URL overrides.
 */
export function timeOfDay(venueId: number): TimeOfDay {
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search).get("tod");
    if (q === "day" || q === "dusk" || q === "night") return q;
  }
  const k = (Math.abs(venueId) * 7 + 3) % 10;
  return k < 5 ? "day" : k < 7 ? "dusk" : "night";
}
