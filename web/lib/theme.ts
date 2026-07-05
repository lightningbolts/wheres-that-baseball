export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

const THEMES: Theme[] = ["light", "dark"];

/** Map legacy theme ids saved in localStorage to the current palette. */
export function normalizeTheme(value: string | null): Theme {
  if (value === "moneyball-dark" || value === "dark") return "dark";
  return "light";
}

export function isTheme(value: string | null): value is Theme {
  return value !== null && (THEMES as string[]).includes(value);
}

export function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return normalizeTheme(stored);
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("moneyball-dark", "dark", "moneyball");
  if (theme === "dark") {
    root.classList.add("moneyball-dark", "dark");
  }
  root.style.colorScheme = theme === "dark" ? "dark" : "light";
}

export function persistTheme(theme: Theme) {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}
