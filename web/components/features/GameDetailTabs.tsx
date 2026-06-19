"use client";

import { cn } from "@/lib/utils";

export type GameDetailTab = "plays" | "box" | "spray";

interface GameDetailTabsProps {
  activeTab: GameDetailTab;
  onTabChange: (tab: GameDetailTab) => void;
  className?: string;
}

const TABS: { id: GameDetailTab; label: string }[] = [
  { id: "plays", label: "Play-by-Play" },
  { id: "box", label: "Box" },
  { id: "spray", label: "Spray" },
];

export function GameDetailTabs({ activeTab, onTabChange, className }: GameDetailTabsProps) {
  return (
    <div className={cn("flex gap-1 border-b border-border bg-surface px-4", className)}>
      {TABS.map((tab) => {
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
  );
}
