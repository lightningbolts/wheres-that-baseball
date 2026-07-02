"use client";

import { cn } from "@/lib/utils";

export type GameDetailTab = "plays" | "box" | "spray" | "callIt";

interface GameDetailTabsProps {
  activeTab: GameDetailTab;
  onTabChange: (tab: GameDetailTab) => void;
  className?: string;
  /** Hide Call It tab for non-live games. */
  showCallItTab?: boolean;
}

const ALL_TABS: { id: GameDetailTab; label: string }[] = [
  { id: "plays", label: "Play-by-Play" },
  { id: "callIt", label: "Call It" },
  { id: "box", label: "Box" },
  { id: "spray", label: "Spray" },
];

export function GameDetailTabs({
  activeTab,
  onTabChange,
  className,
  showCallItTab = true,
}: GameDetailTabsProps) {
  const tabs = showCallItTab
    ? ALL_TABS
    : ALL_TABS.filter((tab) => tab.id !== "callIt");
  return (
    <div className={cn("shrink-0 overflow-x-auto border-b border-border bg-surface", className)}>
      <div className="flex min-w-max gap-1 px-3 sm:px-4">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted hover:text-secondary",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
