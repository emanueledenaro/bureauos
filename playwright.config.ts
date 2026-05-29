import { defineConfig } from "@playwright/test";

const PORT = Number(process.env["BUREAUOS_E2E_RENDERER_PORT"] ?? 4173);
const HOST = process.env["BUREAUOS_E2E_RENDERER_HOST"] ?? "::1";
const rendererHost = HOST.includes(":") ? `[${HOST}]` : HOST;
const rendererUrl = `http://${rendererHost}:${PORT}`;
const visualQa = process.env["BUREAUOS_VISUAL_QA"] === "1";

export default defineConfig({
  testDir: "./packages/interface/e2e",
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 1 : 0,
  reporter: [["list"]],
  testIgnore: visualQa ? [] : ["**/visual-qa.spec.ts"],
  use: {
    baseURL: rendererUrl,
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm --dir packages/interface exec vite --host ${HOST} --port ${PORT} src/renderer`,
    url: rendererUrl,
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
