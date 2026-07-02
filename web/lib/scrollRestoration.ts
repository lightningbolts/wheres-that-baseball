const STORAGE_KEY = "app-scroll-positions";
const MAX_RESTORE_ATTEMPTS = 48;

export function buildScrollKey(pathname: string, search = ""): string {
  return search ? `${pathname}?${search}` : pathname;
}

export function readScrollPositions(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

export function getSavedScrollY(key: string): number | undefined {
  const value = readScrollPositions()[key];
  return typeof value === "number" && value > 0 ? value : undefined;
}

export function saveScrollPosition(key: string, y: number): void {
  if (typeof window === "undefined") return;
  const positions = readScrollPositions();
  positions[key] = y;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
}

export function restoreScrollPosition(
  targetY: number,
  onDone?: () => void,
): () => void {
  let attempts = 0;
  let cancelled = false;

  const tryRestore = () => {
    if (cancelled) return;

    window.scrollTo(0, targetY);
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    attempts += 1;

    const closeEnough = Math.abs(window.scrollY - targetY) < 4;
    const canReach = maxScroll >= targetY - 8;

    if (closeEnough || (canReach && attempts >= 6)) {
      onDone?.();
      return;
    }

    if (attempts < MAX_RESTORE_ATTEMPTS) {
      requestAnimationFrame(tryRestore);
    } else {
      onDone?.();
    }
  };

  tryRestore();

  const observer = new ResizeObserver(() => {
    if (!cancelled) tryRestore();
  });
  observer.observe(document.body);

  const timeouts = [50, 150, 300, 600, 1000, 1500].map((ms) =>
    window.setTimeout(tryRestore, ms),
  );

  return () => {
    cancelled = true;
    observer.disconnect();
    timeouts.forEach((id) => window.clearTimeout(id));
  };
}
