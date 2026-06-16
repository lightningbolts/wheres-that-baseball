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
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "ui-monospace", "monospace"],
      },
      keyframes: {
        pitchIn: {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        pulse_slow: "pulse 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        pitch_in: "pitchIn 0.35s ease-out forwards",
      },
    },
  },
  plugins: [],
};

export default config;
