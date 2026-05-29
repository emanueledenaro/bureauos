import { defineConfig } from "vitest/config";

// Vitest owns the unit tests under src/. The Playwright end-to-end specs live
// in e2e/ and are run separately via the root playwright.config.ts, so they are
// excluded here to avoid Vitest loading Playwright's test.describe() runtime.
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
