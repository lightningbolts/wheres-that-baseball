const STORAGE_KEY = "app-scroll-positions";
const MAX_RESTORE_ATTEMPTS = 48;

let activeRestoreCleanup: (() => void) | null = null;

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

/** Routes where scroll restore waits for async content (handled by useRestoreScrollWhenReady). */
export function isAsyncScrollRoute(pathname: string): boolean {
  return (
    pathname === "/nerd" ||
    pathname === "/ballparks" ||
    /^\/ballparks\/\d+$/.test(pathname) ||
    /^\/nerd\/team\/\d+$/.test(pathname)
  );
}

export function restoreScrollPosition(
  targetY: number,
  onDone?: () => void,
): () => void {
  activeRestoreCleanup?.();

  let attempts = 0;
  let cancelled = false;
  let rafId = 0;
  let programmaticScroll = false;

  const complete = () => {
    if (cancelled) return;
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    observer.disconnect();
    timeouts.forEach((id) => window.clearTimeout(id));
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("wheel", onUserIntent, true);
    window.removeEventListener("touchstart", onUserIntent, true);
    window.removeEventListener("keydown", onUserIntent, true);
    activeRestoreCleanup = null;
    onDone?.();
  };

  const onUserIntent = () => {
    complete();
  };

  const onScroll = () => {
    if (cancelled || programmaticScroll) return;
    complete();
  };

  const tryRestore = () => {
    if (cancelled) return;

    programmaticScroll = true;
    window.scrollTo(0, targetY);
    requestAnimationFrame(() => {
      programmaticScroll = false;
    });

    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    attempts += 1;

    const closeEnough = Math.abs(window.scrollY - targetY) < 4;
    const canReach = maxScroll >= targetY - 8;

    if (closeEnough || (canReach && attempts >= 4)) {
      complete();
      return;
    }

    if (attempts < MAX_RESTORE_ATTEMPTS) {
      rafId = requestAnimationFrame(tryRestore);
    } else {
      complete();
    }
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("wheel", onUserIntent, { passive: true, capture: true });
  window.addEventListener("touchstart", onUserIntent, { passive: true, capture: true });
  window.addEventListener("keydown", onUserIntent, { capture: true });

  const observer = new ResizeObserver(() => {
    if (!cancelled) tryRestore();
  });
  observer.observe(document.body);

  const timeouts = [50, 150, 300, 600].map((ms) => window.setTimeout(tryRestore, ms));

  tryRestore();

  const cleanup = () => complete();
  activeRestoreCleanup = cleanup;
  return cleanup;
}
