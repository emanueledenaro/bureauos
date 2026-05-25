import { mkdtemp, rm, access, readFile, readdir, writeFile } from "node:fs/promises";
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

    const artifactsDir = join(dir, ".bureauos", "memory", "artifacts");
    const artifacts = await readdir(artifactsDir);
    const bodies = await Promise.all(
      artifacts.map((artifact) => readFile(join(artifactsDir, artifact), "utf8")),
    );
    expect(bodies.some((body) => body.includes("Cross-Project Executive Report"))).toBe(true);
  });

  it("reports daemon status from workspace state", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);

    const code = await main(["node", "bureau", "daemon", "status"]);

    expect(code).toBe(0);
  });

  it("marks a stale daemon as stopped from CLI", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);
    const statusPath = join(dir, ".bureauos", "daemon", "status.json");
    await writeFile(
      statusPath,
      JSON.stringify(
        {
          status: "running",
          workspace_root: dir,
          pid: 999999,
          api_url: "http://127.0.0.1:3737",
          port: 3737,
          scheduler_active: true,
          started_at: "2026-05-25T10:00:00.000Z",
          updated_at: "2026-05-25T10:00:00.000Z",
        },
        null,
        2,
      ),
      "utf8",
    );

    const code = await main(["node", "bureau", "daemon", "stop"]);

    expect(code).toBe(0);
    const state = JSON.parse(await readFile(statusPath, "utf8")) as {
      status: string;
      scheduler_active: boolean;
      message: string;
    };
    expect(state).toMatchObject({
      status: "stopped",
      scheduler_active: false,
      message: "not running",
    });
  });

  it("prints client intelligence from real registries", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);
    await main([
      "node",
      "bureau",
      "intake",
      "--client",
      "Pizzeria Aurora",
      "--message",
      "Ho parlato con una pizzeria: vuole sito con prenotazioni.",
      "--value",
      "4500",
      "--margin",
      "40",
    ]);

    const code = await main(["node", "bureau", "client", "intelligence"]);

    expect(code).toBe(0);
  });

  it("reads and updates growth memory from CLI", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);

    expect(await main(["node", "bureau", "growth", "memory"])).toBe(0);
    const code = await main([
      "node",
      "bureau",
      "growth",
      "memory",
      "set",
      "--brand",
      "BureauOS is the AI operating system for owner-led software companies.",
      "--offers",
      "AAAS setup and autonomous delivery operations.",
      "--channels",
      "GitHub, X, LinkedIn.",
    ]);

    expect(code).toBe(0);
    const brand = await readFile(join(dir, ".bureauos", "memory", "BRAND.md"), "utf8");
    expect(brand).toContain("status: configured");
    expect(brand).toContain("owner-led software companies");

    const audit = await readFile(join(dir, ".bureauos", "audit", "audit.log"), "utf8");
    expect(audit).toContain("growth.memory.updated");
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

  it("dispatches project-scoped agent handoffs from CLI", async () => {
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
      "project",
      "dispatch",
      "--project",
      "pizzeria-aurora-booking-website",
      "--type",
      "feature",
      "--scope",
      "Prepare dev-ready work",
    ]);

    expect(code).toBe(0);
    const ownership = await readFile(
      join(
        dir,
        ".bureauos",
        "memory",
        "projects",
        "pizzeria-aurora-booking-website",
        "OWNERSHIP.md",
      ),
      "utf8",
    );
    expect(ownership).toContain("manager_agent_id: project_manager");
    const audit = await readFile(join(dir, ".bureauos", "audit", "audit.log"), "utf8");
    expect(audit).toContain("project.dispatch.completed");
    const runs = await readFile(
      join(dir, ".bureauos", "memory", "projects", "pizzeria-aurora-booking-website", "RUNS.md"),
      "utf8",
    );
    expect(runs).toContain("Project Manager: project_manager");
    expect(runs).toContain("Pipeline: product, ux, development, qa, security, reviewer");
  });

  it("stores provider auth locally and uses it when listing providers", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);
    const code = await main([
      "node",
      "bureau",
      "auth",
      "login",
      "--provider",
      "openai",
      "--api-key",
      "sk-test-provider-auth",
      "--model",
      "gpt-5",
    ]);

    expect(code).toBe(0);
    const authFile = join(dir, ".bureauos", "auth", "providers.json");
    const stored = await readFile(authFile, "utf8");
    expect(stored).toContain("openai-default");
    expect(stored).toContain("sk-test-provider-auth");

    expect(await main(["node", "bureau", "auth", "list"])).toBe(0);
    expect(await main(["node", "bureau", "providers", "list"])).toBe(0);

    const audit = await readFile(join(dir, ".bureauos", "audit", "audit.log"), "utf8");
    expect(audit).toContain("provider.auth.login");
    expect(audit).not.toContain("sk-test-provider-auth");

    expect(await main(["node", "bureau", "auth", "logout", "--provider", "openai"])).toBe(0);
    expect(await exists(authFile)).toBe(false);
  });

  it("lists capability boundaries from the workspace config", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);

    const code = await main(["node", "bureau", "capabilities", "list"]);

    expect(code).toBe(0);
    const yaml = await readFile(join(dir, ".bureauos", "bureauos.yaml"), "utf8");
    expect(yaml).toContain("capabilities:");
    expect(yaml).toContain("codex:");
    expect(yaml).toContain("edit_code: true");
  });

  it("keeps OpenAI Codex OAuth separate from OpenAI API auth", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);
    const oauthCode = await main([
      "node",
      "bureau",
      "auth",
      "login",
      "--provider",
      "openai-codex",
      "--access-token",
      "oauth-access-token-cli",
      "--refresh-token",
      "oauth-refresh-token-cli",
      "--model",
      "gpt-5",
    ]);
    const apiCode = await main([
      "node",
      "bureau",
      "auth",
      "login",
      "--provider",
      "openai",
      "--api-key",
      "sk-test-provider-auth",
      "--model",
      "gpt-5",
    ]);

    expect(oauthCode).toBe(0);
    expect(apiCode).toBe(0);
    const stored = await readFile(join(dir, ".bureauos", "auth", "providers.json"), "utf8");
    expect(stored).toContain('"provider": "openai-codex"');
    expect(stored).toContain('"mode": "oauth"');
    expect(stored).toContain('"provider": "openai"');
    expect(stored).toContain('"mode": "api-key"');

    const invalid = await main([
      "node",
      "bureau",
      "auth",
      "login",
      "--provider",
      "openai",
      "--mode",
      "oauth",
      "--access-token",
      "wrong-route",
    ]);
    expect(invalid).toBe(1);
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
