import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([".next/**", "node_modules/**"]),
  {
    rules: {
      // Data-fetch hooks legitimately reset state when inputs change.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // R3F scene code mutates three.js objects and shared playback state every frame
    // (useFrame), which is the intended pattern there but trips the React-compiler
    // purity rule.
    files: ["components/game/scene/**"],
    rules: {
      "react-hooks/immutability": "off",
    },
  },
]);
