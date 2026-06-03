import { defineConfig } from "@playwright/test";

const PORT = Number(process.env["BUREAUOS_E2E_RENDERER_PORT"] ?? 4173);
// Default to 127.0.0.1 (IPv4 loopback). The API server always binds to
// 127.0.0.1 and its CORS check does not parse IPv6 bracket notation ([::1]),
// so a Vite renderer on ::1 produces cross-origin failures for the stream
// endpoint. IPv4 keeps the renderer and API on the same loopback class.
const HOST = process.env["BUREAUOS_E2E_RENDERER_HOST"] ?? "127.0.0.1";
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
  // Each spec file creates its own API server on an ephemeral port. Two workers
  // racing to create seeded workspaces + start the Vite webServer can exceed
  // the 45 s beforeAll timeout. Single worker avoids the race.
  workers: 1,
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
