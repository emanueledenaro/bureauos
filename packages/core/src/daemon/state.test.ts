import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { DaemonStateStore } from "./state.js";

describe("DaemonStateStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-daemon-state-"));
    await initWorkspace({ root: dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("marks the daemon as running and exposes liveness", async () => {
    const store = new DaemonStateStore(dir, (pid) => pid === 1234);

    await store.markRunning({
      pid: 1234,
      apiUrl: "http://127.0.0.1:3737",
      port: 3737,
    });

    const status = await store.status();
    expect(status).toMatchObject({
      alive: true,
      status: "running",
      state: {
        pid: 1234,
        api_url: "http://127.0.0.1:3737",
        scheduler_active: true,
      },
    });
  });

  it("reports stale when the recorded process is gone", async () => {
    const store = new DaemonStateStore(dir, () => false);
    await store.markRunning({
      pid: 1234,
      apiUrl: "http://127.0.0.1:3737",
      port: 3737,
    });

    const status = await store.status();

    expect(status.alive).toBe(false);
    expect(status.status).toBe("stale");
  });

  it("preserves the status file as workspace-local JSON", async () => {
    const store = new DaemonStateStore(dir, () => true);

    await store.markRunning({
      pid: 1234,
      apiUrl: "http://127.0.0.1:3737",
      port: 3737,
    });
    await store.markStopped("owner requested stop");

    const raw = await readFile(workspacePaths(dir).daemonStatus, "utf8");
    const parsed = JSON.parse(raw) as { status: string; message: string; workspace_root: string };
    expect(parsed).toMatchObject({
      status: "stopped",
      message: "owner requested stop",
      workspace_root: dir,
    });
  });
});
