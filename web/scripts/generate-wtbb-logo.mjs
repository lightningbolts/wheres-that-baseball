#!/usr/bin/env node
/**
 * Generate WTBB mark: baseball + three spray arrows (0°, 22.5°, 45°).
 *
 * Baseball seams match the classic front-facing ⚾: top + bottom red
 * stitch curves (not left/right parentheses), with V-chevrons.
 *
 *   npm run brand:logo
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const brandDir = join(root, "public", "brand");

const wantPng = process.argv.includes("--png");
const sizeArg = process.argv.indexOf("--size");
const pngSize = sizeArg >= 0 ? Number(process.argv[sizeArg + 1]) : 512;

const INK = "#1c2b2a";
const FIELD = "#1b4332";
const CREAM = "#ede6d6";
const BALL = "#f4f1ea";
const STITCH = "#c41e3a"; // baseball red

const VIEW = 128;
/** Ball left; long spray arrows fill the right. */
const CX = 36;
const CY = 64;
const R = 28;

const ARROW_ANGLES = [0, 22.5, 45];

function degToDir(deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: Math.cos(rad), y: -Math.sin(rad) };
}

function arrowPath(deg) {
  const { x: dx, y: dy } = degToDir(deg);
  const inner = 4;
  const tip = R + 58; // long spray arrows
  const x0 = CX + dx * inner;
  const y0 = CY + dy * inner;
  const x1 = CX + dx * tip;
  const y1 = CY + dy * tip;

  const headLen = 11;
  const headHalf = 6;
  const bx = x1 - dx * headLen;
  const by = y1 - dy * headLen;
  const nx = -dy;
  const ny = dx;
  const left = { x: bx + nx * headHalf, y: by + ny * headHalf };
  const right = { x: bx - nx * headHalf, y: by - ny * headHalf };

  return {
    shaft: `M${x0.toFixed(1)} ${y0.toFixed(1)}L${(x1 - dx * (headLen - 0.5)).toFixed(1)} ${(y1 - dy * (headLen - 0.5)).toFixed(1)}`,
    head: `M${left.x.toFixed(1)} ${left.y.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}L${right.x.toFixed(1)} ${right.y.toFixed(1)}Z`,
  };
}

function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function cubicTan(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  };
}

/**
 * Classic baseball face: red seams across TOP and BOTTOM, arching toward
 * the center (∪ and ∩) — not parallel to the outer rim.
 * V-chevrons along each seam.
 */
function baseballSeams() {
  const seams = [
    {
      // upper seam — U-curve toward center
      p0: { x: CX - R * 0.85, y: CY - R * 0.5 },
      p1: { x: CX - R * 0.3, y: CY - R * 0.08 },
      p2: { x: CX + R * 0.3, y: CY - R * 0.08 },
      p3: { x: CX + R * 0.85, y: CY - R * 0.5 },
    },
    {
      // lower seam — ∩-curve toward center
      p0: { x: CX - R * 0.85, y: CY + R * 0.5 },
      p1: { x: CX - R * 0.3, y: CY + R * 0.08 },
      p2: { x: CX + R * 0.3, y: CY + R * 0.08 },
      p3: { x: CX + R * 0.85, y: CY + R * 0.5 },
    },
  ];

  const arm = 2.8;
  const parts = [];
  for (const s of seams) {
    const d = `M${s.p0.x.toFixed(1)} ${s.p0.y.toFixed(1)}C${s.p1.x.toFixed(1)} ${s.p1.y.toFixed(1)}, ${s.p2.x.toFixed(1)} ${s.p2.y.toFixed(1)}, ${s.p3.x.toFixed(1)} ${s.p3.y.toFixed(1)}`;
    parts.push(
      `<path fill="none" stroke="${STITCH}" stroke-width="1.2" stroke-linecap="round" opacity="0.45" d="${d}"/>`,
    );

    const count = 9;
    for (let i = 0; i < count; i += 1) {
      const t = 0.1 + (i / (count - 1)) * 0.8;
      const p = cubic(s.p0, s.p1, s.p2, s.p3, t);
      const T = cubicTan(s.p0, s.p1, s.p2, s.p3, t);
      const len = Math.hypot(T.x, T.y) || 1;
      const tx = T.x / len;
      const ty = T.y / len;
      const nx = -ty;
      const ny = tx;
      const apex = { x: p.x, y: p.y };
      const left = {
        x: p.x - nx * arm - tx * arm * 0.35,
        y: p.y - ny * arm - ty * arm * 0.35,
      };
      const right = {
        x: p.x + nx * arm - tx * arm * 0.35,
        y: p.y + ny * arm - ty * arm * 0.35,
      };
      parts.push(
        `<path fill="none" stroke="${STITCH}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M${left.x.toFixed(1)} ${left.y.toFixed(1)}L${apex.x.toFixed(1)} ${apex.y.toFixed(1)}L${right.x.toFixed(1)} ${right.y.toFixed(1)}"/>`,
      );
    }
  }
  return parts.join("\n  ");
}

