// Flat config for ESLint 9.
// Keep the ruleset small for the bootstrap phase; the policy engine and
// memory invariants do the heavy correctness work elsewhere.

import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/out-main/**",
      "**/out-renderer/**",
      "**/.bureauos/**",
      "**/coverage/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": "off",
    },
  },
  prettier,
];
