// Lint for the worker and the shared code. The app is not linted yet; for it there is only the
// privacy rule below (also enforced by app/test/privacy.test.ts).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const privateData = {
  paths: [{ name: "@trip/shared/private", message: "Hotels and flights stay server-side; the app gets them from GET /api/trip-private." }],
  patterns: [{ regex: "(^|/)(private|trip-private(\\.json)?)$", message: "Hotels and flights stay server-side; the app gets them from GET /api/trip-private." }],
};

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.wrangler/**"] },
  {
    files: ["worker/**/*.ts", "shared/src/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // A promise nobody awaits fails silently, and a cron run can end before it settles.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    rules: { "no-restricted-imports": ["error", privateData] },
  },
);
