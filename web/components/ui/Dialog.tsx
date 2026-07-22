"use client";

import { useLayoutEffect, useRef } from "react";

import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Block the dismiss gesture from "falling through" to controls underneath the
 * dialog (common on mobile when a fullscreen modal closes on the same tap —
 * the synthetic click can re-hit "Play details" / chart controls).
 */
function suppressClickThrough(durationMs = 450) {
  const block = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  document.addEventListener("click", block, true);
  window.setTimeout(() => {
    document.removeEventListener("click", block, true);
  }, durationMs);
}

export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closingRef = useRef(false);

  // useLayoutEffect: open before paint so the page never flashes a closed dialog frame.
  useLayoutEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    if (open) {
      closingRef.current = false;
      if (!el.open) {
        el.showModal();
      }
    } else if (el.open) {
      el.close();
    }

    // If a parent unmounts while the dialog is still modal (e.g. Final/DueUp
    // returning null), close it so the document doesn't stay inert.
    return () => {
      if (el.open) {
        el.close();
      }
    };
  }, [open]);

  const notifyClosed = () => {
    suppressClickThrough();
    onClose();
  };

  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;

    const el = dialogRef.current;
    if (el?.open) {
      // Close the native dialog first so the top layer is gone before the
      // originating tap can hit "Play details" / chart controls underneath.
      el.close();
      return;
    }

    notifyClosed();
  };

  const handleBackdropClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    const el = dialogRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const clickedBackdrop =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;

    if (clickedBackdrop) {
      requestClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={notifyClosed}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={handleBackdropClick}
      className={cn(
        // display is controlled by globals.css (dialog[open] / :not([open])) so a closed
        // dialog never leaks into the page when we keep it mounted.
        "w-[min(100%,560px)] max-w-[calc(100%-2rem)] max-h-[90vh] flex-col border border-border-strong bg-panel p-0 text-foreground shadow-2xl backdrop:bg-black/60",
        "max-md:fixed max-md:inset-0 max-md:m-0 max-md:h-dvh max-md:max-h-none max-md:w-full max-md:max-w-none max-md:rounded-none max-md:border-0",
        "max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      <div className="relative z-10 flex shrink-0 items-center justify-between border-b border-border px-4 py-3 max-md:px-3 max-md:py-2.5">
        <h2 className="min-w-0 pr-2 text-sm font-medium leading-snug text-foreground max-md:text-[13px]">
          {title}
        </h2>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            requestClose();
          }}
          className="-mr-1 flex h-10 w-10 shrink-0 items-center justify-center text-muted hover:text-foreground max-md:h-11 max-md:w-11"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className="relative z-0 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain p-3 max-md:p-2.5">
        {children}
      </div>
    </dialog>
  );
}
