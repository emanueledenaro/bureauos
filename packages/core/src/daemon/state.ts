import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { workspacePaths } from "../paths.js";

export type DaemonStatus = "running" | "stopped" | "stale" | "error";

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

  constructor(
    private readonly workspaceRoot: string,
    private readonly isProcessAlive: ProcessAliveCheck = defaultProcessAlive,
  ) {
    this.statusPath = workspacePaths(workspaceRoot).daemonStatus;
  }

  async read(): Promise<DaemonStateRecord | undefined> {
    try {
      return JSON.parse(await readFile(this.statusPath, "utf8")) as DaemonStateRecord;
    } catch {
      return undefined;
    }
  }

  async status(): Promise<DaemonStatusSnapshot> {
    const state = await this.read();
    if (!state) return { path: this.statusPath, alive: false, status: "stopped" };
    const alive = state.pid ? this.isProcessAlive(state.pid) : false;
    const status = state.status === "running" && !alive ? "stale" : state.status;
    return { path: this.statusPath, state, alive, status };
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
