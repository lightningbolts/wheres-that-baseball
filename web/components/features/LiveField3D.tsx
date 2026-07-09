"use client";

import dynamic from "next/dynamic";

import type { LiveField3DCanvasProps } from "@/components/features/LiveField3DCanvas";

export type { LiveField3DCanvasProps as LiveField3DProps };

/** SSR-safe live 3D field — R3F must load on the client only. */
export const LiveField3D = dynamic(
  () =>
    import("@/components/features/LiveField3DCanvas").then((m) => m.LiveField3DCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[280px] flex-1 items-center justify-center border border-border bg-field-chart-canvas text-xs text-subtle sm:min-h-[360px]">
        Loading live field…
      </div>
    ),
  },
);
