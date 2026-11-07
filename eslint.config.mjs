import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next/core-web-vitals";
import ts from "eslint-config-next/typescript";
export default defineConfig([
  ...next,
  ...ts,
  {
    rules: {
      // A full navigation after auth changes clears private RSC/router caches.
      "@next/next/no-location-assign-relative-destination": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "src/app/.well-known/workflow/**",
    ".workflow-data/**",
    ".local/**",
    "test-results/**",
    "playwright-report/**",
    "next-env.d.ts",
  ]),
]);
