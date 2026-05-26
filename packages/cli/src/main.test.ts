import { mkdtemp, rm, access, readFile, readdir, writeFile } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DaemonStateStore } from "@bureauos/core";
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

  it("refuses to start a duplicate daemon when an active lock exists", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);
    const state = new DaemonStateStore(dir);
    await state.acquireLock({ pid: process.pid, message: "test daemon" });

    const code = await main(["node", "bureau", "daemon", "start"]);

    expect(code).toBe(1);
    await expect(state.lockStatus()).resolves.toMatchObject({
      alive: true,
      state: { pid: process.pid },
    });
  });

  it("runs the bounded autonomy retry scan from CLI", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);
    await main([
      "node",
      "bureau",
      "run",
      "new",
      "--type",
      "bug",
      "--scope",
      "Fix booking regression",
    ]);
    const runsDir = join(dir, ".bureauos", "memory", "runs");
    const runFile = (await readdir(runsDir)).find((file) => file.endsWith(".md"));
    expect(runFile).toBeDefined();
    const runPath = join(runsDir, runFile!);
    const runDoc = await readFile(runPath, "utf8");
    await writeFile(
      runPath,
      runDoc.replace("status: completed", "status: failed").replace(/completed: .*/, "completed: "),
      "utf8",
    );

    const code = await main(["node", "bureau", "autonomy", "retry-scan", "--max-attempts", "2"]);

    expect(code).toBe(0);
    const artifactsDir = join(dir, ".bureauos", "memory", "artifacts");
    const bodies = await Promise.all(
      (await readdir(artifactsDir)).map((artifact) =>
        readFile(join(artifactsDir, artifact), "utf8"),
      ),
    );
    expect(bodies.some((body) => body.includes("# Autonomous Retry Report"))).toBe(true);
    const patchedRun = await readFile(runPath, "utf8");
    expect(patchedRun).toContain("retry_attempts: 1");
    const audit = await readFile(join(dir, ".bureauos", "audit", "audit.log"), "utf8");
    expect(audit).toContain("autonomy.retry.started");
  });

  it("dispatches new runs through the coordinator by default", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);

    const code = await main([
      "node",
      "bureau",
      "run",
      "new",
      "--type",
      "planning",
      "--scope",
      "Plan delivery priorities",
    ]);

    expect(code).toBe(0);
    const audit = await readFile(join(dir, ".bureauos", "audit", "audit.log"), "utf8");
    expect(audit).toContain("coordinator.briefing_written");
    expect(audit).toContain("coordinator.step_completed");
    expect(audit).toContain("run.dispatch_completed");

    const runsDir = join(dir, ".bureauos", "memory", "runs");
    const runFile = (await readdir(runsDir)).find((file) => file.endsWith(".md"));
    expect(runFile).toBeDefined();
    const runDoc = await readFile(join(runsDir, runFile!), "utf8");
    expect(runDoc).toContain("dispatch_mode: coordinator");
    expect(runDoc).toContain('dispatch_pipeline: ["project_manager", "product"]');
  });

  it("keeps the run new stub path explicit with --stub", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);

    const code = await main([
      "node",
      "bureau",
      "run",
      "new",
      "--type",
      "planning",
      "--scope",
      "Plan delivery priorities",
      "--stub",
    ]);

    expect(code).toBe(0);
    const audit = await readFile(join(dir, ".bureauos", "audit", "audit.log"), "utf8");
    expect(audit).toContain("run.dispatch_stub_completed");
    expect(audit).not.toContain("coordinator.briefing_written");
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

  it("generates client account plans from CLI", async () => {
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

    const code = await main([
      "node",
      "bureau",
      "client",
      "account-plan",
      "--client",
      "pizzeria-aurora",
    ]);

    expect(code).toBe(0);
    const artifactsDir = join(dir, ".bureauos", "memory", "artifacts");
    const artifacts = await readdir(artifactsDir);
    const bodies = await Promise.all(
      artifacts.map((artifact) => readFile(join(artifactsDir, artifact), "utf8")),
    );
    expect(bodies.some((body) => body.includes("# Client Account Plan"))).toBe(true);
    const audit = await readFile(join(dir, ".bureauos", "audit", "audit.log"), "utf8");
    expect(audit).toContain("client.account_plan.generated");
  });

  it("generates client success status reports and scans memory follow-ups from CLI", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);
    await main([
      "node",
      "bureau",
      "client",
      "create",
      "--name",
      "Pizzeria Aurora",
      "--status",
      "active",
    ]);
    const clientPath = join(dir, ".bureauos", "memory", "clients", "pizzeria-aurora", "CLIENT.md");
    const clientDoc = await readFile(clientPath, "utf8");
    await writeFile(
      clientPath,
      clientDoc.replace(/^next_follow_up_at:.*$/m, "next_follow_up_at: 2026-05-24T09:00:00.000Z"),
      "utf8",
    );

    expect(
      await main(["node", "bureau", "client", "success-status", "--client", "pizzeria-aurora"]),
    ).toBe(0);
    expect(await main(["node", "bureau", "autonomy", "memory-scan"])).toBe(0);

    const artifactsDir = join(dir, ".bureauos", "memory", "artifacts");
    const bodies = await Promise.all(
      (await readdir(artifactsDir)).map((artifact) =>
        readFile(join(artifactsDir, artifact), "utf8"),
      ),
    );
    expect(bodies.some((body) => body.includes("# Client Success Status Report"))).toBe(true);
    expect(bodies.some((body) => body.includes("Draft Follow-Up"))).toBe(true);
    const runsDir = join(dir, ".bureauos", "memory", "runs");
    const runBodies = await Promise.all(
      (await readdir(runsDir)).map((run) => readFile(join(runsDir, run), "utf8")),
    );
    expect(runBodies.some((body) => body.includes("trigger_type: memory_due"))).toBe(true);
    const audit = await readFile(join(dir, ".bureauos", "audit", "audit.log"), "utf8");
    expect(audit).toContain("client.success_status.generated");
    expect(audit).toContain("memory.trigger.run_started");
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

  it("generates draft-only growth content from CLI", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);
    await main([
      "node",
      "bureau",
      "growth",
      "memory",
      "set",
      "--brand",
      "BureauOS is the AI operating room for owner-led software companies.",
      "--offers",
      "AAAS setup and autonomous delivery operations.",
      "--channels",
      "X, LinkedIn, GitHub.",
    ]);
    await main(["node", "bureau", "client", "create", "--name", "Nebula Studios"]);
    await main([
      "node",
      "bureau",
      "opportunity",
      "create",
      "--title",
      "AAAS Launch Package",
      "--source",
      "owner_pipeline",
      "--client",
      "nebula-studios",
      "--value",
      "12000",
    ]);

    const code = await main([
      "node",
      "bureau",
      "growth",
      "content",
      "--max-drafts",
      "3",
      "--focus",
      "AAAS launch",
    ]);

    expect(code).toBe(0);
    const artifactsDir = join(dir, ".bureauos", "memory", "artifacts");
    const artifacts = await readdir(artifactsDir);
    const bodies = await Promise.all(
      artifacts.map((artifact) => readFile(join(artifactsDir, artifact), "utf8")),
    );
    expect(bodies.some((body) => body.includes("# Content Pipeline Report"))).toBe(true);
    expect(bodies.some((body) => body.includes("# Social Post Brief"))).toBe(true);
    expect(bodies.some((body) => body.includes("# Campaign Brief"))).toBe(true);
    expect(bodies.some((body) => body.includes("# Creative Brief"))).toBe(true);
    expect(bodies.join("\n")).toContain("Do not name the client");

    const audit = await readFile(join(dir, ".bureauos", "audit", "audit.log"), "utf8");
    expect(audit).toContain("growth.content_pipeline.generated");
  });

  it("runs the revenue pipeline from CLI", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);
    await main([
      "node",
      "bureau",
      "client",
      "create",
      "--name",
      "Nebula Studios",
      "--status",
      "active",
    ]);
    await main([
      "node",
      "bureau",
      "opportunity",
      "create",
      "--title",
      "AAAS Launch Package",
      "--source",
      "owner_pipeline",
      "--client",
      "nebula-studios",
      "--value",
      "12000",
      "--margin",
      "55",
    ]);

    const code = await main(["node", "bureau", "revenue", "pipeline"]);

    expect(code).toBe(0);
    const artifactsDir = join(dir, ".bureauos", "memory", "artifacts");
    const artifacts = await readdir(artifactsDir);
    const bodies = await Promise.all(
      artifacts.map((artifact) => readFile(join(artifactsDir, artifact), "utf8")),
    );
    expect(bodies.some((body) => body.includes("# Revenue Pipeline Report"))).toBe(true);
    expect(bodies.some((body) => body.includes("# Lead Qualification Report"))).toBe(true);
    expect(bodies.some((body) => body.includes("# Pricing Brief"))).toBe(true);
    expect(bodies.some((body) => body.includes("# Proposal Brief"))).toBe(true);

    const audit = await readFile(join(dir, ".bureauos", "audit", "audit.log"), "utf8");
    expect(audit).toContain("revenue.pipeline.generated");
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

  it("generates project health reviews from CLI", async () => {
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
      "health",
      "--project",
      "pizzeria-aurora-booking-website",
    ]);

    expect(code).toBe(0);
    const artifactsDir = join(dir, ".bureauos", "memory", "artifacts");
    const artifacts = await readdir(artifactsDir);
    const bodies = await Promise.all(
      artifacts.map((artifact) => readFile(join(artifactsDir, artifact), "utf8")),
    );
    expect(bodies.some((body) => body.includes("# Project Health Review"))).toBe(true);
    const audit = await readFile(join(dir, ".bureauos", "audit", "audit.log"), "utf8");
    expect(audit).toContain("project.health_review.generated");
  });

  it("verifies project repositories from CLI without requiring fake data or a token", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);
    await main(["node", "bureau", "client", "create", "--name", "Miraglia Pizza"]);
    await main([
      "node",
      "bureau",
      "project",
      "create",
      "--name",
      "Miraglia Booking Website",
      "--client",
      "miraglia-pizza",
      "--repo",
      "https://github.com/example/miraglia",
    ]);
    const previousToken = process.env["GITHUB_TOKEN"];
    delete process.env["GITHUB_TOKEN"];

    try {
      const code = await main([
        "node",
        "bureau",
        "project",
        "verify-repositories",
        "--project",
        "miraglia-booking-website",
      ]);

      expect(code).toBe(0);
    } finally {
      if (previousToken) process.env["GITHUB_TOKEN"] = previousToken;
    }

    const artifactsDir = join(dir, ".bureauos", "memory", "artifacts");
    const artifacts = await readdir(artifactsDir);
    const bodies = await Promise.all(
      artifacts.map((artifact) => readFile(join(artifactsDir, artifact), "utf8")),
    );
    expect(bodies.some((body) => body.includes("# Project Repository Verification"))).toBe(true);
    expect(bodies.some((body) => body.includes("unverified"))).toBe(true);
    const audit = await readFile(join(dir, ".bureauos", "audit", "audit.log"), "utf8");
    expect(audit).toContain("project.repositories.verified");
  });

  it("generates growth reviews from CLI", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);
    const code = await main(["node", "bureau", "growth", "review", "--recent-days", "14"]);

    expect(code).toBe(0);
    const artifactsDir = join(dir, ".bureauos", "memory", "artifacts");
    const artifacts = await readdir(artifactsDir);
    const bodies = await Promise.all(
      artifacts.map((artifact) => readFile(join(artifactsDir, artifact), "utf8")),
    );
    expect(bodies.some((body) => body.includes("# Growth Review"))).toBe(true);
    const audit = await readFile(join(dir, ".bureauos", "audit", "audit.log"), "utf8");
    expect(audit).toContain("growth.review.generated");
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
      "gpt-5.5",
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

  it("audits capability-use checks from CLI", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);

    const code = await main([
      "node",
      "bureau",
      "capabilities",
      "check",
      "--agent",
      "development",
      "--capability",
      "codex",
      "--action",
      "read_repo",
      "--target",
      "github.com/acme/web",
    ]);

    expect(code).toBe(0);
    const artifacts = await readdir(join(dir, ".bureauos", "memory", "artifacts"));
    const bodies = await Promise.all(
      artifacts.map((file) =>
        readFile(join(dir, ".bureauos", "memory", "artifacts", file), "utf8"),
      ),
    );
    expect(bodies.some((body) => body.includes("Capability Use Audit"))).toBe(true);

    const audit = await readFile(join(dir, ".bureauos", "audit", "audit.log"), "utf8");
    expect(audit).toContain("capability.use.allowed");
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
      "gpt-5.3-codex",
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
      "gpt-5.5",
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

  it("requires a token before provisioning real GitHub repositories from CLI", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);
    const previousToken = process.env["GITHUB_TOKEN"];
    delete process.env["GITHUB_TOKEN"];

    try {
      const code = await main([
        "node",
        "bureau",
        "github",
        "provision-repo",
        "--project",
        "pizzeria-aurora-booking-website",
        "--owner",
        "emanueledenaro",
      ]);

      expect(code).toBe(1);
    } finally {
      if (previousToken) process.env["GITHUB_TOKEN"] = previousToken;
    }
  });

  it("requires a token before creating real GitHub pull requests from CLI", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);
    const previousToken = process.env["GITHUB_TOKEN"];
    delete process.env["GITHUB_TOKEN"];

    try {
      const code = await main([
        "node",
        "bureau",
        "github",
        "create-pr",
        "--project",
        "pizzeria-aurora-booking-website",
        "--owner",
        "emanueledenaro",
        "--repo",
        "pizzeria-aurora",
        "--title",
        "Implement booking website",
        "--head",
        "feature/booking-website",
      ]);

      expect(code).toBe(1);
    } finally {
      if (previousToken) process.env["GITHUB_TOKEN"] = previousToken;
    }
  });
});
