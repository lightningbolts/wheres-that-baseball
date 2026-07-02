"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import {
  PITCH_NEUTRAL_COLOR,
  gamedaySceneLayout,
  pitchResultColor,
  zoneOverlayRect,
  zoneOverlayToSvgPercent,
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
          stroke="rgb(255 255 255 / 0.55)"
          strokeWidth="0.45"
        />
      ))}
      {[1, 2].map((i) => (
        <line
          key={`h${i}`}
          x1={zone.x}
          y1={zone.y + (zone.height * i) / 3}
          x2={zone.x + zone.width}
          y2={zone.y + (zone.height * i) / 3}
          stroke="rgb(255 255 255 / 0.55)"
          strokeWidth="0.45"
        />
      ))}
      <rect
        x={zone.x}
        y={zone.y}
        width={zone.width}
        height={zone.height}
        fill="none"
        stroke="rgb(255 255 255 / 0.7)"
        strokeWidth="0.65"
      />
    </>
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
  const target = zoneOverlayToSvgPercent(pitch.plateX, pitch.plateZ, szTop, szBottom);
  const [pos, setPos] = useState(target);

  useEffect(() => {
    if (!animateIn || revealCall) {
      setPos(target);
      return;
    }

    setPos({ x: 50, y: 4 });
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPos(target));
    });
    return () => cancelAnimationFrame(frame);
  }, [animateIn, revealCall, target.x, target.y, pitch.pitchNumber]);

  const color = revealCall ? pitchResultColor(pitch) : PITCH_NEUTRAL_COLOR;
  const transition = animateIn && !revealCall ? "cx 400ms ease-out, cy 400ms ease-out" : undefined;

  return (
    <g>
      <circle cx={pos.x} cy={pos.y} r={3.2} fill="rgb(0 0 0 / 0.45)" style={{ transition }} />
      <circle cx={pos.x} cy={pos.y} r={2.7} fill={color} style={{ transition }} />
      {showNumber ? (
        <text
          x={pos.x}
          y={pos.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="3.4"
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

function BatterBoxOutline({
  box,
  active,
}: {
  box: SvgRectPercent;
  active: boolean;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute border border-white",
        active ? "opacity-90" : "border-dashed opacity-35",
      )}
      style={{
        left: `${box.x}%`,
        top: `${box.y}%`,
        width: `${box.width}%`,
        height: `${box.height}%`,
      }}
    />
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
  const layout = gamedaySceneLayout(batSide);
  const zone = zoneOverlayRect(szTop, szBottom);

  const priorPitches = activePitch
    ? plotted.filter((p) => p.pitchNumber < activePitch.pitchNumber)
    : plotted;

  return (
    <div
      className={cn(
        "relative mx-auto aspect-[10/16] w-full max-w-[22rem] overflow-hidden rounded-md",
        "bg-gradient-to-b from-[#1a2f1c] via-[#3a2d22] to-[#5a3f2c]",
        className,
      )}
      aria-label="Gameday pitch view"
    >
      <BatterBoxOutline
        box={layout.rightBox}
        active={layout.activeSide === "rightHanded"}
      />
      <BatterBoxOutline box={layout.leftBox} active={layout.activeSide === "leftHanded"} />

      {/* Home plate */}
      <div
        className="pointer-events-none absolute bottom-[10%] left-1/2 h-0 w-[14%] -translate-x-1/2 border-x-[0.65rem] border-t-[0.9rem] border-x-transparent border-t-white/70"
        aria-hidden
      />

      {batterImageUrl ? (
        <img
          src={batterImageUrl}
          alt=""
          className="pointer-events-none absolute bottom-0 h-[92%] w-auto max-w-none -translate-x-1/2 object-contain object-bottom drop-shadow-[0_8px_24px_rgb(0_0_0/0.45)]"
          style={{ left: `${layout.batterAnchorPercent}%` }}
        />
      ) : null}

      {/* Strike zone + pitch dots — Gameday overlay on the plate */}
      <div
        className={cn(
          "pointer-events-none absolute left-1/2 w-[38%] -translate-x-1/2",
          showStrikeZone ? "bottom-[19%]" : "bottom-[21%]",
        )}
      >
        <svg viewBox="0 0 100 100" className="h-auto w-full overflow-visible">
          {showStrikeZone ? (
            <>
              <rect
                x={zone.x}
                y={zone.y}
                width={zone.width}
                height={zone.height}
                fill="rgb(0 0 0 / 0.25)"
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
        </svg>
      </div>
    </div>
  );
}
