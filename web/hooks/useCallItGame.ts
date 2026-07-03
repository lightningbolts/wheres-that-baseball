"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  CALL_IT_MODE_STORAGE_KEY,
  CALL_IT_REVEAL_MS,
  callItScoreStorageKey,
  endsAtBat,
  isScoreablePitch,
  pitchActual,
  pitchEventLabel,
  pitchKey,
  type CallItMode,
  type CallItPhase,
  type CallItScore,
} from "@/lib/mlb/callItGame";
import { isAbsStrike } from "@/lib/mlb/strikeZoneMath";
import type { LiveGameState, PlayPitch } from "@/types/mlb-live";

export type { CallItMode, CallItPhase, CallItScore } from "@/lib/mlb/callItGame";
export { isScoreablePitch } from "@/lib/mlb/callItGame";

export interface CallItReveal {
  pitch: PlayPitch;
  guess: "strike" | "ball";
  correct: boolean;
  actual: "strike" | "ball";
  absSaysStrike: boolean;
  absDisagrees: boolean;
}

export interface CallItPitchNotice {
  pitch: PlayPitch;
  label: string;
  endsAtBat: boolean;
}

export interface CallItAtBatNotice {
  batterName: string;
  description: string;
}

const REVEAL_MS = CALL_IT_REVEAL_MS;
const NOTICE_MS = 2200;

function scoreStorageKey(gamePk: number) {
  return callItScoreStorageKey(gamePk);
}

function loadScore(gamePk: number): CallItScore {
  if (typeof window === "undefined") {
    return { correct: 0, total: 0, streak: 0, bestStreak: 0 };
  }
  try {
    const raw = localStorage.getItem(scoreStorageKey(gamePk));
    if (!raw) return { correct: 0, total: 0, streak: 0, bestStreak: 0 };
    const parsed = JSON.parse(raw) as CallItScore;
    return {
      correct: parsed.correct ?? 0,
      total: parsed.total ?? 0,
      streak: parsed.streak ?? 0,
      bestStreak: parsed.bestStreak ?? 0,
    };
  } catch {
    return { correct: 0, total: 0, streak: 0, bestStreak: 0 };
  }
}

function saveScore(gamePk: number, score: CallItScore) {
  if (typeof window === "undefined") return;
  localStorage.setItem(scoreStorageKey(gamePk), JSON.stringify(score));
}

function loadMode(): CallItMode {
  if (typeof window === "undefined") return "umpire";
  const stored = localStorage.getItem(CALL_IT_MODE_STORAGE_KEY);
  return stored === "predictor" ? "predictor" : "umpire";
}

function latestAtBatForBatter(gameState: LiveGameState, batterId: number) {
  for (let i = gameState.plays.length - 1; i >= 0; i -= 1) {
    const play = gameState.plays[i];
    if (play.isAtBat && play.batterId === batterId) return play;
  }
  return null;
}

export interface UseCallItGameOptions {
  gameState: LiveGameState | null;
  paused: boolean;
  gameOver: boolean;
}

export interface UseCallItGameResult {
  mode: CallItMode;
  setMode: (mode: CallItMode) => void;
  phase: CallItPhase;
  score: CallItScore;
  activePitch: PlayPitch | null;
  reveal: CallItReveal | null;
  pitchNotice: CallItPitchNotice | null;
  atBatNotice: CallItAtBatNotice | null;
  canGuess: boolean;
  statusMessage: string;
  guess: (call: "strike" | "ball") => void;
  animatePitchIn: boolean;
}

