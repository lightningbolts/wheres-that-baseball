"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Live" },
  { href: "/games", label: "Season History" },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-neutral-800 bg-[#111] px-4 py-3">
      <div className="flex items-center gap-6">
        <Link href="/" className="text-sm font-medium text-neutral-100">
          MLB At-Bat Predictor
        </Link>
        <nav className="flex items-center gap-1" aria-label="Main">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-neutral-800 text-white"
                    : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
