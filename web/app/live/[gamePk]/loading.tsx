import { AppNav } from "@/components/features/AppNav";
import { DashboardSkeleton } from "@/components/features/DashboardSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

export default function LiveGameLoading() {
  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <AppNav />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border bg-surface px-2 py-1 sm:px-4 sm:py-2">
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-border bg-surface px-3 py-3">
            <Skeleton className="h-12 w-full" />
          </div>
          <DashboardSkeleton />
        </div>
      </div>
    </div>
  );
}
