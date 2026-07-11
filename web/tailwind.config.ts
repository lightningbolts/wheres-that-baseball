import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        surface: "var(--surface)",
        "surface-elevated": "var(--surface-elevated)",
        panel: "var(--panel)",
        scorebug: "var(--scorebug)",
        "scorebug-fg": "var(--scorebug-fg)",
        "scorebug-muted": "var(--scorebug-muted)",
        "zone-chart-bg": "var(--zone-chart-bg)",
        "zone-chart-grid": "var(--zone-chart-grid)",
        "zone-chart-plate": "var(--zone-chart-plate)",
        "field-chart-bg": "var(--field-chart-bg)",
        "field-chart-canvas": "var(--field-chart-canvas-bg)",
        hover: "var(--hover)",
        overlay: "var(--overlay)",
        foreground: "var(--foreground)",
        secondary: "var(--secondary)",
        muted: "var(--muted)",
        subtle: "var(--subtle)",
        faint: "var(--faint)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
      },
      fontFamily: {
        sans: ["var(--font-ibm-plex-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-ibm-plex-serif)", "Georgia", "serif"],
        mono: ["var(--font-jetbrains)", "ui-monospace", "monospace"],
      },
      keyframes: {
        pitchIn: {
          from: { opacity: "0.82", transform: "translateY(2px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        playIn: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "60%": { opacity: "0.85", transform: "translateY(-1px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        toastIn: {
          "0%": { opacity: "0", transform: "translateY(12px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        toastOut: {
          "0%": { opacity: "1", transform: "translateY(0) scale(1)" },
          "100%": { opacity: "0", transform: "translateY(10px) scale(0.98)" },
        },
      },
      animation: {
        pulse_slow: "pulse 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        pitch_in: "pitchIn 0.16s ease-out forwards",
        play_in: "playIn 0.38s cubic-bezier(0.22, 1, 0.36, 1) forwards",
        toast_in: "toastIn 0.28s cubic-bezier(0.22, 1, 0.36, 1) forwards",
        toast_out: "toastOut 0.42s cubic-bezier(0.4, 0, 0.2, 1) forwards",
      },
    },
  },
  plugins: [],
};

export default config;
