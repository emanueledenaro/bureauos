import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/loader.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { CoordinatorToolRuntime } from "./tool-runtime.js";

describe("CoordinatorToolRuntime", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-tool-runtime-"));
    await initWorkspace({ root: dir, organizationName: "Tool Runtime Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("executes create_intake through a typed tool path and records audit evidence", async () => {
    const runtime = new CoordinatorToolRuntime(dir, { config: defaultConfig("agency") });

    const execution = await runtime.executeCreateIntake({
      message: "Ho parlato con Pizzeria Aurora: vuole sito con prenotazioni.",
      clientName: "Pizzeria Aurora",
      source: "cli",
      toolSource: "cli",
    });

    expect(execution.tool).toEqual({
      name: "create_intake",
      source: "cli",
    });
    expect(execution.result.client.slug).toBe("pizzeria-aurora");

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("coordinator_tool.create_intake");
  });

  it("rejects non-create_intake plans before mutating the workspace", async () => {
    const runtime = new CoordinatorToolRuntime(dir, { config: defaultConfig("agency") });

    await expect(
      runtime.executeCreateIntake({
        message: "Salva Pizzeria Aurora come cliente.",
        source: "cli",
        toolSource: "cli",
        plan: {
          action: "save_client",
          clientName: "Pizzeria Aurora",
        },
      }),
    ).rejects.toThrow("requires a create_intake plan");

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).not.toContain("coordinator_tool.create_intake");
  });
});
