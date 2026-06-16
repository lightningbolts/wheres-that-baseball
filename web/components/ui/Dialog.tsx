"use client";

import { useEffect, useRef } from "react";

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

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className={cn(
        "fixed inset-0 z-50 m-auto max-h-[90vh] w-[min(100%,560px)] border border-border-strong bg-panel p-0 text-foreground shadow-2xl",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="px-2 py-1 text-muted hover:text-foreground"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className="max-h-[calc(90vh-48px)] overflow-y-auto p-3">{children}</div>
    </dialog>
  );
}
