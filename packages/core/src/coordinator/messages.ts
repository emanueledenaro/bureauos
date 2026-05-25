import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { newId } from "../ids.js";
import { workspacePaths } from "../paths.js";
import type { CoordinatorIntakeResult } from "./intake.js";

export interface CoordinatorMessageAttachment {
  name: string;
  type: string;
  size: number;
}

export interface CoordinatorMessageRecord {
  id: string;
  role: "owner" | "coordinator";
  text: string;
  created: string;
  attachments?: CoordinatorMessageAttachment[];
  result?: CoordinatorIntakeResult;
}

export interface CoordinatorMessageInput {
  role: CoordinatorMessageRecord["role"];
  text: string;
  created?: string;
  attachments?: CoordinatorMessageAttachment[];
  result?: CoordinatorIntakeResult;
}

function parseLine(line: string): CoordinatorMessageRecord | undefined {
  try {
    const value = JSON.parse(line) as Partial<CoordinatorMessageRecord>;
    if (!value.id || !value.role || !value.text || !value.created) return undefined;
    if (value.role !== "owner" && value.role !== "coordinator") return undefined;
    return value as CoordinatorMessageRecord;
  } catch {
    return undefined;
  }
}

export class CoordinatorMessageStore {
  constructor(private readonly workspaceRoot: string) {}

  private path(): string {
    return workspacePaths(this.workspaceRoot).coordinatorMessages;
  }

  async append(input: CoordinatorMessageInput): Promise<CoordinatorMessageRecord> {
    const record: CoordinatorMessageRecord = {
      id: newId("msg"),
      role: input.role,
      text: input.text.trim(),
      created: input.created ?? new Date().toISOString(),
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      ...(input.result ? { result: input.result } : {}),
    };
    await mkdir(dirname(this.path()), { recursive: true });
    await appendFile(this.path(), `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }

  async appendMany(
    inputs: readonly CoordinatorMessageInput[],
  ): Promise<CoordinatorMessageRecord[]> {
    const records = inputs.map((input) => ({
      id: newId("msg"),
      role: input.role,
      text: input.text.trim(),
      created: input.created ?? new Date().toISOString(),
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      ...(input.result ? { result: input.result } : {}),
    }));
    await mkdir(dirname(this.path()), { recursive: true });
    await appendFile(
      this.path(),
      records.map((record) => JSON.stringify(record)).join("\n") + "\n",
      "utf8",
    );
    return records;
  }

  async list(limit = 50): Promise<CoordinatorMessageRecord[]> {
    try {
      const raw = await readFile(this.path(), "utf8");
      const messages = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map(parseLine)
        .filter((record): record is CoordinatorMessageRecord => record !== undefined);
      return messages.slice(-limit);
    } catch {
      return [];
    }
  }
}
