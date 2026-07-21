"use client";

import { useEffect, useRef, useState } from "react";

import { usePlayVideo } from "@/hooks/usePlayVideo";
import { playHasVideo } from "@/lib/mlb/playVideo";
import { cn } from "@/lib/utils";
import type { PlayByPlayEntry } from "@/types/mlb-live";

interface PlayVideoPlayerProps {
  playId: string | null | undefined;
  /** Resolve immediately (e.g. detail dialog / in-view gallery). Default: wait for user click. */
  autoLoad?: boolean;
  size?: "compact" | "full";
  /** Show Savant title under the video (detail dialog). Gallery hides it. */
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

/** Force browsers to paint the first frame as a preview poster. */
function videoPreviewSrc(url: string): string {
  if (url.includes("#")) return url;
  return `${url}#t=0.1`;
}

export function PlayVideoPlayer({
  playId,
  autoLoad = false,
  size = "full",
  showTitle = true,
  className,
}: PlayVideoPlayerProps) {
  const [opened, setOpened] = useState(autoLoad);
  const enabled = Boolean(playId) && (opened || autoLoad);
  const { status, video, savantUrl, error } = usePlayVideo(playId, enabled);
  const rootRef = useRef<HTMLDivElement>(null);
  const [frameReady, setFrameReady] = useState(false);

  useEffect(() => {
    if (autoLoad) setOpened(true);
  }, [autoLoad, playId]);

  useEffect(() => {
    setFrameReady(false);
  }, [video?.url]);

  useEffect(() => {
    if (!autoLoad || !playId || opened) return;
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setOpened(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setOpened(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px 0px", threshold: 0.05 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [autoLoad, playId, opened]);

  if (!playId) return null;

  const frameClass =
    size === "compact" ? "aspect-video w-full" : "aspect-video w-full min-h-[200px]";

  const showIdlePrompt = !opened && !autoLoad;
  const showResolving = !showIdlePrompt && (status === "loading" || status === "idle");
  const showVideo = !showIdlePrompt && status === "ready" && video;
  const showUnavailable =
    !showIdlePrompt && !showResolving && !showVideo;
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
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 bg-field-chart-canvas px-4 text-sm text-muted transition-colors hover:bg-hover hover:text-foreground",
            frameClass,
          )}
        >
          <span className="grid size-10 place-items-center rounded-full border border-border bg-surface text-foreground">
            <PlayGlyph className="size-4" />
          </span>
          <span>Load play video</span>
        </button>
      ) : showUnavailable ? (
        <div
          className={cn(
            "flex flex-col items-center justify-center gap-2 bg-field-chart-canvas px-4 text-center",
            frameClass,
          )}
        >
          <p className="text-xs text-subtle">
            {status === "error"
              ? error ?? "Could not load video"
              : "No clip available for this play"}
          </p>
          {savantUrl && (
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
              key={video.url}
              controls
              playsInline
              preload="metadata"
              className={cn("bg-black object-contain", frameClass)}
              src={videoPreviewSrc(video.url)}
              onLoadedData={() => setFrameReady(true)}
              onError={() => setFrameReady(true)}
            >
              <track kind="captions" />
            </video>
          ) : null}
          {showLoadingOverlay ? (
            <div
              className={cn(
                "flex items-center justify-center bg-field-chart-canvas px-4 text-xs text-subtle",
                showVideo ? "absolute inset-0 z-10" : frameClass,
              )}
              aria-busy
              aria-live="polite"
            >
              Loading preview…
            </div>
          ) : null}
          {showVideo && showTitle && video.title && frameReady ? (
            <p className="border-t border-border/40 bg-field-chart-canvas px-2.5 py-1.5 text-[11px] leading-snug text-subtle">
              {video.title}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
