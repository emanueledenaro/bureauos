import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { DaemonSchedulerStateStore, DaemonStateStore } from "./state.js";

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
      heartbeat: {
        process_id: 1234,
        scheduler_active: true,
        scheduler_status: "active",
      },
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
    expect(status.heartbeat).toMatchObject({
      process_id: 1234,
      scheduler_active: false,
      scheduler_status: "stale",
    });
  });

  it("prevents duplicate active locks and cleans up stale locks", async () => {
    const store = new DaemonStateStore(dir, (pid) => pid === 1234);

    const first = await store.acquireLock({ pid: 1234, message: "active daemon" });
    const duplicate = await store.acquireLock({ pid: 5678, message: "second daemon" });

    expect(first).toMatchObject({ acquired: true, alive: true, state: { pid: 1234 } });
    expect(duplicate).toMatchObject({ acquired: false, alive: true, state: { pid: 1234 } });

    const staleAwareStore = new DaemonStateStore(dir, (pid) => pid === 5678);
    const recovered = await staleAwareStore.acquireLock({ pid: 5678, message: "new daemon" });

    expect(recovered).toMatchObject({ acquired: true, alive: true, state: { pid: 5678 } });
    const diagnostic = await readFile(workspacePaths(dir).daemonLog, "utf8");
    expect(diagnostic).toContain("stale_lock_recovered");
    expect(diagnostic).toContain('"stale_pid":1234');
    expect(diagnostic).toContain('"replacement_pid":5678');
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

  it("persists scheduler cursors as workspace-local JSON", async () => {
    const store = new DaemonSchedulerStateStore(dir);
    const now = new Date("2026-05-26T10:00:00.000Z");

    await store.markStarted("daily_executive_report", now);
    await store.markSucceeded({
      trigger: "daily_executive_report",
      now,
      everyMs: 24 * 60 * 60 * 1000,
      runId: "run_daily",
    });

    const cursor = await store.cursor("daily_executive_report");
    expect(cursor).toMatchObject({
      trigger: "daily_executive_report",
      last_started_at: now.toISOString(),
      last_success_at: now.toISOString(),
      last_run_id: "run_daily",
      next_due_at: "2026-05-27T10:00:00.000Z",
      failure_count: 0,
    });

    const raw = await readFile(workspacePaths(dir).daemonSchedulerState, "utf8");
    const parsed = JSON.parse(raw) as { cursors: Record<string, unknown> };
    expect(parsed.cursors).toHaveProperty("daily_executive_report");
  });

  it("includes latest scheduler run and error in the daemon heartbeat", async () => {
    const state = new DaemonStateStore(dir, (pid) => pid === 1234);
    const scheduler = new DaemonSchedulerStateStore(dir);
    await state.markRunning({
      pid: 1234,
      apiUrl: "http://127.0.0.1:3737",
      port: 3737,
    });
    await scheduler.markSucceeded({
      trigger: "project_health_check",
      now: new Date("2026-05-26T10:00:00.000Z"),
      everyMs: 60 * 60 * 1000,
      runId: "run_health",
    });
    await scheduler.markFailed({
      trigger: "memory_trigger_scan",
      now: new Date("2026-05-26T10:05:00.000Z"),
      error: "provider unavailable",
    });

    await expect(state.status()).resolves.toMatchObject({
      heartbeat: {
        scheduler_status: "active",
        last_run: {
          trigger: "project_health_check",
          run_id: "run_health",
          at: "2026-05-26T10:00:00.000Z",
        },
        last_error: {
          trigger: "memory_trigger_scan",
          error: "provider unavailable",
          at: "2026-05-26T10:05:00.000Z",
          failure_count: 1,
        },
      },
    });
  });
});
