import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Deno Edge Functions (Task 11): separate runtime/deployable with Deno
    // globals and URL-specifier imports ESLint's Node/TS tooling can't
    // resolve — see tsconfig.json's exclude comment for the full rationale.
    "supabase/functions/**",
  ]),
]);

export default eslintConfig;
