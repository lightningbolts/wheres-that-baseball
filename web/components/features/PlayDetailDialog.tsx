"use client";

import { Dialog } from "@/components/ui/Dialog";
import { PitchSequence } from "@/components/features/PitchSequence";
import { SprayChart } from "@/components/features/SprayChart";
import type { HitData, PlayDetail } from "@/types/mlb-live";

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

function ContactMetrics({ hit, venueId }: { hit: HitData; venueId?: number | null }) {
  return (
    <div className="border-t border-border pt-3">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted">
        Ball in play
      </p>
      <div className="flex gap-4">
        <SprayChart hit={hit} venueId={venueId} className="shrink-0" />
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
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                {hit.pitchType && (
                  <Stat
                    label="Pitch"
                    value={
                      hit.pitchTypeCode
                        ? `${hit.pitchTypeCode} · ${hit.pitchType}`
                        : hit.pitchType
                    }
                  />
                )}
                {hit.pitchSpeed != null && (
                  <Stat label="Velo" value={`${fmtNum(hit.pitchSpeed)} mph`} />
                )}
                {hit.endSpeed != null && (
                  <Stat label="Velo (plate)" value={`${fmtNum(hit.endSpeed)} mph`} />
                )}
                {hit.spinRate != null && (
                  <Stat label="Spin" value={`${Math.round(hit.spinRate)} rpm`} />
                )}
                {hit.breakHorizontal != null && (
                  <Stat label="H-break" value={`${fmtNum(hit.breakHorizontal, 1)} in`} />
                )}
                {hit.breakVerticalInduced != null && (
                  <Stat label="V-break" value={`${fmtNum(hit.breakVerticalInduced, 1)} in`} />
                )}
                {hit.extension != null && (
                  <Stat label="Extension" value={`${fmtNum(hit.extension, 1)} ft`} />
                )}
                {hit.plateTime != null && (
                  <Stat label="Plate time" value={`${fmtNum(hit.plateTime, 3)} s`} />
                )}
                {hit.zone != null && (
                  <Stat label="Strike zone" value={`Zone ${hit.zone}`} />
                )}
              </dl>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function PlayDetailDialog({ play, venueId, onClose }: PlayDetailDialogProps) {
  const hit = play?.hit;

  return (
    <Dialog
      open={play !== null}
      onClose={onClose}
      title={
        play
          ? `${play.batterName} — ${play.event} (${play.batterHits}-${play.batterAtBats})`
          : "Play detail"
      }
      className="w-[min(100%,680px)]"
    >
      {play && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-2 text-[11px] text-subtle">
            <span>
              {play.inning} {play.halfInning}
            </span>
            <span className="font-mono tabular-nums">
              {play.awayScore}–{play.homeScore}
            </span>
          </div>

          <p className="text-[14px] leading-relaxed text-secondary">{play.description}</p>

          {play.pitches.length > 0 && <PitchSequence pitches={play.pitches} />}

          {hit && <ContactMetrics hit={hit} venueId={venueId} />}

          {!hit && play.pitches.length === 0 && (
            <p className="text-sm text-subtle">No pitch data.</p>
          )}
        </div>
      )}
    </Dialog>
  );
}
