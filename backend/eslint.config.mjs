// ESLint 9 flat config. Kept deliberately lightweight (no type-aware
// linting) so it stays fast in CI and doesn't require every one-off
// maintenance script under src/db/ to be added to a tsconfig "project"
// array — type correctness is already enforced separately by `tsc
// --noEmit` in CI.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "drizzle/**", "node_modules/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // One-off db/ scripts and route handlers legitimately use `any` at
      // a few JSON/contract-decoding boundaries — warn, don't block CI.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
