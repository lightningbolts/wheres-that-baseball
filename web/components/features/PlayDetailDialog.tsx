"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { Dialog } from "@/components/ui/Dialog";
import { PitchSequence } from "@/components/features/PitchSequence";
import { PlayVideoPlayer } from "@/components/features/PlayVideoPlayer";
import { SprayChart } from "@/components/features/SprayChart";
import { formatPlayWinProbabilityLine } from "@/lib/mlb/wpa";
import type { HitData, PlayDetail, PlayPitch } from "@/types/mlb-live";

const BallTrajectory3D = dynamic(
  () => import("@/components/features/BallTrajectory3D").then((m) => m.BallTrajectory3D),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[280px] items-center justify-center rounded border border-border bg-field-chart-canvas text-xs text-subtle">
        Loading trajectory…
      </div>
    ),
  },
);

/** Defer WebGL until the trajectory is near the viewport — avoids page flicker on dialog open. */
function LazyBallTrajectory3D({
  hit,
  venueId,
  className,
}: {
  hit: HitData;
  venueId?: number | null;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    setShouldRender(false);
    const node = rootRef.current;
    if (!node) return;

    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const startRender = () => {
      setShouldRender(true);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        // Let the dialog + video paint before spinning up a second WebGL context.
        if (typeof requestIdleCallback !== "undefined") {
          idleId = requestIdleCallback(startRender, { timeout: 400 });
        } else {
          timeoutId = setTimeout(startRender, 150);
        }
      },
      { rootMargin: "80px", threshold: 0.01 },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      if (idleId != null && typeof cancelIdleCallback !== "undefined") {
        cancelIdleCallback(idleId);
      }
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [hit]);

  return (
    <div ref={rootRef} className={className}>
      {shouldRender ? (
        <BallTrajectory3D hit={hit} venueId={venueId} />
      ) : (
        <div className="flex h-[220px] items-center justify-center rounded border border-border bg-field-chart-canvas text-xs text-subtle sm:h-[280px]">
          Scroll to load trajectory…
        </div>
      )}
    </div>
  );
}

interface PlayDetailDialogProps {
  play: PlayDetail | null;
  venueId?: number | null;
  onClose: () => void;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] text-subtle">{label}</dt>
      <dd className="font-mono text-[13px] tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function fmtNum(value: number | undefined, digits = 1, suffix = ""): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}${suffix}`;
}

function trajectoryLabel(trajectory: string): string {
  return trajectory.replace(/_/g, " ") || "—";
}

function fieldZoneLabel(zone: string): string {
  const zones: Record<string, string> = {
    "1": "P",
    "2": "C",
    "3": "1B",
    "4": "2B",
    "5": "3B",
    "6": "SS",
    "7": "LF",
    "8": "CF",
    "9": "RF",
  };
  return zones[zone] ?? (zone || "—");
}

function getFinalPitch(pitches: PlayPitch[]): PlayPitch | null {
  for (let i = pitches.length - 1; i >= 0; i -= 1) {
    if (pitches[i].isPitch) return pitches[i];
  }
  return null;
}

function endingSectionTitle(event: string): string {
  switch (event) {
    case "Strikeout":
      return "Strikeout";
    case "Walk":
      return "Walk";
    case "Hit By Pitch":
      return "Hit by pitch";
    case "Intent Walk":
      return "Intentional walk";
    default:
      return "At-bat result";
  }
}


function PitchMetricsGrid({ pitch }: { pitch: PlayPitch | HitData }) {
  const pitchType = "typeDescription" in pitch ? pitch.typeDescription : pitch.pitchType;
  const pitchTypeCode = "typeCode" in pitch ? pitch.typeCode : pitch.pitchTypeCode;
  const pitchSpeed = "startSpeed" in pitch ? pitch.startSpeed : pitch.pitchSpeed;

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
      {"callDescription" in pitch && (
        <Stat label="Result" value={pitch.callDescription} />
      )}
      {pitchType && (
        <Stat
          label="Pitch"
          value={
            pitchTypeCode && pitchTypeCode !== "—"
              ? `${pitchTypeCode} · ${pitchType}`
              : pitchType
          }
        />
      )}
      {pitchSpeed != null && pitchSpeed > 0 && (
        <Stat label="Velo" value={`${fmtNum(pitchSpeed)} mph`} />
      )}
      {"endSpeed" in pitch && pitch.endSpeed != null && (
        <Stat label="Velo (plate)" value={`${fmtNum(pitch.endSpeed)} mph`} />
      )}
      {pitch.spinRate != null && (
        <Stat label="Spin" value={`${Math.round(pitch.spinRate)} rpm`} />
      )}
      {pitch.breakHorizontal != null && (
        <Stat label="H-break" value={`${fmtNum(pitch.breakHorizontal, 1)} in`} />
      )}
      {pitch.breakVerticalInduced != null && (
        <Stat label="V-break" value={`${fmtNum(pitch.breakVerticalInduced, 1)} in`} />
      )}
      {pitch.extension != null && (
        <Stat label="Extension" value={`${fmtNum(pitch.extension, 1)} ft`} />
      )}
      {pitch.plateTime != null && (
        <Stat label="Plate time" value={`${fmtNum(pitch.plateTime, 3)} s`} />
      )}
      {pitch.zone != null && <Stat label="Strike zone" value={`Zone ${pitch.zone}`} />}
      {"balls" in pitch && (
        <Stat label="Count" value={`${pitch.balls}-${pitch.strikes}`} />
      )}
    </dl>
  );
}

