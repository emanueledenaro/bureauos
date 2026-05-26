import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { workspacePaths } from "../paths.js";

export type DaemonStatus = "starting" | "running" | "stopped" | "stale" | "error";

export interface DaemonStateRecord {
  status: DaemonStatus;
  workspace_root: string;
  pid?: number;
  api_url?: string;
  port?: number;
  scheduler_active: boolean;
  started_at?: string;
  stopped_at?: string;
  updated_at: string;
  message?: string;
}

export interface DaemonStatusSnapshot {
  path: string;
  state?: DaemonStateRecord;
  alive: boolean;
  status: DaemonStatus;
}

export interface DaemonLockRecord {
  workspace_root: string;
  pid: number;
  created_at: string;
  updated_at: string;
  message?: string;
}

export interface DaemonLockSnapshot {
  path: string;
  state?: DaemonLockRecord;
  alive: boolean;
  stale: boolean;
}

export interface DaemonLockAcquisition {
  acquired: boolean;
  path: string;
  state?: DaemonLockRecord;
  alive: boolean;
  stale: boolean;
}

export type ProcessAliveCheck = (pid: number) => boolean;

function defaultProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export class DaemonStateStore {
  private readonly statusPath: string;
  private readonly lockPath: string;

  constructor(
    private readonly workspaceRoot: string,
    private readonly isProcessAlive: ProcessAliveCheck = defaultProcessAlive,
  ) {
    const paths = workspacePaths(workspaceRoot);
    this.statusPath = paths.daemonStatus;
    this.lockPath = paths.daemonLock;
  }

  async read(): Promise<DaemonStateRecord | undefined> {
    try {
      return JSON.parse(await readFile(this.statusPath, "utf8")) as DaemonStateRecord;
    } catch {
      return undefined;
    }
  }

  async readLock(): Promise<DaemonLockRecord | undefined> {
    try {
      return JSON.parse(await readFile(this.lockPath, "utf8")) as DaemonLockRecord;
    } catch {
      return undefined;
    }
  }

  async status(): Promise<DaemonStatusSnapshot> {
    const state = await this.read();
    if (!state) return { path: this.statusPath, alive: false, status: "stopped" };
    const processAlive = state.pid ? this.isProcessAlive(state.pid) : false;
    const active = state.status === "running" || state.status === "starting";
    const alive = active && processAlive;
    const status = active && !processAlive ? "stale" : state.status;
    return { path: this.statusPath, state, alive, status };
  }

  async lockStatus(): Promise<DaemonLockSnapshot> {
    const state = await this.readLock();
    if (!state) return { path: this.lockPath, alive: false, stale: false };
    const alive = this.isProcessAlive(state.pid);
    return { path: this.lockPath, state, alive, stale: !alive };
  }

  async acquireLock(input: { pid: number; message?: string }): Promise<DaemonLockAcquisition> {
    const existing = await this.lockStatus();
    if (existing.state && existing.alive && existing.state.pid !== input.pid) {
      return { acquired: false, ...existing };
    }
    if (existing.state && existing.stale) {
      await rm(this.lockPath, { force: true });
    }

    const now = new Date().toISOString();
    const record: DaemonLockRecord = {
      workspace_root: workspacePaths(this.workspaceRoot).root,
      pid: input.pid,
      created_at: existing.state?.pid === input.pid ? existing.state.created_at : now,
      updated_at: now,
      ...(input.message
        ? { message: input.message }
        : existing.state?.message
          ? { message: existing.state.message }
          : {}),
    };

    try {
      await mkdir(dirname(this.lockPath), { recursive: true });
      await writeFile(this.lockPath, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: "utf8",
        flag: existing.state?.pid === input.pid ? "w" : "wx",
      });
      return {
        acquired: true,
        path: this.lockPath,
        state: record,
        alive: this.isProcessAlive(input.pid),
        stale: false,
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      const current = await this.lockStatus();
      return { acquired: false, ...current };
    }
  }

  async releaseLock(pid?: number): Promise<boolean> {
    const current = await this.lockStatus();
    if (!current.state) return false;
    if (pid !== undefined && current.state.pid !== pid) return false;
    await rm(this.lockPath, { force: true });
    return true;
  }

  async markStarting(input: { pid: number; apiUrl: string; port: number }): Promise<void> {
    const now = new Date().toISOString();
    await writeJson(this.statusPath, {
      status: "starting",
      workspace_root: workspacePaths(this.workspaceRoot).root,
      pid: input.pid,
      api_url: input.apiUrl,
      port: input.port,
      scheduler_active: false,
      started_at: now,
      updated_at: now,
      message: "daemon process spawned; waiting for API server",
    } satisfies DaemonStateRecord);
  }

  async markRunning(input: { pid: number; apiUrl: string; port: number }): Promise<void> {
    const now = new Date().toISOString();
    await writeJson(this.statusPath, {
      status: "running",
      workspace_root: workspacePaths(this.workspaceRoot).root,
      pid: input.pid,
      api_url: input.apiUrl,
      port: input.port,
      scheduler_active: true,
      started_at: now,
      updated_at: now,
    } satisfies DaemonStateRecord);
  }

  async markStopped(message = "stopped"): Promise<void> {
    const previous = await this.read();
    const now = new Date().toISOString();
    await writeJson(this.statusPath, {
      status: "stopped",
      workspace_root: workspacePaths(this.workspaceRoot).root,
      ...(previous?.pid ? { pid: previous.pid } : {}),
      ...(previous?.api_url ? { api_url: previous.api_url } : {}),
      ...(previous?.port ? { port: previous.port } : {}),
      scheduler_active: false,
      ...(previous?.started_at ? { started_at: previous.started_at } : {}),
      stopped_at: now,
      updated_at: now,
      message,
    } satisfies DaemonStateRecord);
  }

  async markError(message: string): Promise<void> {
    const previous = await this.read();
    const now = new Date().toISOString();
    await writeJson(this.statusPath, {
      status: "error",
      workspace_root: workspacePaths(this.workspaceRoot).root,
      ...(previous?.pid ? { pid: previous.pid } : {}),
      ...(previous?.api_url ? { api_url: previous.api_url } : {}),
      ...(previous?.port ? { port: previous.port } : {}),
      scheduler_active: false,
      ...(previous?.started_at ? { started_at: previous.started_at } : {}),
      updated_at: now,
      message,
    } satisfies DaemonStateRecord);
  }
}
