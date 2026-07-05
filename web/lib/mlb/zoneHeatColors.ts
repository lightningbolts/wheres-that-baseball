/** Zone heat-map label colors blended against the moneyball zone fill. */
const ZONE_BLEND_BG = { r: 245, g: 240, b: 228 };

function parseRgba(color: string): { r: number; g: number; b: number; a: number } | null {
  const match = color.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i,
  );
  if (!match) return null;

  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] != null ? Number(match[4]) : 1,
  };
}

function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function zoneHeatLabelStyle(
  color: string,
  temp?: string,
): { fill: string; stroke: string; strokeWidth: number } {
  const rgba = parseRgba(color);
  if (!rgba) {
    return { fill: "#1c2b2a", stroke: "rgb(255 255 255 / 0.4)", strokeWidth: 0.1 };
  }

  const { r, g, b, a } = rgba;
  const blendedR = r * a + ZONE_BLEND_BG.r * (1 - a);
  const blendedG = g * a + ZONE_BLEND_BG.g * (1 - a);
  const blendedB = b * a + ZONE_BLEND_BG.b * (1 - a);
  const luminance = relativeLuminance(blendedR, blendedG, blendedB);
  const lightCell =
    temp === "lukewarm" ||
    temp === "cool" ||
    luminance > 0.62 ||
    (r > 180 && g > 180 && b > 180);

  if (lightCell) {
    return { fill: "#1c2b2a", stroke: "rgb(255 255 255 / 0.55)", strokeWidth: 0.14 };
  }

  return { fill: "#ffffff", stroke: "rgb(0 0 0 / 0.5)", strokeWidth: 0.14 };
}
