"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildHitPath,
  buildPitchPath,
  buildActorTargets,
  easeInOut,
  FIELDER_REACT_S,
  getMapper,
  lerpVec,
  pursuitTargets,
  RUNNER_MOVE_S,
  samplePath,
  trailUpTo,
  type LiveActorState,
  type LiveBallState,
  type LiveFieldTargets,
} from "@/lib/mlb/liveFieldAnimation";
import type { PlayPitch } from "@/types/mlb-live";
import type { Vec3 } from "@/lib/mlb/ballTrajectory";

interface PitchAnim {
  kind: "pitch" | "hit";
  pitchNumber: number;
  points: Vec3[];
  durationMs: number;
  startedAt: number;
  hitPursuit?: Map<string, Vec3>;
}

interface ActorTween {
  from: Vec3;
  to: Vec3;
  startedAt: number;
  durationMs: number;
}

function pitchIdentity(pitch: PlayPitch): string {
  return `${pitch.pitchNumber}:${pitch.callCode}`;
}

function pitchKey(pitch: PlayPitch): string {
  return `${pitchIdentity(pitch)}:${pitch.isInPlay ? 1 : 0}:${pitch.hit?.coordX ?? ""}:${pitch.hit?.coordY ?? ""}`;
}

function clamp(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/**
 * Drive Gameday-style ball + actor motion from live at-bat pitches.
 * Animations are client-side reconstructions from feed events (no Statcast stream).
 */
export function useLiveFieldMotion(
  venueId: number | null | undefined,
  pitches: PlayPitch[],
  targets: LiveFieldTargets,
) {
  const mapper = useMemo(() => getMapper(venueId), [venueId]);
  const seenPitchesRef = useRef<Set<string>>(new Set());
  const pitchedIdsRef = useRef<Set<string>>(new Set());
  const hitIdsRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<PitchAnim[]>([]);
  const activeRef = useRef<PitchAnim | null>(null);
  const actorTweensRef = useRef<Map<string, ActorTween>>(new Map());
  const actorPosRef = useRef<Map<string, Vec3>>(new Map());
  const defenseRef = useRef(targets.defense);
  defenseRef.current = targets.defense;

  const [ball, setBall] = useState<LiveBallState>({
    phase: "idle",
    position: [0, 0.2, 0],
    trail: [],
    pitchNumber: null,
  });
  const [actors, setActors] = useState<LiveActorState[]>([]);

  const targetsKey = [
    targets.showBatter ? 1 : 0,
    targets.batterName ?? "",
    targets.runnerFirst?.id ?? "",
    targets.runnerSecond?.id ?? "",
    targets.runnerThird?.id ?? "",
    targets.defense.map((d) => `${d.position}:${d.playerId}`).join(","),
  ].join("|");

  // Sync actor targets — tween when slots change.
  useEffect(() => {
    const next = buildActorTargets(mapper, targets);
    const now = performance.now();
    const tweens = actorTweensRef.current;
    const positions = actorPosRef.current;
    const nextIds = new Set(next.map((a) => a.id));

    for (const actor of next) {
      const prev = positions.get(actor.id);
      if (!prev) {
        positions.set(actor.id, actor.position);
        continue;
      }
      const dist = Math.hypot(
        prev[0] - actor.position[0],
        prev[1] - actor.position[1],
        prev[2] - actor.position[2],
      );
      if (dist > 0.02) {
        tweens.set(actor.id, {
          from: prev,
          to: actor.position,
          startedAt: now,
          durationMs: RUNNER_MOVE_S * 1000,
        });
      } else {
        positions.set(actor.id, actor.position);
      }
    }

    for (const id of [...positions.keys()]) {
      if (!nextIds.has(id)) {
        positions.delete(id);
        tweens.delete(id);
      }
    }

    setActors(
      next.map((actor) => ({
        ...actor,
        position: positions.get(actor.id) ?? actor.position,
      })),
    );
    // targetsKey captures the meaningful target identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapper, targetsKey]);

  // Enqueue new pitches as they arrive from the live feed.
  useEffect(() => {
    const seen = seenPitchesRef.current;
    const pitchedIds = pitchedIdsRef.current;
    const hitIds = hitIdsRef.current;
    const realPitches = pitches.filter((p) => p.isPitch);
    if (realPitches.length === 0) {
      if (pitches.length === 0) {
        seen.clear();
        pitchedIds.clear();
        hitIds.clear();
        queueRef.current = [];
        activeRef.current = null;
        setBall({ phase: "idle", position: [0, 0.2, 0], trail: [], pitchNumber: null });
      }
      return;
    }

    const maxSeen = Math.max(0, ...[...seen].map((k) => Number(k.split(":")[0]) || 0));
    const maxNow = Math.max(0, ...realPitches.map((p) => p.pitchNumber));
    if (maxNow < maxSeen) {
      seen.clear();
      pitchedIds.clear();
      hitIds.clear();
      queueRef.current = [];
      activeRef.current = null;
    }

    const bootstrapping = seen.size === 0 && realPitches.length > 1;

    for (const pitch of realPitches) {
      const key = pitchKey(pitch);
      const id = pitchIdentity(pitch);
      if (seen.has(key)) continue;

      const isLatest = pitch === realPitches[realPitches.length - 1];
      if (bootstrapping && !isLatest) {
        seen.add(key);
        pitchedIds.add(id);
        if (pitch.isInPlay && pitch.hit) hitIds.add(id);
        continue;
      }

      seen.add(key);

      if (!pitchedIds.has(id)) {
        pitchedIds.add(id);
        const pitchPath = buildPitchPath(mapper, pitch);
        queueRef.current.push({
          kind: "pitch",
          pitchNumber: pitch.pitchNumber,
          points: pitchPath.points,
          durationMs: pitchPath.durationMs,
          startedAt: 0,
        });
      }

      if (pitch.isInPlay && pitch.hit && !hitIds.has(id)) {
        hitIds.add(id);
        const hitPath = buildHitPath(mapper, pitch.hit);
        queueRef.current.push({
          kind: "hit",
          pitchNumber: pitch.pitchNumber,
          points: hitPath.points,
          durationMs: hitPath.durationMs,
          startedAt: 0,
          hitPursuit: pursuitTargets(mapper, defenseRef.current, pitch.hit),
        });
      }
    }
  }, [pitches, mapper]);

  // Animation frame loop.
  useEffect(() => {
    let frame = 0;
    let idleClearTimer: ReturnType<typeof setTimeout> | null = null;

    const step = (now: number) => {
      frame = requestAnimationFrame(step);

      let active = activeRef.current;
      if (!active && queueRef.current.length > 0) {
        active = queueRef.current.shift()!;
        active.startedAt = now;
        activeRef.current = active;

        if (active.kind === "hit" && active.hitPursuit) {
          for (const [id, to] of active.hitPursuit) {
            const from = actorPosRef.current.get(id);
            if (!from) continue;
            actorTweensRef.current.set(id, {
              from,
              to,
              startedAt: now,
              durationMs: FIELDER_REACT_S * 1000 + active.durationMs * 0.35,
            });
          }
        }
      }

      let ballChanged = false;
      if (active) {
        const t = clamp((now - active.startedAt) / active.durationMs);
        const position = samplePath(active.points, t);
        const trail = trailUpTo(active.points, t);
        setBall({
          phase: active.kind === "pitch" ? "pitch" : t >= 1 ? "settled" : "hit",
          position,
          trail,
          pitchNumber: active.pitchNumber,
        });
        ballChanged = true;
        if (t >= 1) {
          const finished = active;
          activeRef.current = null;
          if (finished.kind === "pitch" && queueRef.current[0]?.kind !== "hit") {
            if (idleClearTimer) clearTimeout(idleClearTimer);
            idleClearTimer = setTimeout(() => {
              if (!activeRef.current) {
                setBall((prev) =>
                  prev.phase === "pitch" || prev.phase === "settled"
                    ? { ...prev, phase: "idle", trail: [] }
                    : prev,
                );
              }
            }, 400);
          }
        }
      }

      const tweens = actorTweensRef.current;
      const positions = actorPosRef.current;
      let moved = false;
      for (const [id, tween] of [...tweens]) {
        const t = easeInOut(clamp((now - tween.startedAt) / tween.durationMs));
        positions.set(id, lerpVec(tween.from, tween.to, t));
        moved = true;
        if (t >= 1) tweens.delete(id);
      }

      if (moved) {
        setActors((prev) =>
          prev.map((actor) => ({
            ...actor,
            position: positions.get(actor.id) ?? actor.position,
          })),
        );
      }

      void ballChanged;
    };

    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      if (idleClearTimer) clearTimeout(idleClearTimer);
    };
  }, []);

  return { ball, actors, mapper };
}
