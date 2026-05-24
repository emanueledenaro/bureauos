import { mkdtemp, rm, access, readFile } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "./main.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

describe("bureau cli", () => {
  let dir: string;
  let prevCwd: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-cli-"));
    prevCwd = process.cwd();
    process.chdir(dir);
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    await rm(dir, { recursive: true, force: true });
  });

  it("prints help with no command", async () => {
    const code = await main(["node", "bureau"]);
    expect(code).toBe(0);
  });

  it("initializes a workspace", async () => {
    const code = await main(["node", "bureau", "init", "--name", "Acme"]);
    expect(code).toBe(0);
    expect(await exists(join(dir, ".bureauos"))).toBe(true);
    expect(await exists(join(dir, ".bureauos", "bureauos.yaml"))).toBe(true);
    const yaml = await readFile(join(dir, ".bureauos", "bureauos.yaml"), "utf8");
    expect(yaml).toContain("Acme");
  });

  it("refuses to overwrite without --force", async () => {
    await main(["node", "bureau", "init"]);
    const code = await main(["node", "bureau", "init"]);
    expect(code).toBe(1);
  });

  it("overwrites with --force", async () => {
    await main(["node", "bureau", "init"]);
    const code = await main(["node", "bureau", "init", "--force"]);
    expect(code).toBe(0);
  });

  it("rejects unknown preset", async () => {
    const code = await main(["node", "bureau", "init", "--preset", "huge-corp"]);
    expect(code).toBe(1);
  });

  it("rejects unknown command", async () => {
    const code = await main(["node", "bureau", "frobnicate"]);
    expect(code).toBe(1);
  });
});
