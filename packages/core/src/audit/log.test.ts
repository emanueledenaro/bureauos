import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "./log.js";

describe("AuditLog", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-audit-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends an event with a timestamp", async () => {
    const log = new AuditLog(join(dir, "audit.log"));
    const event = await log.append({
      actor: "test",
      action: "noop",
      result: "ok",
    });
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const content = await readFile(log.path, "utf8");
    expect(content.trim().split("\n")).toHaveLength(1);
    const parsed = JSON.parse(content.trim());
    expect(parsed.actor).toBe("test");
    expect(parsed.action).toBe("noop");
    expect(parsed.result).toBe("ok");
  });

  it("appends multiple events as JSONL", async () => {
    const log = new AuditLog(join(dir, "audit.log"));
    await log.append({ actor: "a", action: "x", result: "ok" });
    await log.append({ actor: "b", action: "y", result: "ok" });
    const content = await readFile(log.path, "utf8");
    expect(content.trim().split("\n")).toHaveLength(2);
  });
});
