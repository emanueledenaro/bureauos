import { access, readFile, rm, mkdtemp } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initWorkspace, InitError } from "./initializer.js";
import { workspacePaths } from "../paths.js";
import { loadConfig } from "../config/loader.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

describe("initWorkspace", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-init-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates the .bureauos tree with required files", async () => {
    const result = await initWorkspace({ root: dir, organizationName: "Test Co." });
    const paths = workspacePaths(dir);

    expect(result.workspaceDir).toBe(paths.workspaceDir);
    expect(await exists(paths.workspaceDir)).toBe(true);
    expect(await exists(paths.configFile)).toBe(true);
    expect(await exists(paths.rootMemory)).toBe(true);
    expect(await exists(paths.companyMemory)).toBe(true);
    expect(await exists(paths.policiesMemory)).toBe(true);
    expect(await exists(paths.auditLog)).toBe(true);
    expect(await exists(paths.dailyDir)).toBe(true);
    expect(await exists(paths.coordinatorDir)).toBe(true);
    expect(await exists(paths.clientsDir)).toBe(true);
    expect(await exists(paths.projectsDir)).toBe(true);
    expect(await exists(paths.runsDir)).toBe(true);
    expect(await exists(paths.artifactsDir)).toBe(true);
    expect(await exists(paths.approvalsPendingDir)).toBe(true);
  });

  it("embeds the organization name in ROOT.md", async () => {
    await initWorkspace({ root: dir, organizationName: "Test Co." });
    const paths = workspacePaths(dir);
    const root = await readFile(paths.rootMemory, "utf8");
    expect(root).toContain("Test Co.");
  });

  it("refuses to overwrite without force", async () => {
    await initWorkspace({ root: dir });
    await expect(initWorkspace({ root: dir })).rejects.toBeInstanceOf(InitError);
  });

  it("overwrites when force is true", async () => {
    await initWorkspace({ root: dir, organizationName: "Old" });
    const result = await initWorkspace({
      root: dir,
      organizationName: "New",
      force: true,
    });
    const paths = workspacePaths(dir);
    const root = await readFile(paths.rootMemory, "utf8");
    expect(root).toContain("New");
    expect(result.filesCreated.length).toBeGreaterThan(0);
  });

  it("writes a parseable config file with the chosen preset", async () => {
    const result = await initWorkspace({ root: dir, preset: "agency" });
    expect(result.config.setup.preset).toBe("agency");
    const yaml = await readFile(result.configFile, "utf8");
    expect(yaml).toContain('preset: "agency"');
    expect(yaml).toContain("level: 2");
    expect(yaml).toContain("semantic_index:");
    expect(yaml).toContain('provider: "none"');
    const parsed = await loadConfig(result.configFile);
    expect(parsed.provider).toEqual({});
    expect(parsed.disabled_providers).toEqual([]);
    expect(parsed.capabilities.codex?.actions.edit_code).toBe(true);
    expect(parsed.capabilities.github?.actions.merge_pr).toBe(false);
  });

  it("records an audit entry for the init action", async () => {
    await initWorkspace({ root: dir });
    const paths = workspacePaths(dir);
    const log = await readFile(paths.auditLog, "utf8");
    const entries = log
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("workspace.init");
    expect(entries[0].result).toBe("ok");
  });
});
