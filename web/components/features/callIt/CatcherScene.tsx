"use client";

import { useEffect, useState } from "react";

import { BatterFigure } from "@/components/features/callIt/BatterFigure";
import { cn } from "@/lib/utils";
import {
  PITCH_NEUTRAL_COLOR,
  batterBoxRectsPercent,
  gameHomePlatePath,
  gameToSvgPercent,
  gameZoneRectPercent,
  moundArcPath,
  pitchResultColor,
  type SvgRectPercent,
} from "@/lib/mlb/strikeZoneMath";
import type { PlayPitch } from "@/types/mlb-live";

interface CatcherSceneProps {
  pitches: PlayPitch[];
  batSide: string | null;
  batterId: number | null;
  batterName: string;
  /** Pitch shown in guess phase (location visible, call hidden). */
  activePitch: PlayPitch | null;
  /** When true, show actual call color on active pitch. */
  revealCall: boolean;
  /** Animate pitch dot traveling to the plate (umpire mode). */
  animatePitchIn?: boolean;
  className?: string;
}

function ZoneGridLines({ zone }: { zone: SvgRectPercent }) {
  return (
    <>
      {[1, 2].map((i) => (
        <line
          key={`v${i}`}
          x1={zone.x + (zone.width * i) / 3}
          y1={zone.y}
          x2={zone.x + (zone.width * i) / 3}
          y2={zone.y + zone.height}
          stroke="var(--zone-chart-grid)"
          strokeWidth="0.35"
          opacity="0.8"
        />
      ))}
      {[1, 2].map((i) => (
        <line
          key={`h${i}`}
          x1={zone.x}
          y1={zone.y + (zone.height * i) / 3}
          x2={zone.x + zone.width}
          y2={zone.y + (zone.height * i) / 3}
          stroke="var(--zone-chart-grid)"
          strokeWidth="0.35"
          opacity="0.8"
        />
      ))}
      <rect
        x={zone.x}
        y={zone.y}
        width={zone.width}
        height={zone.height}
        fill="none"
        stroke="var(--zone-chart-grid)"
        strokeWidth="1"
      />
    </>
  );
}

function BatterBox({
  box,
  active,
}: {
  box: SvgRectPercent;
  active: boolean;
}) {
  return (
    <rect
      x={box.x}
      y={box.y}
      width={box.width}
      height={box.height}
      fill={active ? "var(--zone-chart-zone-fill)" : "transparent"}
      stroke="var(--zone-chart-grid)"
      strokeWidth={active ? "0.9" : "0.5"}
      strokeDasharray={active ? undefined : "1.2 1.2"}
      opacity={active ? 0.55 : 0.35}
    />
  );
}

function PitchDot({
  pitch,
  szTop,
  szBottom,
  revealCall,
  animateIn,
}: {
  pitch: PlayPitch;
  szTop: number;
  szBottom: number;
  revealCall: boolean;
  animateIn: boolean;
}) {
  const target = gameToSvgPercent(pitch.plateX, pitch.plateZ, szTop, szBottom);
  const [pos, setPos] = useState(target);

  useEffect(() => {
    if (!animateIn || revealCall) {
      setPos(target);
      return;
    }

    setPos({ x: 50, y: 8 });
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPos(target));
    });
    return () => cancelAnimationFrame(frame);
  }, [animateIn, revealCall, target.x, target.y, pitch.pitchNumber]);

  const color = revealCall ? pitchResultColor(pitch) : PITCH_NEUTRAL_COLOR;
  const transition = animateIn && !revealCall ? "cx 400ms ease-out, cy 400ms ease-out" : undefined;

  return (
    <g>
      <circle cx={pos.x} cy={pos.y} r={2.8} fill="rgb(0 0 0 / 0.25)" style={{ transition }} />
      <circle cx={pos.x} cy={pos.y} r={2.4} fill={color} style={{ transition }} />
    </g>
  );
}

export function CatcherScene({
  pitches,
  batSide,
  batterId,
  batterName,
  activePitch,
  revealCall,
  animatePitchIn = false,
  className,
}: CatcherSceneProps) {
  const plotted = pitches.filter((p) => p.isPitch && p.hasPlateLocation !== false);
  const szTop = activePitch?.strikeZoneTop ?? plotted.at(-1)?.strikeZoneTop ?? 3.5;
  const szBottom = activePitch?.strikeZoneBottom ?? plotted.at(-1)?.strikeZoneBottom ?? 1.5;
  const zone = gameZoneRectPercent(szTop, szBottom);
  const plate = gameHomePlatePath(zone, szTop, szBottom);
  const boxes = batterBoxRectsPercent(batSide, szTop, szBottom);
  const activeBox = boxes[boxes.activeSide];

  const priorPitches = activePitch
    ? plotted.filter((p) => p.pitchNumber < activePitch.pitchNumber)
    : plotted;

  return (
    <svg
      viewBox="0 0 100 100"
      className={cn(
        "h-[clamp(17rem,45vh,28rem)] w-full border border-border bg-zone-chart-bg md:h-full md:min-h-[280px]",
        className,
      )}
      aria-label="Catcher view strike zone"
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        d={moundArcPath(szTop, szBottom)}
        fill="none"
        stroke="var(--zone-chart-grid)"
        strokeWidth="0.4"
        opacity="0.35"
      />
      <BatterBox box={boxes.rightHanded} active={boxes.activeSide === "rightHanded"} />
      <BatterBox box={boxes.leftHanded} active={boxes.activeSide === "leftHanded"} />
      <path
        d={plate}
        fill="var(--zone-chart-plate)"
        stroke="var(--zone-chart-grid)"
        strokeWidth="0.55"
      />
      <rect
        x={zone.x}
        y={zone.y}
        width={zone.width}
        height={zone.height}
        fill="var(--zone-chart-zone-fill)"
        opacity="0.85"
      />
      <ZoneGridLines zone={zone} />
      <BatterFigure
        batterId={batterId}
        batterName={batterName}
        box={activeBox}
        batSide={batSide}
      />
      {priorPitches.map((pitch) => {
        const dot = gameToSvgPercent(pitch.plateX, pitch.plateZ, szTop, szBottom);
        const color = pitchResultColor(pitch);
        return (
          <g key={`${pitch.pitchNumber}-${pitch.callCode}`}>
            <circle cx={dot.x} cy={dot.y} r={2.1} fill={color} opacity="0.85" />
          </g>
        );
      })}
      {activePitch && activePitch.hasPlateLocation !== false ? (
        <PitchDot
          pitch={activePitch}
          szTop={szTop}
          szBottom={szBottom}
          revealCall={revealCall}
          animateIn={animatePitchIn && !revealCall}
        />
      ) : null}
    </svg>
  );
}
