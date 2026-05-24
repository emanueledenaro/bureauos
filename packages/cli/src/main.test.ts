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

  it("runs supreme coordinator intake from a raw owner message", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);
    const code = await main([
      "node",
      "bureau",
      "intake",
      "--client",
      "Pizzeria Aurora",
      "--message",
      "Ho parlato con una pizzeria: vuole sito con prenotazioni, logo, posizione e contenuti.",
      "--value",
      "4500",
    ]);

    expect(code).toBe(0);
    expect(
      await exists(join(dir, ".bureauos", "memory", "clients", "pizzeria-aurora", "CLIENT.md")),
    ).toBe(true);
    expect(
      await exists(
        join(
          dir,
          ".bureauos",
          "memory",
          "projects",
          "pizzeria-aurora-booking-website",
          "PROJECT.md",
        ),
      ),
    ).toBe(true);

    const audit = await readFile(join(dir, ".bureauos", "audit", "audit.log"), "utf8");
    expect(audit).toContain("coordinator.intake.completed");
  });

  it("generates business reports from CLI", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);
    await main([
      "node",
      "bureau",
      "intake",
      "--client",
      "Pizzeria Aurora",
      "--message",
      "Ho parlato con una pizzeria: vuole sito con prenotazioni.",
    ]);

    const code = await main(["node", "bureau", "report", "generate"]);
    expect(code).toBe(0);

    const audit = await readFile(join(dir, ".bureauos", "audit", "audit.log"), "utf8");
    expect(audit).toContain("report.business.generated");
  });

  it("generates GitHub issue drafts from CLI", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);
    await main([
      "node",
      "bureau",
      "intake",
      "--client",
      "Pizzeria Aurora",
      "--message",
      "Ho parlato con una pizzeria: vuole sito con prenotazioni.",
    ]);

    const code = await main([
      "node",
      "bureau",
      "github",
      "draft-issues",
      "--project",
      "pizzeria-aurora-booking-website",
    ]);

    expect(code).toBe(0);

    const artifactsDir = join(dir, ".bureauos", "memory", "artifacts");
    const audit = await readFile(join(dir, ".bureauos", "audit", "audit.log"), "utf8");
    expect(audit).toContain("github.issue_drafts.generated");
    expect(await exists(artifactsDir)).toBe(true);
  });

  it("requires a token before creating real GitHub issues from CLI", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);
    const previousToken = process.env["GITHUB_TOKEN"];
    delete process.env["GITHUB_TOKEN"];

    try {
      const code = await main([
        "node",
        "bureau",
        "github",
        "create-issues",
        "--project",
        "pizzeria-aurora-booking-website",
        "--owner",
        "emanueledenaro",
        "--repo",
        "pizzeria-aurora",
      ]);

      expect(code).toBe(1);
    } finally {
      if (previousToken) process.env["GITHUB_TOKEN"] = previousToken;
    }
  });
});
