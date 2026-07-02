"use client";

import Image from "next/image";

import { mlbPlayerHeadshotUrl } from "@/lib/mlb/cardPitchers";
import type { SvgRectPercent } from "@/lib/mlb/strikeZoneMath";
import { cn } from "@/lib/utils";

interface BatterFigureProps {
  batterId: number | null;
  batterName: string;
  box: SvgRectPercent;
  batSide: string | null;
  className?: string;
}

/** Simple stance silhouette in the active batter's box. */
function BatterSilhouette({ batSide }: { batSide: string | null }) {
  const isLeft = batSide?.toUpperCase() === "L";
  return (
    <g aria-hidden>
      <ellipse cx="50" cy="18" rx="11" ry="12" fill="var(--zone-chart-grid)" opacity="0.35" />
      <path
        d={
          isLeft
            ? "M42 28 L42 72 L48 72 L50 48 L54 72 L60 72 L58 28 Z"
            : "M42 28 L42 72 L48 72 L50 48 L52 72 L58 72 L58 28 Z"
        }
        fill="var(--zone-chart-grid)"
        opacity="0.5"
      />
      <line
        x1={isLeft ? 58 : 42}
        y1="36"
        x2={isLeft ? 78 : 22}
        y2="24"
        stroke="var(--zone-chart-grid)"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.65"
      />
    </g>
  );
}

export function BatterFigure({
  batterId,
  batterName,
  box,
  batSide,
  className,
}: BatterFigureProps) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.42;
  const figW = box.width * 0.85;
  const figH = box.height * 0.9;

  return (
    <foreignObject
      x={cx - figW / 2}
      y={cy - figH / 2}
      width={figW}
      height={figH}
      className={cn("pointer-events-none overflow-visible", className)}
    >
      <div className="relative flex h-full w-full flex-col items-center justify-end">
        {batterId ? (
          <div className="relative z-10 mb-[8%] h-[38%] w-[38%] overflow-hidden rounded-full border border-border bg-overlay">
            <Image
              src={mlbPlayerHeadshotUrl(batterId, 112)}
              alt={batterName}
              width={56}
              height={56}
              className="h-full w-full object-cover object-top"
              unoptimized
            />
          </div>
        ) : null}
        <svg viewBox="0 0 100 100" className="h-[58%] w-[70%]" aria-hidden>
          <BatterSilhouette batSide={batSide} />
        </svg>
      </div>
    </foreignObject>
  );
}
