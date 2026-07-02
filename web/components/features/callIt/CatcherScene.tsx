"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import {
  PITCH_NEUTRAL_COLOR,
  ZONE_BAND_PCT,
  homePlatePath,
  pitchResultColor,
  plateBandBatterBoxes,
  toSvgPercent,
  zoneRectPercent,
  type SvgRectPercent,
} from "@/lib/mlb/strikeZoneMath";
import type { PlayPitch } from "@/types/mlb-live";

interface CatcherSceneProps {
  pitches: PlayPitch[];
  batSide: string | null;
  batterImageUrl: string | null;
  activePitch: PlayPitch | null;
  revealCall: boolean;
  animatePitchIn?: boolean;
  showStrikeZone?: boolean;
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

function BatterBoxChalk({
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
      fill="none"
      stroke="rgb(255 255 255 / 0.7)"
      strokeWidth={active ? "0.75" : "0.45"}
      strokeDasharray={active ? undefined : "1.4 1.4"}
      opacity={active ? 1 : 0.4}
    />
  );
}

function PitchDot({
  pitch,
  szTop,
  szBottom,
  revealCall,
  animateIn,
  showNumber,
}: {
  pitch: PlayPitch;
  szTop: number;
  szBottom: number;
  revealCall: boolean;
  animateIn: boolean;
  showNumber?: boolean;
}) {
  const target = toSvgPercent(pitch.plateX, pitch.plateZ, szTop, szBottom);
  const [pos, setPos] = useState(target);

  useEffect(() => {
    if (!animateIn || revealCall) {
      setPos(target);
      return;
    }

    setPos({ x: 50, y: 6 });
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPos(target));
    });
    return () => cancelAnimationFrame(frame);
  }, [animateIn, revealCall, target.x, target.y, pitch.pitchNumber]);

  const color = revealCall ? pitchResultColor(pitch) : PITCH_NEUTRAL_COLOR;
  const transition = animateIn && !revealCall ? "cx 400ms ease-out, cy 400ms ease-out" : undefined;
  const dotR = 2.4;

  return (
    <g>
      <circle cx={pos.x} cy={pos.y} r={dotR + 0.35} fill="rgb(0 0 0 / 0.3)" style={{ transition }} />
      <circle cx={pos.x} cy={pos.y} r={dotR} fill={color} style={{ transition }} />
      {showNumber ? (
        <text
          x={pos.x}
          y={pos.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="2.8"
          fill="#fff"
          fontWeight="bold"
          style={{ transition }}
        >
          {pitch.pitchNumber}
        </text>
      ) : null}
    </g>
  );
}

export function CatcherScene({
  pitches,
  batSide,
  batterImageUrl,
  activePitch,
  revealCall,
  animatePitchIn = false,
  showStrikeZone = true,
  className,
}: CatcherSceneProps) {
  const plotted = pitches.filter((p) => p.isPitch && p.hasPlateLocation !== false);
  const szTop = activePitch?.strikeZoneTop ?? plotted.at(-1)?.strikeZoneTop ?? 3.5;
  const szBottom = activePitch?.strikeZoneBottom ?? plotted.at(-1)?.strikeZoneBottom ?? 1.5;
  const zone = zoneRectPercent(szTop, szBottom);
  const plate = homePlatePath(zone, szTop, szBottom);
  const boxes = plateBandBatterBoxes(batSide);
  const activeSide = boxes.activeSide;

  const priorPitches = activePitch
    ? plotted.filter((p) => p.pitchNumber < activePitch.pitchNumber)
    : plotted;

  return (
    <div className={cn("relative h-full w-full", className)}>
      <svg
        viewBox="0 0 100 100"
        className="h-full w-full touch-none bg-zone-chart-bg"
        aria-label="Catcher view"
        preserveAspectRatio="xMidYMid meet"
      >
        <BatterBoxChalk box={boxes.rightHanded} active={activeSide === "rightHanded"} />
        <BatterBoxChalk box={boxes.leftHanded} active={activeSide === "leftHanded"} />

        <path
          d={plate}
          fill="var(--zone-chart-plate)"
          stroke="var(--zone-chart-grid)"
          strokeWidth="0.55"
        />

        {showStrikeZone ? (
          <>
            <rect
              x={zone.x}
              y={zone.y}
              width={zone.width}
              height={zone.height}
              fill="var(--zone-chart-zone-fill)"
            />
            <ZoneGridLines zone={zone} />
          </>
        ) : null}

        {priorPitches.map((pitch) => (
          <PitchDot
            key={`${pitch.pitchNumber}-${pitch.callCode}`}
            pitch={pitch}
            szTop={szTop}
            szBottom={szBottom}
            revealCall={false}
            animateIn={false}
            showNumber={showStrikeZone}
          />
        ))}

        {activePitch && activePitch.hasPlateLocation !== false ? (
          <PitchDot
            pitch={activePitch}
            szTop={szTop}
            szBottom={szBottom}
            revealCall={revealCall}
            animateIn={animatePitchIn && !revealCall}
            showNumber={showStrikeZone && revealCall}
          />
        ) : null}

        <line
          x1="0"
          y1={ZONE_BAND_PCT}
          x2="100"
          y2={ZONE_BAND_PCT}
          stroke="var(--zone-chart-grid)"
          strokeWidth="0.25"
          opacity="0.4"
        />
      </svg>

      {batterImageUrl ? (
        <img
          src={batterImageUrl}
          alt=""
          className={cn(
            "pointer-events-none absolute bottom-0 h-[46%] w-auto max-w-[40%] object-contain object-bottom",
            activeSide === "rightHanded" ? "left-[6%]" : "right-[6%]",
          )}
        />
      ) : null}
    </div>
  );
}
