import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { DaemonStateStore } from "./state.js";
import { DaemonLifecycleSupervisor, type DaemonSpawn } from "./supervisor.js";

describe("DaemonLifecycleSupervisor", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-daemon-supervisor-"));
    await initWorkspace({ root: dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("starts a background daemon with a starting status and lock", async () => {
    const spawn = vi.fn<DaemonSpawn>(() => ({ pid: 4321, unref: vi.fn() }));
    const state = new DaemonStateStore(dir, (pid) => pid === 4321);
    const supervisor = new DaemonLifecycleSupervisor({
      workspaceRoot: dir,
      scriptPath: "/tmp/bureau.js",
      state,
      spawn,
    });

    const result = await supervisor.start({ port: 3838 });

    expect(result).toMatchObject({
      ok: true,
      status: "started",
      pid: 4321,
    });
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      ["/tmp/bureau.js", "daemon", "run", "--port", "3838"],
      expect.objectContaining({ cwd: dir, detached: true, stdio: "ignore" }),
    );
    await expect(state.status()).resolves.toMatchObject({
      status: "starting",
      alive: true,
      state: { pid: 4321, scheduler_active: false },
    });
    await expect(state.lockStatus()).resolves.toMatchObject({
      alive: true,
      state: { pid: 4321 },
    });
  });

  it("prevents duplicate daemon starts with an active lock", async () => {
    const state = new DaemonStateStore(dir, (pid) => pid === 1111);
    await state.acquireLock({ pid: 1111, message: "existing daemon" });
    const spawn = vi.fn<DaemonSpawn>(() => ({ pid: 2222, unref: vi.fn() }));
    const supervisor = new DaemonLifecycleSupervisor({
      workspaceRoot: dir,
      scriptPath: "/tmp/bureau.js",
      state,
      spawn,
    });

    const result = await supervisor.start();

    expect(result).toMatchObject({
      ok: false,
      status: "already_running",
      pid: 1111,
    });
    expect(result.message).toContain("lock");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("records a restart diagnostic event when starting after stale status", async () => {
    const state = new DaemonStateStore(dir, (pid) => pid === 2222);
    await state.markRunning({
      pid: 1111,
      apiUrl: "http://127.0.0.1:1111",
      port: 1111,
    });
    const spawn = vi.fn<DaemonSpawn>(() => ({ pid: 2222, unref: vi.fn() }));
    const supervisor = new DaemonLifecycleSupervisor({
      workspaceRoot: dir,
      scriptPath: "/tmp/bureau.js",
      state,
      spawn,
    });

    const result = await supervisor.start();

    expect(result).toMatchObject({ ok: true, status: "started", pid: 2222 });
    const diagnostic = await readFile(workspacePaths(dir).daemonLog, "utf8");
    expect(diagnostic).toContain("stale_status_recovered");
    expect(diagnostic).toContain('"stale_pid":1111');
  });

  it("stops the locked daemon process and records stopped state", async () => {
    const state = new DaemonStateStore(dir, (pid) => pid === 4444);
    await state.acquireLock({ pid: 4444, message: "running daemon" });
    await state.markRunning({
      pid: 4444,
      apiUrl: "http://127.0.0.1:4444",
      port: 4444,
    });
    const killed: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    const supervisor = new DaemonLifecycleSupervisor({
      workspaceRoot: dir,
      state,
      kill: (pid, signal) => killed.push({ pid, signal }),
    });

    const result = await supervisor.stop();

    expect(result).toMatchObject({
      ok: true,
      status: "stopped",
      pid: 4444,
    });
    expect(killed).toEqual([{ pid: 4444, signal: "SIGTERM" }]);
    expect((await state.lockStatus()).state).toBeUndefined();
    await expect(state.status()).resolves.toMatchObject({
      status: "stopped",
      alive: false,
      state: { scheduler_active: false, message: "owner requested stop" },
    });
  });

  it("records actionable diagnostics when startup cannot spawn a process", async () => {
    const state = new DaemonStateStore(dir, () => false);
    const supervisor = new DaemonLifecycleSupervisor({
      workspaceRoot: dir,
      scriptPath: "/tmp/bureau.js",
      state,
      spawn: () => ({ unref: vi.fn() }),
    });

    const result = await supervisor.start();

    expect(result).toMatchObject({
      ok: false,
      status: "failed",
    });
    expect(result.message).toContain("missing child pid");
    await expect(state.status()).resolves.toMatchObject({
      status: "error",
      state: { scheduler_active: false },
    });
  });
});
