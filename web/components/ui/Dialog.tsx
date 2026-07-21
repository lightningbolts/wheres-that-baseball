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

export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // useLayoutEffect: open before paint so the page never flashes a closed dialog frame.
  useLayoutEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  const handleClose = () => {
    onClose();
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
      handleClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      onClick={handleBackdropClick}
      className={cn(
        // display is controlled by globals.css (dialog[open] / :not([open])) so a closed
        // dialog never leaks into the page when we keep it mounted.
        "w-[min(100%,560px)] max-w-[calc(100%-2rem)] max-h-[90vh] flex-col border border-border-strong bg-panel p-0 text-foreground shadow-2xl backdrop:bg-black/60",
        "max-md:fixed max-md:inset-0 max-md:m-0 max-md:h-dvh max-md:max-h-none max-md:w-full max-md:max-w-none max-md:rounded-none max-md:border-0",
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 max-md:px-3 max-md:py-2.5">
        <h2 className="min-w-0 pr-2 text-sm font-medium leading-snug text-foreground max-md:text-[13px]">
          {title}
        </h2>
        <button
          type="button"
          onClick={handleClose}
          className="px-2 py-1 text-muted hover:text-foreground"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain p-3 max-md:p-2.5">
        {children}
      </div>
    </dialog>
  );
}
