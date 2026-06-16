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
]);
