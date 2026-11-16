import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // Whole-game simulations take several seconds each under parallel load.
    testTimeout: 30_000,
    include: ["lib/**/*.test.ts", "components/game/**/*.test.ts", "hooks/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