export function useCallItGame({
  gameState,
  paused,
  gameOver,
}: UseCallItGameOptions): UseCallItGameResult {
  const gamePk = gameState?.gamePk ?? 0;
  const [mode, setModeState] = useState<CallItMode>("umpire");
  const [phase, setPhase] = useState<CallItPhase>("idle");
  const [score, setScore] = useState<CallItScore>(() => loadScore(gamePk));
  const [activePitch, setActivePitch] = useState<PlayPitch | null>(null);
  const [reveal, setReveal] = useState<CallItReveal | null>(null);
  const [pitchNotice, setPitchNotice] = useState<CallItPitchNotice | null>(null);
  const [atBatNotice, setAtBatNotice] = useState<CallItAtBatNotice | null>(null);
  const [pendingGuess, setPendingGuess] = useState<"strike" | "ball" | null>(null);
  const [animatePitchIn, setAnimatePitchIn] = useState(false);

  const resolvedRef = useRef<Set<string>>(new Set());
  const lastBatterRef = useRef<{ id: number | null; name: string }>({ id: null, name: "" });
  const lastPitchCountRef = useRef(0);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const joinedRef = useRef(false);

  const showPitchNotice = useCallback((pitch: PlayPitch) => {
    setPitchNotice({
      pitch,
      label: pitchEventLabel(pitch),
      endsAtBat: endsAtBat(pitch),
    });
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setPitchNotice(null), NOTICE_MS);
  }, []);

  const showAtBatNotice = useCallback((batterName: string, description: string) => {
    setAtBatNotice({ batterName, description });
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setAtBatNotice(null), NOTICE_MS + 400);
  }, []);

  useEffect(() => {
    setModeState(loadMode());
  }, []);

  useEffect(() => {
    if (gamePk) setScore(loadScore(gamePk));
  }, [gamePk]);

  const setMode = useCallback((next: CallItMode) => {
    setModeState(next);
    localStorage.setItem(CALL_IT_MODE_STORAGE_KEY, next);
    setPhase("idle");
    setActivePitch(null);
    setReveal(null);
    setPitchNotice(null);
    setAtBatNotice(null);
    setPendingGuess(null);
    setAnimatePitchIn(false);
  }, []);

  const recordResult = useCallback(
    (pitch: PlayPitch, guess: "strike" | "ball") => {
      const actual = pitchActual(pitch);
      const correct = guess === actual;
      const absSaysStrike = isAbsStrike(
        pitch.plateX,
        pitch.plateZ,
        pitch.strikeZoneTop,
        pitch.strikeZoneBottom,
      );
      const absDisagrees =
        (actual === "strike" && !absSaysStrike) || (actual === "ball" && absSaysStrike);

      setReveal({ pitch, guess, correct, actual, absSaysStrike, absDisagrees });
      setPhase("revealed");

      setScore((prev) => {
        const streak = correct ? prev.streak + 1 : 0;
        const next = {
          correct: prev.correct + (correct ? 1 : 0),
          total: prev.total + 1,
          streak,
          bestStreak: Math.max(prev.bestStreak, streak),
        };
        if (gamePk) saveScore(gamePk, next);
        return next;
      });

      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
      revealTimerRef.current = setTimeout(() => {
        setReveal(null);
        setActivePitch(null);
        setAnimatePitchIn(false);
        if (mode === "predictor" && !paused && !gameOver) {
          setPhase("awaiting_pre");
        } else {
          setPhase("idle");
        }
      }, REVEAL_MS);
    },
    [gamePk, mode, paused, gameOver],
  );

  const guess = useCallback(
    (call: "strike" | "ball") => {
      if (phase === "awaiting_post" && activePitch) {
        const key = pitchKey(gameState?.batterId ?? null, activePitch.pitchNumber);
        if (resolvedRef.current.has(key)) return;
        resolvedRef.current.add(key);
        recordResult(activePitch, call);
        return;
      }

      if (phase === "awaiting_pre") {
        setPendingGuess(call);
      }
    },
    [phase, activePitch, gameState?.batterId, recordResult],
  );

  useEffect(() => {
    return () => {
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!gameState || paused || gameOver) {
      setPhase("idle");
      setActivePitch(null);
      setPendingGuess(null);
      setAnimatePitchIn(false);
      return;
    }

    const batterId = gameState.batterId;
    const batterName = gameState.batterName;
    if (batterId !== lastBatterRef.current.id) {
      if (lastBatterRef.current.id != null && gameState.plays.length > 0) {
        const completed = latestAtBatForBatter(gameState, lastBatterRef.current.id);
        if (completed) {
          showAtBatNotice(
            lastBatterRef.current.name || completed.batterName,
            completed.description,
          );
        }
      }

      lastBatterRef.current = { id: batterId, name: batterName };
      lastPitchCountRef.current = gameState.atBatPitches.length;
      joinedRef.current = true;
      if (phase !== "revealed") {
        setPhase(mode === "predictor" ? "awaiting_pre" : "idle");
        setActivePitch(null);
        setPendingGuess(null);
      }
      return;
    }

    const pitches = gameState.atBatPitches;
    if (!joinedRef.current) {
      lastPitchCountRef.current = pitches.length;
      joinedRef.current = true;
      if (mode === "predictor" && phase !== "revealed") {
        setPhase("awaiting_pre");
      }
      return;
    }

    if (pitches.length <= lastPitchCountRef.current) return;
    if (phase === "revealed") return;

    const newPitch = pitches.at(-1);
    if (!newPitch) return;

    const key = pitchKey(batterId, newPitch.pitchNumber);
    if (resolvedRef.current.has(key)) {
      lastPitchCountRef.current = pitches.length;
      return;
    }

    lastPitchCountRef.current = pitches.length;

    if (!isScoreablePitch(newPitch)) {
      resolvedRef.current.add(key);
      showPitchNotice(newPitch);
      if (newPitch.hasPlateLocation !== false) {
        setActivePitch(newPitch);
        setAnimatePitchIn(true);
      }
      if (endsAtBat(newPitch)) {
        setPhase("idle");
        setPendingGuess(null);
      }
      return;
    }

    if (mode === "predictor" && pendingGuess) {
      resolvedRef.current.add(key);
      recordResult(newPitch, pendingGuess);
      setPendingGuess(null);
      return;
    }

    if (mode === "predictor") {
      resolvedRef.current.add(key);
      return;
    }

    if (newPitch.hasPlateLocation === false) {
      resolvedRef.current.add(key);
      showPitchNotice(newPitch);
      return;
    }

    setActivePitch(newPitch);
    setAnimatePitchIn(true);
    setPhase("awaiting_post");
  }, [
    gameState,
    paused,
    gameOver,
    mode,
    phase,
    pendingGuess,
    recordResult,
    showPitchNotice,
    showAtBatNotice,
  ]);

  useEffect(() => {
    if (
      mode === "predictor" &&
      phase === "idle" &&
      gameState &&
      !paused &&
      !gameOver &&
      joinedRef.current
    ) {
      setPhase("awaiting_pre");
    }
  }, [mode, phase, gameState, paused, gameOver]);

  const canGuess =
    !gameOver &&
    !paused &&
    (phase === "awaiting_pre" || phase === "awaiting_post");

  let statusMessage = "Watch the plate…";
  if (gameOver) statusMessage = "Game over — thanks for playing!";
  else if (paused) statusMessage = "Between innings…";
  else if (phase === "awaiting_pre") {
    statusMessage = pendingGuess
      ? `Locked in: ${pendingGuess} — waiting for pitch…`
      : "Predict the next pitch — strike or ball?";
  } else if (phase === "awaiting_post") statusMessage = "Call it — strike or ball?";
  else if (phase === "revealed" && reveal) {
    statusMessage = reveal.correct
      ? "Correct!"
      : `Wrong — it was a ${reveal.actual}`;
  } else if (pitchNotice) statusMessage = pitchNotice.label;
  else if (atBatNotice) statusMessage = atBatNotice.description;
  else if (mode === "umpire") statusMessage = "Waiting for next pitch…";

  return {
    mode,
    setMode,
    phase,
    score,
    activePitch,
    reveal,
    pitchNotice,
    atBatNotice,
    canGuess,
    statusMessage,
    guess,
    animatePitchIn,
  };
}
