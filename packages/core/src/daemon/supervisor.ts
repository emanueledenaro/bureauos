import { spawn as nodeSpawn } from "node:child_process";
import { DaemonStateStore, type DaemonStatusSnapshot } from "./state.js";

export interface SpawnedDaemonProcess {
  pid?: number;
  unref(): void;
}

export type DaemonSpawn = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    detached: boolean;
    env: NodeJS.ProcessEnv;
    stdio: "ignore";
  },
) => SpawnedDaemonProcess;

export type DaemonKill = (pid: number, signal: NodeJS.Signals) => void;

export interface DaemonLifecycleSupervisorOptions {
  workspaceRoot: string;
  execPath?: string;
  scriptPath?: string;
  env?: NodeJS.ProcessEnv;
  state?: DaemonStateStore;
  spawn?: DaemonSpawn;
  kill?: DaemonKill;
}

export interface DaemonStartResult {
  ok: boolean;
  status: "started" | "already_running" | "failed";
  message: string;
  pid?: number;
  snapshot: DaemonStatusSnapshot;
}

export interface DaemonStopResult {
  ok: boolean;
  status: "stopped" | "not_running" | "failed";
  message: string;
  pid?: number;
  snapshot: DaemonStatusSnapshot;
}

export class DaemonLifecycleSupervisor {
  private readonly state: DaemonStateStore;
  private readonly spawnDaemon: DaemonSpawn;
  private readonly killProcess: DaemonKill;

  constructor(private readonly options: DaemonLifecycleSupervisorOptions) {
    this.state = options.state ?? new DaemonStateStore(options.workspaceRoot);
    this.spawnDaemon =
      options.spawn ?? ((command, args, spawnOptions) => nodeSpawn(command, args, spawnOptions));
    this.killProcess = options.kill ?? ((pid, signal) => process.kill(pid, signal));
  }

  status(): Promise<DaemonStatusSnapshot> {
    return this.state.status();
  }

  async start(input: { port?: number } = {}): Promise<DaemonStartResult> {
    const current = await this.state.status();
    if ((current.status === "running" || current.status === "starting") && current.alive) {
      return {
        ok: false,
        status: "already_running",
        message: `daemon already ${current.status} with pid ${current.state?.pid ?? "unknown"}`,
        ...(current.state?.pid ? { pid: current.state.pid } : {}),
        snapshot: current,
      };
    }
    if (current.status === "stale") {
      await this.state.recordDiagnostic({
        type: "stale_status_recovered",
        ...(current.state?.pid ? { stale_pid: current.state.pid } : {}),
        message: "starting daemon after stale status",
      });
    }

    const lock = await this.state.lockStatus();
    if (lock.state && lock.alive) {
      return {
        ok: false,
        status: "already_running",
        message: `daemon lock is held by pid ${lock.state.pid}`,
        pid: lock.state.pid,
        snapshot: current,
      };
    }

    const script = this.options.scriptPath;
    if (!script) {
      const message = "cannot locate bureau executable";
      await this.state.markError(message);
      return { ok: false, status: "failed", message, snapshot: await this.state.status() };
    }

    const childArgs = [script, "daemon", "run"];
    if (typeof input.port === "number") childArgs.push("--port", String(input.port));

    let child: SpawnedDaemonProcess;
    try {
      child = this.spawnDaemon(this.options.execPath ?? process.execPath, childArgs, {
        cwd: this.options.workspaceRoot,
        detached: true,
        env: this.options.env ?? process.env,
        stdio: "ignore",
      });
      child.unref();
    } catch (error) {
      const message = `failed to spawn background process: ${(error as Error).message}`;
      await this.state.markError(message);
      return { ok: false, status: "failed", message, snapshot: await this.state.status() };
    }

    if (!child.pid) {
      const message = "failed to spawn background process: missing child pid";
      await this.state.markError(message);
      return { ok: false, status: "failed", message, snapshot: await this.state.status() };
    }

    const acquired = await this.state.acquireLock({
      pid: child.pid,
      message: "background daemon start",
    });
    if (!acquired.acquired) {
      try {
        this.killProcess(child.pid, "SIGTERM");
      } catch {
        // Best-effort cleanup; the lock holder remains the authoritative state.
      }
      const message = acquired.state
        ? `daemon lock is held by pid ${acquired.state.pid}`
        : "daemon lock could not be acquired";
      await this.state.markError(message);
      return {
        ok: false,
        status: "already_running",
        message,
        ...(acquired.state?.pid ? { pid: acquired.state.pid } : {}),
        snapshot: await this.state.status(),
      };
    }

    const port = typeof input.port === "number" ? input.port : 0;
    await this.state.markStarting({
      pid: child.pid,
      apiUrl: port > 0 ? `http://127.0.0.1:${port}` : "starting",
      port,
    });

    return {
      ok: true,
      status: "started",
      message: `daemon started pid ${child.pid}`,
      pid: child.pid,
      snapshot: await this.state.status(),
    };
  }

  async stop(): Promise<DaemonStopResult> {
    const snapshot = await this.state.status();
    const lock = await this.state.lockStatus();
    // Signal the pid that is actually alive. The status file and the lock can
    // disagree after a crash or partial state update; signalling the status
    // pid unconditionally would target a dead (possibly recycled) pid, leave
    // the live daemon — held under the lock pid — running, and leak its lock,
    // while still reporting "stopped" (SER-227). `releaseLock(pid)` only
    // deletes the lock when its holder pid matches, so we must release the live
    // pid, not the stale one.
    const livePid =
      snapshot.state?.pid && snapshot.alive
        ? snapshot.state.pid
        : lock.state?.pid && lock.alive
          ? lock.state.pid
          : undefined;

    if (!livePid) {
      // Nothing alive: clear any stale lock by its holder pid and settle state.
      await this.state.releaseLock(lock.state?.pid ?? snapshot.state?.pid);
      await this.state.markStopped("not running");
      return {
        ok: true,
        status: "not_running",
        message: "daemon is not running",
        snapshot: await this.state.status(),
      };
    }

    try {
      this.killProcess(livePid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        const message = `failed to stop daemon pid ${livePid}: ${(error as Error).message}`;
        await this.state.markError(message);
        return {
          ok: false,
          status: "failed",
          message,
          pid: livePid,
          snapshot: await this.state.status(),
        };
      }
    }

    await this.state.releaseLock(livePid);
    await this.state.markStopped("owner requested stop");
    return {
      ok: true,
      status: "stopped",
      message: `stop signal sent to pid ${livePid}`,
      pid: livePid,
      snapshot: await this.state.status(),
    };
  }
}
