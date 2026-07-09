"use client";

import { cn } from "@/lib/utils";

export type GameDetailTab = "plays" | "box" | "field" | "spray" | "callIt";

interface GameDetailTabsProps {
  activeTab: GameDetailTab;
  onTabChange: (tab: GameDetailTab) => void;
  className?: string;
  /** Hide Call It tab for non-live games. */
  showCallItTab?: boolean;
  /** Tighter tabs for mobile game view. */
  compact?: boolean;
}

const ALL_TABS: { id: GameDetailTab; label: string; shortLabel: string }[] = [
  { id: "plays", label: "Play-by-Play", shortLabel: "Plays" },
  { id: "callIt", label: "Call It", shortLabel: "Call It" },
  { id: "box", label: "Box", shortLabel: "Box" },
  { id: "field", label: "Field", shortLabel: "Field" },
  { id: "spray", label: "Spray", shortLabel: "Spray" },
];

export function GameDetailTabs({
  activeTab,
  onTabChange,
  className,
  showCallItTab = true,
  compact = false,
}: GameDetailTabsProps) {
  const tabs = showCallItTab
    ? ALL_TABS
    : ALL_TABS.filter((tab) => tab.id !== "callIt");
  return (
    <div className={cn("shrink-0 overflow-x-auto border-b border-border bg-surface", className)}>
      <div className={cn("flex min-w-max gap-0.5", compact ? "px-2" : "gap-1 px-3 sm:px-4")}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "border-b-2 font-medium transition-colors",
                compact
                  ? "px-2 py-1.5 text-[11px] sm:px-3 sm:py-2 sm:text-sm"
                  : "px-3 py-2.5 text-sm",
                isActive
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted hover:text-secondary",
              )}
            >
              <span className={compact ? "sm:hidden" : "hidden"}>{tab.shortLabel}</span>
              <span className={compact ? "hidden sm:inline" : "inline"}>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