function ContactMetrics({ hit, venueId }: { hit: HitData; venueId?: number | null }) {
  return (
    <div className="border-t border-border pt-4">
      <p className="mb-3 text-[10px] font-medium uppercase tracking-wide text-muted">
        Ball in play
      </p>
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <SprayChart hit={hit} venueId={venueId} size="large" className="mx-auto w-full shrink-0" />
        <div className="min-w-0 flex-1 space-y-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Stat label="Exit velo" value={`${fmtNum(hit.launchSpeed)} mph`} />
            <Stat label="Launch angle" value={`${fmtNum(hit.launchAngle, 0)}°`} />
            <Stat label="Distance" value={`${Math.round(hit.totalDistance)} ft`} />
            <Stat label="Hardness" value={hit.hardness || "—"} />
            <Stat label="Trajectory" value={trajectoryLabel(hit.trajectory)} />
            <Stat label="Field zone" value={fieldZoneLabel(hit.location)} />
          </dl>

          {(hit.pitchSpeed || hit.spinRate) && (
            <>
              <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                Pitch at contact
              </p>
              <PitchMetricsGrid pitch={hit} />
            </>
          )}
        </div>
      </div>
      <LazyBallTrajectory3D hit={hit} venueId={venueId} className="mt-4" />
    </div>
  );
}

function AtBatResultSection({
  play,
  finalPitch,
}: {
  play: PlayDetail;
  finalPitch: PlayPitch;
}) {
  return (
    <div className="border-t border-border pt-4">
      <p className="mb-3 text-[10px] font-medium uppercase tracking-wide text-muted">
        {endingSectionTitle(play.event)}
      </p>
      <div className="space-y-3">
        <p className="text-sm text-secondary">
          Pitch {finalPitch.pitchNumber}: {finalPitch.callDescription}
          {finalPitch.startSpeed > 0 && (
            <span className="text-muted">
              {" "}
              · {finalPitch.startSpeed.toFixed(1)} mph {finalPitch.typeDescription}
            </span>
          )}
        </p>
        <PitchMetricsGrid pitch={finalPitch} />
      </div>
    </div>
  );
}

export function PlayDetailDialog({ play, venueId, onClose }: PlayDetailDialogProps) {
  const hit = play?.hit ?? null;
  const finalPitch = play ? getFinalPitch(play.pitches) : null;
  const winProbabilityLine = play ? formatPlayWinProbabilityLine(play) : null;
  const title = play
    ? `${play.batterName} — ${play.event} (${play.batterHits}-${play.batterAtBats})`
    : "Play details";

  return (
    <Dialog
      open={Boolean(play)}
      onClose={onClose}
      title={title}
      className="w-[min(100%,760px)]"
    >
      {play ? (
        <div className="space-y-3 md:space-y-4">
          <div className="flex items-baseline justify-between gap-2 text-[11px] text-subtle">
            <span>
              {play.inning} {play.halfInning}
              {winProbabilityLine && (
                <>
                  {" "}
                  · {winProbabilityLine}
                </>
              )}
            </span>
            <span className="font-mono tabular-nums">
              {play.awayScore}–{play.homeScore}
            </span>
          </div>

          <p className="text-[13px] leading-relaxed text-secondary md:text-[14px]">
            {play.description}
          </p>

          {(play.playId || play.pitches.some((p) => p.playId)) && (
            <PlayVideoPlayer
              playId={play.playId ?? [...play.pitches].reverse().find((p) => p.playId)?.playId}
              autoLoad
              size="compact"
              showTitle
            />
          )}

          {play.pitches.length > 0 && (
            <>
              <div className="md:hidden">
                <PitchSequence
                  pitches={play.pitches}
                  layout="zone"
                  size="compact"
                  zoneFirst
                  contained={false}
                />
              </div>
              <div className="hidden md:block">
                <PitchSequence
                  pitches={play.pitches}
                  layout="split"
                  size="default"
                  contained={false}
                />
              </div>
            </>
          )}

          {hit && <ContactMetrics hit={hit} venueId={venueId} />}

          {!hit && finalPitch && (
            <AtBatResultSection play={play} finalPitch={finalPitch} />
          )}

          {!hit && !finalPitch && play.pitches.length === 0 && (
            <p className="text-sm text-subtle">No pitch data.</p>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}
