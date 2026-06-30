export function formatCount(value: number): string {
  return value.toLocaleString();
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function formatRatePer1000(value: number, digits = 1): string {
  return value.toFixed(digits);
}

export function formatMph(value: number): string {
  return `${value.toFixed(1)} mph`;
}

export function formatFeet(value: number): string {
  return `${Math.round(value)} ft`;
}

export function formatDegrees(value: number): string {
  return `${value.toFixed(1)}°`;
}

export function formatGamesBetween(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "∞";
  return value.toFixed(1);
}

export function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

export function ratePer1000(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return (numerator / denominator) * 1000;
}
