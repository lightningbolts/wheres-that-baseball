const STORAGE_KEY = "app-scroll-positions";
const RETURN_SCROLL_PREFIX = "return:";
const MAX_RESTORE_ATTEMPTS = 48;

let activeRestoreCleanup: (() => void) | null = null;
let blockPersistUntil = 0;

export function buildScrollKey(pathname: string, search = ""): string {
  return search ? `${pathname}?${search}` : pathname;
}

export function buildReturnScrollKey(pathname: string, search = ""): string {
  return `${RETURN_SCROLL_PREFIX}${buildScrollKey(pathname, search)}`;
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

/** Freeze scroll for returning to a parent route; not updated by live scroll tracking. */
export function saveReturnScrollPosition(pathname: string, y: number, search = ""): void {
  saveScrollPosition(buildReturnScrollKey(pathname, search), y);
}

export function getReturnScrollY(pathname: string, search = ""): number | undefined {
  return getSavedScrollY(buildReturnScrollKey(pathname, search));
}

export function blockScrollPersist(ms = 1500): void {
  blockPersistUntil = Date.now() + ms;
}

export function shouldPersistScroll(): boolean {
  return Date.now() >= blockPersistUntil;
}

export function clearScrollPersistBlock(): void {
  blockPersistUntil = 0;
}

/** Routes where scroll restore waits for async content (handled by useRestoreScrollWhenReady). */
export function isAsyncScrollRoute(pathname: string): boolean {
  return (
    pathname === "/nerd" ||
    pathname === "/ballparks" ||
    /^\/ballparks\/\d+$/.test(pathname) ||
    /^\/nerd\/team\/\d+$/.test(pathname) ||
    /^\/nerd\/[^/]+$/.test(pathname)
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
  let restoring = true;

  const complete = () => {
    if (cancelled) return;
    cancelled = true;
    restoring = false;
    if (rafId) cancelAnimationFrame(rafId);
    observer.disconnect();
    timeouts.forEach((id) => window.clearTimeout(id));
    window.removeEventListener("wheel", onUserIntent, true);
    window.removeEventListener("touchstart", onUserIntent, true);
    window.removeEventListener("keydown", onUserIntent, true);
    activeRestoreCleanup = null;
    onDone?.();
  };

  const onUserIntent = () => {
    if (restoring) return;
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
      restoring = false;
      clearScrollPersistBlock();
      complete();
      return;
    }

    if (attempts < MAX_RESTORE_ATTEMPTS) {
      rafId = requestAnimationFrame(tryRestore);
    } else {
      restoring = false;
      clearScrollPersistBlock();
      complete();
    }
  };

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
