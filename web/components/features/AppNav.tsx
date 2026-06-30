"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useTheme } from "@/components/providers/ThemeProvider";
import { SITE_NAME, SITE_NAME_SHORT } from "@/lib/site";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Live", shortLabel: "Live" },
  { href: "/games", label: "Season History", shortLabel: "History" },
  { href: "/ballparks", label: "Ballpark Hits", shortLabel: "Parks" },
  { href: "/nerd", label: "Nerd Standings", shortLabel: "Nerd" },
] as const;

const DONATE_URL = "https://buymeacoffee.com/timberlake2025";

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-secondary transition-colors hover:bg-hover hover:text-foreground sm:px-2.5"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? (
        <>
          <SunIcon />
          <span className="hidden sm:inline">Light</span>
        </>
      ) : (
        <>
          <MoonIcon />
          <span className="hidden sm:inline">Dark</span>
        </>
      )}
    </button>
  );
}

function DonateButton() {
  return (
    <a
      href={DONATE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="flex shrink-0 items-center gap-1 rounded-md bg-amber-400 px-2.5 py-1.5 text-xs font-medium text-amber-950 transition-colors hover:bg-amber-300 sm:gap-1.5 sm:px-3"
    >
      <CoffeeIcon />
      <span>Donate</span>
    </a>
  );
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function CoffeeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 2v2M14 2v2M6 8h12l-1 10H7L6 8z" />
      <path d="M6 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2M18 10h1a2 2 0 0 1 0 4h-1" />
    </svg>
  );
}

function NavLinks({ pathname }: { pathname: string }) {
  return (
    <>
      {NAV_ITEMS.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/" || pathname.startsWith("/live/")
            : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1.5 text-xs transition-colors sm:px-3 sm:text-sm",
              isActive
                ? "bg-surface-elevated text-foreground"
                : "text-secondary hover:bg-hover hover:text-foreground",
            )}
          >
            <span className="sm:hidden">{item.shortLabel}</span>
            <span className="hidden sm:inline">{item.label}</span>
          </Link>
        );
      })}
    </>
  );
}

export function AppNav() {
  const pathname = usePathname();

  return (
    <header className="shrink-0 border-b border-border bg-surface py-2 sm:py-3">
      <div className="mx-auto w-full max-w-6xl px-4">
        {/* Desktop: title + tabs left, actions right */}
        <div className="hidden items-center justify-between gap-4 sm:flex">
          <div className="flex min-w-0 items-center gap-4 lg:gap-6">
            <Link href="/" className="shrink-0 text-sm font-medium text-foreground">
              {SITE_NAME}
            </Link>
            <nav className="flex items-center gap-0.5 lg:gap-1" aria-label="Main">
              <NavLinks pathname={pathname} />
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <DonateButton />
            <ThemeToggle />
          </div>
        </div>

        {/* Mobile: title + actions, then scrollable tabs */}
        <div className="flex flex-col gap-2 sm:hidden">
          <div className="flex items-center justify-between gap-2">
            <Link href="/" className="shrink-0 text-sm font-medium text-foreground">
              {SITE_NAME_SHORT}
            </Link>
            <div className="flex shrink-0 items-center gap-1.5">
              <DonateButton />
              <ThemeToggle />
            </div>
          </div>
          <nav
            className="-mx-1 flex items-center gap-0.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Main"
          >
            <NavLinks pathname={pathname} />
          </nav>
        </div>
      </div>
    </header>
  );
}
