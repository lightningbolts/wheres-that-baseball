"use client";

import { useEffect, useRef, useState } from "react";

import { usePlayVideo } from "@/hooks/usePlayVideo";
import { playHasVideo } from "@/lib/mlb/playVideo";
import { cn } from "@/lib/utils";
import type { PlayByPlayEntry } from "@/types/mlb-live";

interface PlayVideoPlayerProps {
  playId: string | null | undefined;
  /** Resolve via MLB Content first when known (live-friendly). */
  gamePk?: number | null;
  /** Skip resolve when the gallery already has a direct MP4. */
  videoUrl?: string | null;
  videoTitle?: string | null;
  /** Poster image — avoids downloading the MP4 until play. */
  posterUrl?: string | null;
  /** Resolve immediately (e.g. detail dialog). Gallery should leave this false. */
  autoLoad?: boolean;
  size?: "compact" | "full";
  /** Show title under the video (detail dialog). Gallery hides it. */
  showTitle?: boolean;
  className?: string;
}

/** Equilateral-ish play triangle in a square viewBox — optically centered (no ml nudges). */
function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("block fill-current", className)}
    >
      {/* Slightly right-weighted path so the glyph reads centered in a circle/square */}
      <path d="M9 6.5v11l9-5.5-9-5.5z" />
    </svg>
  );
}

/** Compact clip affordance — badge-sized, truly centered play mark. */
export function PlayVideoIcon({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-grid size-[1.125rem] shrink-0 place-items-center rounded border border-border/80 bg-surface text-subtle",
        className,
      )}
      title="Video available"
      aria-label="Video available"
    >
      <PlayGlyph className="size-[0.55rem]" />
    </span>
  );
}

export function playShowsVideoIcon(
  play: Pick<PlayByPlayEntry, "playId" | "detail" | "isAtBat">,
): boolean {
  return playHasVideo(play);
}

/** Compact rotating ring for video resolve / first-frame wait. */
function VideoLoadingSpinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading video"
      className={cn("inline-flex size-7 text-muted", className)}
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-full animate-spin" aria-hidden>
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="2.5"
        />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function PlayVideoPlayer({
  playId,
  gamePk = null,
  videoUrl = null,
  videoTitle = null,
  posterUrl = null,
  autoLoad = false,
  size = "full",
  showTitle = true,
  className,
}: PlayVideoPlayerProps) {
  const [opened, setOpened] = useState(autoLoad);
  const hasDirectUrl = Boolean(videoUrl);
  // Direct gallery URLs skip network resolve; only hit the API when we need Savant/Content lookup.
  const shouldResolve = Boolean(playId) && !hasDirectUrl && (opened || autoLoad);
  const { status, video, savantUrl, error } = usePlayVideo(playId, shouldResolve, {
    gamePk,
  });

  const resolvedVideo = hasDirectUrl && videoUrl
    ? {
        playId: playId ?? "direct",
        url: videoUrl,
        title: videoTitle ?? null,
        savantUrl: null as string | null,
      }
    : video;
  const resolvedStatus =
    hasDirectUrl
      ? opened || autoLoad
        ? ("ready" as const)
        : ("idle" as const)
      : status;

  const rootRef = useRef<HTMLDivElement>(null);
  const [frameReady, setFrameReady] = useState(false);

  useEffect(() => {
    if (autoLoad) setOpened(true);
  }, [autoLoad, playId, videoUrl]);

  useEffect(() => {
    setFrameReady(false);
  }, [resolvedVideo?.url]);

  if (!playId && !videoUrl) return null;

  const frameClass =
    size === "compact" ? "aspect-video w-full" : "aspect-video w-full min-h-[200px]";

  const showIdlePrompt = !opened && !autoLoad;
  const showResolving =
    !showIdlePrompt && (resolvedStatus === "loading" || resolvedStatus === "idle");
  const showVideo = !showIdlePrompt && resolvedStatus === "ready" && resolvedVideo;
  const showUnavailable = !showIdlePrompt && !showResolving && !showVideo;
  const showLoadingOverlay = showResolving || (showVideo && !frameReady);

  return (
    <div
      ref={rootRef}
      className={cn(
        "overflow-hidden rounded border border-border bg-field-chart-canvas",
        className,
      )}
    >
      {showIdlePrompt ? (
        <button
          type="button"
          onClick={() => setOpened(true)}
          aria-label="Play clip"
          className={cn(
            "group relative flex w-full items-center justify-center overflow-hidden bg-neutral-900",
            frameClass,
          )}
        >
          {posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- MLB CDN posters; next/image not configured for these hosts
            <img
              src={posterUrl}
              alt=""
              className="absolute inset-0 size-full object-cover transition duration-200 group-hover:scale-[1.02]"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.08),transparent_65%)]" />
          )}
          <span className="absolute inset-0 bg-black/40 transition-colors group-hover:bg-black/50" />
          <span className="relative z-[1] grid size-14 place-items-center rounded-full bg-white text-neutral-950 shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-transform duration-200 group-hover:scale-105">
            <PlayGlyph className="size-5 translate-x-px" />
          </span>
        </button>
      ) : showUnavailable ? (
        <div
          className={cn(
            "flex flex-col items-center justify-center gap-2 bg-field-chart-canvas px-4 text-center",
            frameClass,
          )}
        >
          <p className="text-xs text-subtle">
            {resolvedStatus === "error"
              ? error ?? "Could not load video"
              : "No clip available for this play yet"}
          </p>
          {savantUrl && playId && (
            <a
              href={savantUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-medium text-muted underline-offset-2 hover:text-foreground hover:underline"
            >
              Open on Baseball Savant
            </a>
          )}
        </div>
      ) : (
        <div className="relative bg-field-chart-canvas">
          {showVideo ? (
            <video
              key={resolvedVideo.url}
              controls
              playsInline
              // Only one clip loads after the user taps — metadata is enough for a poster frame.
              preload="metadata"
              poster={posterUrl ?? undefined}
              className={cn("bg-black object-contain", frameClass)}
              src={resolvedVideo.url}
              onLoadedData={() => setFrameReady(true)}
              onLoadedMetadata={() => setFrameReady(true)}
              onCanPlay={() => setFrameReady(true)}
              onError={() => setFrameReady(true)}
            >
              <track kind="captions" />
            </video>
          ) : null}
          {showLoadingOverlay ? (
            <div
              className={cn(
                "flex items-center justify-center bg-field-chart-canvas",
                showVideo ? "absolute inset-0 z-10" : frameClass,
              )}
              aria-busy
              aria-live="polite"
            >
              {posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={posterUrl}
                  alt=""
                  className="absolute inset-0 size-full object-cover opacity-40"
                />
              ) : null}
              <VideoLoadingSpinner className="relative z-[1]" />
            </div>
          ) : null}
          {showVideo && showTitle && (resolvedVideo.title || videoTitle) && frameReady ? (
            <p className="border-t border-border/40 bg-field-chart-canvas px-2.5 py-1.5 text-[11px] leading-snug text-subtle">
              {resolvedVideo.title || videoTitle}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
