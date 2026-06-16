import { cn } from "@/lib/utils";

interface OutIndicatorProps {
  outs: number;
  className?: string;
  compact?: boolean;
}

export function OutIndicators({ outs, className, compact }: OutIndicatorProps) {
  const safeOuts = Math.min(3, Math.max(0, outs ?? 0));

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1", className)} aria-label={`${safeOuts} outs`}>
        <span className="mr-0.5 text-[11px] text-subtle">O</span>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              "h-2 w-2 rounded-full",
              i < safeOuts ? "bg-secondary" : "bg-faint",
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)} aria-label={`${safeOuts} outs`}>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            "h-3 w-3 rounded-full border",
            index < safeOuts ? "border-secondary bg-secondary" : "border-faint bg-transparent",
          )}
        />
      ))}
    </div>
  );
}

interface CountDisplayProps {
  balls: number;
  strikes: number;
  className?: string;
  compact?: boolean;
}

export function CountDisplay({ balls, strikes, className, compact }: CountDisplayProps) {
  if (compact) {
    return (
      <div
        className={cn("font-mono text-[13px] tabular-nums", className)}
        aria-label={`Count ${balls ?? 0} balls, ${strikes ?? 0} strikes`}
      >
        <span className="text-muted">{balls ?? 0}</span>
        <span className="text-faint">-</span>
        <span className="text-secondary">{strikes ?? 0}</span>
      </div>
    );
  }

  return (
    <div
      className={cn("flex items-baseline gap-3 font-mono text-lg tracking-tight", className)}
      aria-label={`Count ${balls ?? 0} balls, ${strikes ?? 0} strikes`}
    >
      <span className="text-secondary">
        <span className="text-xs font-sans text-subtle">B</span> {balls ?? 0}
      </span>
      <span className="text-faint">—</span>
      <span className="text-secondary">
        <span className="text-xs font-sans text-subtle">S</span> {strikes ?? 0}
      </span>
    </div>
  );
}
