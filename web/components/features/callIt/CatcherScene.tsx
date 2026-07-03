"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { usePitchFxFrameSize } from "@/hooks/useGamedayFrameSize";
import {
  GAMEDAY_PITCH_FX,
} from "@/lib/mlb/gamedayAssets";
import { cn } from "@/lib/utils";
import {
  PITCH_NEUTRAL_COLOR,
  pitchFxSceneLayout,
  pitchResultColor,
  sceneZoneToSvgPercent,
  type SvgRectPercent,
} from "@/lib/mlb/strikeZoneMath";
import type { PlayPitch } from "@/types/mlb-live";

interface CatcherSceneProps {
  pitches: PlayPitch[];
  batSide: string | null;
  jerseyImageUrl: string | null;
  pantsImageUrl: string | null;
  stadiumImageUrl: string | null;
  infieldImageUrl: string | null;
  activePitch: PlayPitch | null;
  revealCall: boolean;
  animatePitchIn?: boolean;
  showStrikeZone?: boolean;
  className?: string;
  children?: ReactNode;
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
          strokeWidth="0.2"
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
          strokeWidth="0.2"
        />
      ))}
      <rect
        x={zone.x}
        y={zone.y}
        width={zone.width}
        height={zone.height}
        fill="none"
        stroke="rgb(255 255 255 / 0.75)"
        strokeWidth="0.28"
      />
    </>
  );
}

function PitchDot({
  pitch,
  szTop,
  szBottom,
  sceneZone,
  revealCall,
  animateIn,
  showNumber,
}: {
  pitch: PlayPitch;
  szTop: number;
  szBottom: number;
  sceneZone: SvgRectPercent;
  revealCall: boolean;
  animateIn: boolean;
  showNumber?: boolean;
}) {
  const target = sceneZoneToSvgPercent(pitch.plateX, pitch.plateZ, szTop, szBottom, sceneZone);
  const [pos, setPos] = useState(target);

  useEffect(() => {
    if (!animateIn || revealCall) {
      setPos(target);
      return;
    }

    setPos({ x: sceneZone.x + sceneZone.width / 2, y: sceneZone.y - 2 });
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPos(target));
    });
    return () => cancelAnimationFrame(frame);
  }, [
    animateIn,
    revealCall,
    target.x,
    target.y,
    pitch.pitchNumber,
    sceneZone.x,
    sceneZone.width,
    sceneZone.y,
  ]);

  const color = revealCall ? pitchResultColor(pitch) : PITCH_NEUTRAL_COLOR;
  const transition = animateIn && !revealCall ? "cx 400ms ease-out, cy 400ms ease-out" : undefined;

  return (
    <g>
      <circle cx={pos.x} cy={pos.y} r={1.1} fill="rgb(0 0 0 / 0.45)" style={{ transition }} />
      <circle cx={pos.x} cy={pos.y} r={0.9} fill={color} style={{ transition }} />
      {showNumber ? (
        <text
          x={pos.x}
          y={pos.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="1.2"
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
  jerseyImageUrl,
  pantsImageUrl,
  stadiumImageUrl,
  infieldImageUrl,
  activePitch,
  revealCall,
  animatePitchIn = false,
  showStrikeZone = true,
  className,
  children,
}: CatcherSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameSize = usePitchFxFrameSize(containerRef);
  const isLefty = batSide?.toUpperCase() === "L";
  const plotted = pitches.filter((p) => p.isPitch && p.hasPlateLocation !== false);
  const szTop = activePitch?.strikeZoneTop ?? plotted.at(-1)?.strikeZoneTop ?? 3.5;
  const szBottom = activePitch?.strikeZoneBottom ?? plotted.at(-1)?.strikeZoneBottom ?? 1.5;
  const layout = pitchFxSceneLayout(batSide, szTop, szBottom);

  const priorPitches = activePitch
    ? plotted.filter((p) => p.pitchNumber < activePitch.pitchNumber)
    : plotted;

  const playerStyle = {
    width: `${GAMEDAY_PITCH_FX.playerWidth}%`,
    paddingBottom: `${GAMEDAY_PITCH_FX.playerPaddingBottom}%`,
    top: `${GAMEDAY_PITCH_FX.playerTop}%`,
    ...(isLefty
      ? { right: `${GAMEDAY_PITCH_FX.playerSide}%` }
      : { left: `${GAMEDAY_PITCH_FX.playerSide}%` }),
    transformOrigin: isLefty ? "25% 100%" : "75% 100%",
    backgroundImage: [
      jerseyImageUrl ? `url("${jerseyImageUrl}")` : null,
      pantsImageUrl ? `url("${pantsImageUrl}")` : null,
    ]
      .filter(Boolean)
      .join(", "),
  } as const;

  return (
    <div
      ref={containerRef}
      className={cn("flex h-full w-full items-center justify-center", className)}
    >
      <div
        className={cn("relative overflow-hidden bg-neutral-900", isLefty && "lefty")}
        style={{
          width: frameSize.width > 0 ? frameSize.width : "100%",
          height: frameSize.height > 0 ? frameSize.height : undefined,
          aspectRatio: frameSize.width > 0 ? undefined : `${4} / ${3}`,
          maxWidth: "100%",
          maxHeight: "100%",
          backgroundImage: [
            infieldImageUrl ? `url("${infieldImageUrl}")` : null,
            stadiumImageUrl ? `url("${stadiumImageUrl}")` : null,
          ]
            .filter(Boolean)
            .join(", "),
          backgroundSize: "calc(100% + 1px), calc(100% + 1px)",
          backgroundPosition: `${GAMEDAY_PITCH_FX.infieldBgPosition}, ${GAMEDAY_PITCH_FX.stadiumBgPosition}`,
          backgroundRepeat: "no-repeat, no-repeat",
        }}
        aria-label="Gameday pitch view"
      >
        {children}

        <div
          className="absolute inset-0"
          style={{ marginTop: `${GAMEDAY_PITCH_FX.domMarginTop}%` }}
        >
          {jerseyImageUrl || pantsImageUrl ? (
            <div
              className="absolute z-20 box-border bg-no-repeat"
              style={{
                ...playerStyle,
                backgroundPosition: "center bottom, center bottom",
                backgroundSize: "100%, 100%",
              }}
              role="presentation"
            />
          ) : null}

          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="xMidYMid meet"
            className="pointer-events-none absolute inset-0 z-30 h-full w-full"
            aria-hidden
          >
            {showStrikeZone ? (
              <>
                <rect
                  x={layout.zone.x}
                  y={layout.zone.y}
                  width={layout.zone.width}
                  height={layout.zone.height}
                  fill="rgb(0 0 0 / 0.28)"
                />
                <ZoneGridLines zone={layout.zone} />
              </>
            ) : null}

            {priorPitches.map((pitch) => (
              <PitchDot
                key={`${pitch.pitchNumber}-${pitch.callCode}`}
                pitch={pitch}
                szTop={szTop}
                szBottom={szBottom}
                sceneZone={layout.zone}
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
                sceneZone={layout.zone}
                revealCall={revealCall}
                animateIn={animatePitchIn && !revealCall}
                showNumber={showStrikeZone && revealCall}
              />
            ) : null}
          </svg>
        </div>
      </div>
    </div>
  );
}
