"use client";

import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";

interface NerdShareActionsProps {
  sharePath: string;
  shareCardQuery: string;
  shareTitle: string;
  className?: string;
}

export function NerdShareActions({
  sharePath,
  shareCardQuery,
  shareTitle,
  className,
}: NerdShareActionsProps) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}${sharePath}` : "";

  const copyLink = useCallback(async () => {
    if (!shareUrl) return;
    setShareError(null);
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setShareError("Could not copy link");
    }
  }, [shareUrl]);

  const downloadShareCard = useCallback(async () => {
    setShareError(null);
    setDownloading(true);
    try {
      const response = await fetch(`/api/nerd-stats/share-card?${shareCardQuery}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to generate share card");
      }
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) {
        throw new Error("Invalid share card response");
      }
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = "nerd-standings.png";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setShareError(
        error instanceof Error && error.message ? error.message : "Could not download share card",
      );
    } finally {
      setDownloading(false);
    }
  }, [shareCardQuery]);

  const nativeShare = useCallback(async () => {
    if (!shareUrl || !navigator.share) return;
    setShareError(null);
    try {
      await navigator.share({ title: shareTitle, url: shareUrl });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setShareError("Could not open share sheet");
    }
  }, [shareTitle, shareUrl]);

  const canNativeShare = typeof navigator !== "undefined" && "share" in navigator;

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => void copyLink()}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-secondary hover:bg-hover"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
        <button
          type="button"
          onClick={() => void downloadShareCard()}
          disabled={downloading}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-secondary hover:bg-hover disabled:opacity-60"
        >
          {downloading ? "Generating…" : "Share card"}
        </button>
        {canNativeShare && (
          <button
            type="button"
            onClick={() => void nativeShare()}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-secondary hover:bg-hover"
          >
            Share
          </button>
        )}
      </div>
      {shareError && <p className="text-[11px] text-red-400">{shareError}</p>}
    </div>
  );
}