function buildLogoSvg({ withPlate }) {
  const arrows = ARROW_ANGLES.map((deg) => arrowPath(deg));
  const arrowGroup = arrows
    .map(
      (a) =>
        `<path fill="none" stroke="${FIELD}" stroke-width="3" stroke-linecap="round" d="${a.shaft}"/>
    <path fill="${FIELD}" d="${a.head}"/>`,
    )
    .join("\n    ");

  const content = `
  <circle cx="${CX}" cy="${CY}" r="${R}" fill="${BALL}" stroke="${INK}" stroke-width="2.8"/>
  ${baseballSeams()}
  <g>
    ${arrowGroup}
  </g>
  <circle cx="${CX}" cy="${CY}" r="4.2" fill="${FIELD}"/>`;

  const plate = withPlate
    ? `<rect width="${VIEW}" height="${VIEW}" rx="28" fill="${CREAM}"/>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" role="img" aria-label="Where's That BB">
  <title>Where's That BB</title>
  <!-- Baseball (top/bottom seams) + spray arrows. scripts/generate-wtbb-logo.mjs -->
  ${plate}
  ${content}
</svg>
`;
}

mkdirSync(brandDir, { recursive: true });

const iconSvg = buildLogoSvg({ withPlate: true });
const markSvg = buildLogoSvg({ withPlate: false });

writeFileSync(join(brandDir, "wtbb-mark.svg"), iconSvg);
writeFileSync(join(brandDir, "wtbb-mark-transparent.svg"), markSvg);
writeFileSync(join(root, "app", "icon.svg"), iconSvg);
console.log("wrote public/brand/wtbb-mark.svg");
console.log("wrote public/brand/wtbb-mark-transparent.svg");
console.log("wrote app/icon.svg");

const reactPath = join(root, "components", "brand", "WtbbMark.tsx");
const markInner = markSvg
  .replace(/^[\s\S]*?<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "")
  .replace(/stroke="#1c2b2a"/g, 'stroke="currentColor"')
  .replace(/fill="#1c2b2a"/g, 'fill="currentColor"')
  .replace(/stroke-width=/g, "strokeWidth=")
  .replace(/stroke-linecap=/g, "strokeLinecap=")
  .replace(/stroke-linejoin=/g, "strokeLinejoin=")
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<title>[\s\S]*?<\/title>/g, "");

writeFileSync(
  reactPath,
  `/* Generated by scripts/generate-wtbb-logo.mjs — do not hand-edit */
import { cn } from "@/lib/utils";

type WtbbMarkProps = {
  className?: string;
  withPlate?: boolean;
  title?: string;
};

/** Baseball + three spray arrows (0°, 22.5°, 45°) from center. */
export function WtbbMark({
  className,
  withPlate = false,
  title = "Where's That BB",
}: WtbbMarkProps) {
  return (
    <svg
      viewBox="0 0 128 128"
      className={cn("block shrink-0", className)}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {withPlate ? <rect width="128" height="128" rx="28" fill="#ede6d6" /> : null}
      ${markInner.trim()}
    </svg>
  );
}

/** @deprecated Use WtbbMark */
export const WtbbMonogram = WtbbMark;
`,
);
console.log("wrote components/brand/WtbbMark.tsx");

if (wantPng) {
  const { Resvg } = await import("@resvg/resvg-js");
  for (const name of ["wtbb-mark.svg", "wtbb-mark-transparent.svg"]) {
    const svg = readFileSync(join(brandDir, name), "utf8");
    const png = new Resvg(svg, {
      fitTo: { mode: "width", value: pngSize },
      background: "transparent",
    })
      .render()
      .asPng();
    const out = name.replace(/\.svg$/, ".png");
    writeFileSync(join(brandDir, out), png);
    console.log(`wrote public/brand/${out} (${pngSize}px)`);
  }
}
