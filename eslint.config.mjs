import next from "eslint-config-next";

/**
 * `eslint-config-next` v16 ships a native flat config array, so it is consumed
 * directly rather than through `FlatCompat` (which would need `@eslint/eslintrc`
 * pulled in just to re-wrap an already-flat config).
 */
export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "pnpm-lock.yaml",
      "livekit-server/**",
    ],
  },
  ...next,
  {
    // Scoped to TS files: the plugin only exists inside the `next/typescript`
    // block, so applying the rule to `.mjs` would fail config resolution.
    files: ["**/*.{ts,tsx}"],
    rules: {
      // The codebase uses `_`-prefixed bindings for deliberately unused values
      // (fields kept for documentation, error vars in catch blocks), so the
      // default unused-var config would flag the intent rather than a bug.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
];