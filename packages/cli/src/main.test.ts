import { mkdtemp, rm, access, readFile, readdir, writeFile } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApprovalRegistry, DaemonStateStore } from "@bureauos/core";
import { main, parseFlags } from "./main.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function captureStdout(
  run: () => Promise<number>,
): Promise<{ code: number; output: string }> {
  const originalWrite = process.stdout.write;
  let output = "";
  process.stdout.write = ((chunk: unknown, ..._args: unknown[]) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: await run(), output };
  } finally {
    process.stdout.write = originalWrite;
  }
}

async function captureStderr(
  run: () => Promise<number>,
): Promise<{ code: number; output: string }> {
  const originalWrite = process.stderr.write;
  let output = "";
  process.stderr.write = ((chunk: unknown, ..._args: unknown[]) => {
    output += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    return { code: await run(), output };
  } finally {
    process.stderr.write = originalWrite;
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
    expect(yaml).toContain("level: 2");
  });

  it("prints the active autonomy level in policy explain", async () => {
    await main(["node", "bureau", "init"]);

    const result = await captureStdout(() =>
      main(["node", "bureau", "policy", "explain", "merge_pull_requests"]),
    );

    expect(result.code).toBe(0);
    expect(result.output).toContain("Autonomy: Level 2 (Branch and PR)");
    expect(result.output).toContain("Outcome:  require_approval");
  });

  it("prints approval source limit and expiry in approvals list", async () => {
    await main(["node", "bureau", "init"]);
    await new ApprovalRegistry(dir).request({
      action: "send_final_proposals",
      actor: "supreme_coordinator",
      target: "opp_123",
      scope: "Send final proposal to Acme.",
      source: "revenue.pipeline:art_123",
      limit: "Draft value $12,000; client send only",
      expiresAt: "2026-06-01T10:00:00.000Z",
      riskLevel: "high",
    });

    const result = await captureStdout(() => main(["node", "bureau", "approvals", "list"]));

    expect(result.code).toBe(0);
    expect(result.output).toContain("send_final_proposals");
    expect(result.output).toContain("source: revenue.pipeline:art_123");
    expect(result.output).toContain("limit: Draft value $12,000; client send only");
    expect(result.output).toContain("expires: 2026-06-01T10:00:00.000Z");
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

  it("rejects Object.prototype names as commands/subcommands without crashing (SER-207)", async () => {
    // Top-level prototype name must not invoke Object.prototype.toString.
    const top = await captureStderr(() => main(["node", "bureau", "toString"]));
    expect(top.code).toBe(1);
    expect(top.output).toContain('unknown command "toString"');

    // Namespaced prototype name must yield the clean "expected one of:" error.
    const sub = await captureStderr(() => main(["node", "bureau", "client", "toString"]));
    expect(sub.code).toBe(1);
    expect(sub.output).toContain("bureau client: expected one of:");

    // Other inherited members across dispatch styles all exit 1 cleanly.
    for (const argv of [
      ["node", "bureau", "constructor"],
      ["node", "bureau", "client", "constructor"],
      ["node", "bureau", "memory", "hasOwnProperty"],
      ["node", "bureau", "github", "valueOf"],
    ]) {
      const r = await captureStderr(() => main(argv));
      expect(r.code).toBe(1);
    }
  });

  it("rejects NaN numeric flags with a clean error and exit 1 (SER-213)", async () => {
    // `audit tail -n abc` previously dumped the whole log via slice(-NaN).
    const tail = await captureStderr(() => main(["node", "bureau", "audit", "tail", "-n", "abc"]));
    expect(tail.code).toBe(1);
    expect(tail.output).toContain("bureau: audit tail: -n must be a number");

    // `serve --port abc` is rejected before any server starts.
    const serve = await captureStderr(() => main(["node", "bureau", "serve", "--port", "abc"]));
    expect(serve.code).toBe(1);
    expect(serve.output).toContain("bureau: serve: --port must be a number");
  });

  it("formats handler errors as 'bureau: <command>: <message>' without a fatal Error prefix (SER-210)", async () => {
    // No workspace in the test cwd: handleIntake throws from loadWorkspaceConfig.
    const top = await captureStderr(() => main(["node", "bureau", "intake", "--message", "hello"]));
    expect(top.code).toBe(1);
    expect(top.output).toContain("bureau: intake: ");
    expect(top.output).toContain("no workspace");
    expect(top.output).not.toContain("fatal");
    expect(top.output).not.toContain("Error:");

    // A namespaced command labels with "<command> <sub>".
    const sub = await captureStderr(() => main(["node", "bureau", "report", "generate"]));
    expect(sub.code).toBe(1);
    expect(sub.output).toContain("bureau: report generate: ");
    expect(sub.output).not.toContain("fatal");
    expect(sub.output).not.toContain("Error:");
  });

  it("records durable decisions and daily notes from CLI", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);

    const decision = await captureStdout(() =>
      main([
        "node",
        "bureau",
        "decision",
        "--what",
        "Keep Coordinator replies clean",
        "--why",
        "Owner-facing chat should not expose internal traces.",
        "--actor",
        "supreme_coordinator",
        "--affects",
        "SER-42,coordinator",
      ]),
    );
    expect(decision.code).toBe(0);
    expect(decision.output).toContain("bureau: decision decision_");

    expect(
      await main([
        "node",
        "bureau",
        "follow-up",
        "--section",
        "Decisions",
        "--line",
        "Review durable memory write-back.",
      ]),
    ).toBe(0);

    const decisions = await readFile(join(dir, ".bureauos", "memory", "DECISIONS.md"), "utf8");
    expect(decisions).toContain("Keep Coordinator replies clean");
    expect(decisions).toContain("SER-42, coordinator");

    const dailyDir = join(dir, ".bureauos", "memory", "memory");
    const dailyBodies = await Promise.all(
      (await readdir(dailyDir)).map((file) => readFile(join(dailyDir, file), "utf8")),
    );
    expect(dailyBodies.some((body) => body.includes("Review durable memory write-back."))).toBe(
      true,
    );
    expect(dailyBodies.some((body) => body.includes("- (Decisions)"))).toBe(false);

    const audit = await readFile(join(dir, ".bureauos", "audit", "audit.log"), "utf8");
    expect(audit).toContain("memory.decision_recorded");
    expect(audit).toContain("memory.daily_note_appended");
  });

  it("manages and searches the FTS5 memory index from the CLI", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);
    await writeFile(
      join(dir, ".bureauos", "memory", "ROOT.md"),
      "# Root\nMargherita landing page index target.\n",
      "utf8",
    );

    const status = await captureStdout(() => main(["node", "bureau", "memory", "index", "status"]));
    expect(status.code).toBe(0);
    expect(status.output).toContain("memory index:");

    const rebuild = await captureStdout(() =>
      main(["node", "bureau", "memory", "index", "rebuild"]),
    );
    expect(rebuild.code).toBe(0);
    // node:sqlite may be unavailable in some runtimes; the command must still
    // exit cleanly. When available, it reports the configured index path.
    if (rebuild.output.includes("rebuilt")) {
      expect(rebuild.output).toContain(join("indexes", "memory.sqlite"));
      // The configured index, not the legacy default location, is written.
      expect(await exists(join(dir, ".bureauos", "memory", "indexes", "memory.sqlite"))).toBe(true);
      expect(await exists(join(dir, ".bureauos", "memory", ".index"))).toBe(false);
    }

    const search = await captureStdout(() =>
      main(["node", "bureau", "memory", "search", "margherita"]),
    );
    expect(search.code).toBe(0);
    expect(search.output).toContain("ROOT.md");

    const bad = await main(["node", "bureau", "memory", "index", "bogus"]);
    expect(bad).toBe(1);
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
    expect(audit).toContain("coordinator_tool.create_intake");
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
    // Force a clean retryable failure. The coordinator-dispatched bug run can
    // legitimately end blocked (e.g. the QA acceptance gate), but this test
    // asserts the bounded-retry start path, which needs a generic retryable
    // failure rather than an acceptance-criteria blocker.
    await writeFile(
      runPath,
      runDoc
        .replace(/status: \w+/, "status: failed")
        .replace(/dispatch_status: \w+/, "dispatch_status: failed")
        .replace(/^dispatch_blockers:.*$/m, "dispatch_blockers: []")
        .replace(/completed: .*/, "completed: "),
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

  it("surfaces Linear source work items in run CLI output and persisted metadata", async () => {
    await main(["node", "bureau", "init", "--name", "BOS"]);

    const created = await captureStdout(() =>
      main([
        "node",
        "bureau",
        "run",
        "new",
        "--type",
        "feature",
        "--scope",
        "SER-34 source metadata",
        "--linear-issue",
        "SER-34",
        "--linear-url",
        "https://linear.app/serium/issue/SER-34/link-linear-issue-metadata-to-bureauos-runs-and-artifacts",
        "--stub",
      ]),
    );

    expect(created.code).toBe(0);
    expect(created.output).toContain("bureau: source: linear_issue:SER-34");
    expect(created.output).toContain("https://linear.app/serium/issue/SER-34");

    const listed = await captureStdout(() => main(["node", "bureau", "run", "list"]));
    expect(listed.code).toBe(0);
    expect(listed.output).toContain("linear_issue:SER-34");

    const runsDir = join(dir, ".bureauos", "memory", "runs");
    const runFile = (await readdir(runsDir)).find((file) => file.endsWith(".md"));
    expect(runFile).toBeDefined();
    const runDoc = await readFile(join(runsDir, runFile!), "utf8");
    expect(runDoc).toContain("source_work_item_id: SER-34");
    expect(runDoc).toContain("linear_url:");
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
    // The feature pipeline runs real concrete agents; QA legitimately blocks
    // without acceptance evidence, so the dispatch is truthfully recorded as
    // blocked rather than a clean completion (SER-185).
    expect(audit).toContain("project.dispatch.blocked");
    expect(audit).not.toContain("project.dispatch.completed");
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

describe("parseFlags --key=value (SER-178)", () => {
  const schema = {
    message: { type: "string" },
    value: { type: "number" },
    force: { type: "boolean" },
  } as const;

  it("parses --key=value for string, number, and boolean flags", () => {
    expect(parseFlags(["--message=hello world"], schema)).toMatchObject({ message: "hello world" });
    expect(parseFlags(["--value=1000"], schema)).toMatchObject({ value: 1000 });
    expect(parseFlags(["--force=true"], schema)).toMatchObject({ force: true });
    expect(parseFlags(["--force=false"], schema)).toMatchObject({ force: false });
  });

  it("keeps the space-separated form working and treats bare boolean as true", () => {
    expect(parseFlags(["--message", "spaced too"], schema)).toMatchObject({
      message: "spaced too",
    });
    expect(parseFlags(["--force"], schema)).toMatchObject({ force: true });
  });

  it("preserves '=' inside the value (splits on the first '=' only)", () => {
    expect(parseFlags(["--message=a=b=c"], schema)).toMatchObject({ message: "a=b=c" });
  });

  it("still errors clearly on an unknown --key=value", () => {
    expect(parseFlags(["--bogus=1"], schema)).toBe('unknown option "--bogus"');
  });

  it("rejects a non-boolean value for a boolean flag", () => {
    expect(parseFlags(["--force=maybe"], schema)).toBe(
      'invalid boolean value for --force: "maybe"',
    );
  });

  it("rejects a non-numeric value for a number flag (SER-213)", () => {
    const numSchema = { limit: { type: "number", alias: "n" } } as const;
    expect(parseFlags(["--value=abc"], schema)).toBe("--value must be a number");
    expect(parseFlags(["--value", "abc"], schema)).toBe("--value must be a number");
    expect(parseFlags(["-n", "abc"], numSchema)).toBe("-n must be a number");
    // Non-finite values are also rejected; valid numbers (incl. 0) still parse.
    expect(parseFlags(["--value=1e999"], schema)).toBe("--value must be a number");
    expect(parseFlags(["--value=0"], schema)).toMatchObject({ value: 0 });
    expect(parseFlags(["--value=-12"], schema)).toMatchObject({ value: -12 });
  });
});
