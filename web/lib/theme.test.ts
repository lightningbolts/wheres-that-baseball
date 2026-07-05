// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  THEME_STORAGE_KEY,
  applyTheme,
  getInitialTheme,
  isTheme,
  normalizeTheme,
  persistTheme,
} from "@/lib/theme";

function mockLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  });
  return store;
}

describe("isTheme", () => {
  it("accepts valid theme values", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
  });

  it("rejects legacy values", () => {
    expect(isTheme("moneyball")).toBe(false);
    expect(isTheme("moneyball-dark")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});

describe("normalizeTheme", () => {
  it("maps legacy storage to light/dark moneyball palettes", () => {
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("moneyball-dark")).toBe("dark");
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("moneyball")).toBe("light");
    expect(normalizeTheme(null)).toBe("light");
  });
});

describe("applyTheme", () => {
  beforeEach(() => {
    document.documentElement.className = "moneyball-dark dark";
    document.documentElement.style.colorScheme = "dark";
  });

  afterEach(() => {
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
  });

  it("applies dark moneyball classes", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("moneyball-dark")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("applies light moneyball with no theme classes", () => {
    applyTheme("light");
    expect(document.documentElement.classList.contains("moneyball-dark")).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});

describe("getInitialTheme", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns stored dark preference", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(getInitialTheme()).toBe("dark");
  });

  it("migrates legacy moneyball-dark storage", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "moneyball-dark");
    expect(getInitialTheme()).toBe("dark");
  });

  it("defaults to light when storage is empty", () => {
    expect(getInitialTheme()).toBe("light");
  });
});

describe("persistTheme", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists dark to localStorage", () => {
    persistTheme("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });
});
