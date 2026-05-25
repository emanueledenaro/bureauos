import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/loader.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { ArtifactStore } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { PolicyEngine } from "../policy/engine.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { RunEngine } from "../runs/engine.js";
import { ProjectRegistry } from "../registries/project.js";
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import { readDoc, writeDoc } from "../registries/base.js";
import type { ProjectRecord } from "../registries/project.js";
import type {
  GitHubSignalCheckRun,
  GitHubSignalClient,
  GitHubSignalIssue,
  GitHubSignalPullRequest,
} from "../github/signal-sync.js";
import { Scheduler } from "./scheduler.js";

class FakeGitHubSignalClient implements GitHubSignalClient {
  async listIssues(owner: string, repo: string): Promise<readonly GitHubSignalIssue[]> {
    return [
      {
        owner,
        repo,
        number: 7,
        title: "Booking form fails on mobile",
        url: `https://github.com/${owner}/${repo}/issues/7`,
        labels: ["type:bug"],
        state: "open",
        updatedAt: "2026-05-24T10:00:00.000Z",
      },
    ];
  }

  async listPullRequests(owner: string, repo: string): Promise<readonly GitHubSignalPullRequest[]> {
    return [
      {
        owner,
        repo,
        number: 12,
        title: "Add booking checkout",
        url: `https://github.com/${owner}/${repo}/pull/12`,
        head: "feature/booking",
        headSha: "abc123def456",
        base: "main",
        state: "open",
        updatedAt: "2026-05-24T10:00:00.000Z",
      },
    ];
  }

  async listCheckRunsForRef(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<readonly GitHubSignalCheckRun[]> {
    return [
      {
        owner,
        repo,
        id: 91,
        name: "ci / test",
        url: `https://github.com/${owner}/${repo}/actions/runs/91`,
        status: "completed",
        conclusion: "failure",
        headSha: ref,
        startedAt: "2026-05-24T08:00:00.000Z",
        completedAt: "2026-05-24T08:04:00.000Z",
      },
    ];
  }
}

describe("Scheduler", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-sched-"));
    await initWorkspace({ root: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("runs the scheduled jobs on the first tick", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    const lines: string[] = [];
    const scheduler = new Scheduler({ config, runs, logger: (m) => lines.push(m) });
    await scheduler.tick(Date.now());
    const all = await runs.list();
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(lines.some((l) => l.includes("daily_executive_report"))).toBe(true);
  });

  it("does not double-run jobs within their interval", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    const scheduler = new Scheduler({ config, runs, logger: () => {} });
    const t0 = 1_700_000_000_000;
    await scheduler.tick(t0);
    const after1 = (await runs.list()).length;
    await scheduler.tick(t0 + 60_000);
    const after2 = (await runs.list()).length;
    expect(after2).toBe(after1);
  });

  it("generates business reports during the daily executive report job", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    const scheduler = new Scheduler({
      config,
      runs,
      workspaceRoot: dir,
      coordinator: { audit, artifacts, policy },
      logger: () => {},
    });

    await scheduler.tick(Date.now());

    const reports = await artifacts.list();
    expect(reports.map((artifact) => artifact.type)).toEqual(
      expect.arrayContaining(["executive-report", "business-operating-report"]),
    );
  });

  it("generates project health and growth reviews during scheduled daemon jobs", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    const client = await new ClientRegistry(dir).create({
      name: "Miraglia Pizza",
      status: "active",
      industry: "food_and_beverage",
    });
    await new ProjectRegistry(dir).create({
      name: "Miraglia Booking Website",
      clientId: client.id,
      status: "blocked",
    });
    const scheduler = new Scheduler({
      config,
      runs,
      workspaceRoot: dir,
      coordinator: { audit, artifacts, policy },
      logger: () => {},
    });

    await scheduler.tick(new Date("2026-05-25T10:00:00.000Z").getTime());

    const generated = await artifacts.list();
    expect(generated.map((artifact) => artifact.type)).toEqual(
      expect.arrayContaining(["project-health-report", "growth-review"]),
    );
    const scheduledRuns = await runs.list();
    const healthRun = scheduledRuns.find((run) => run.trigger_source === "project_health_check");
    const growthRun = scheduledRuns.find((run) => run.trigger_source === "growth_review");
    expect(healthRun?.artifacts.length).toBeGreaterThan(0);
    expect(growthRun?.artifacts.length).toBeGreaterThan(0);
  });

  it("generates real client account plans during the client account review job", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    const client = await new ClientRegistry(dir).create({
      name: "Miraglia Pizza",
      status: "active",
      industry: "food_and_beverage",
    });
    await new ProjectRegistry(dir).create({
      name: "Miraglia Booking Website",
      clientId: client.id,
      status: "in_progress",
      repository: "https://github.com/example/miraglia",
    });
    const scheduler = new Scheduler({
      config,
      runs,
      workspaceRoot: dir,
      coordinator: { audit, artifacts, policy },
      logger: () => {},
    });

    await scheduler.tick(new Date("2026-05-25T10:00:00.000Z").getTime());

    const plans = await artifacts.list({ type: "client-account-plan" });
    const realPlans = plans.filter((plan) => plan.client_id === client.id);
    expect(realPlans).toHaveLength(1);
    const accountReviewRun = (await runs.list()).find(
      (run) =>
        run.trigger_source === "client_account_review" &&
        run.artifacts.includes(realPlans[0]!.id),
    );
    expect(accountReviewRun).toBeDefined();
  });

  it("starts memory-due follow-up runs during daemon ticks", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    const client = await new ClientRegistry(dir).create({
      name: "Miraglia Pizza",
      status: "active",
      industry: "food_and_beverage",
    });
    const clientPath = join(workspacePaths(dir).clientsDir, client.slug, "CLIENT.md");
    const clientDoc = await readDoc<ClientRecord>(clientPath);
    await writeDoc(
      clientPath,
      { ...clientDoc.front, next_follow_up_at: "2026-05-24T09:00:00.000Z" },
      clientDoc.body,
    );
    const lines: string[] = [];
    const scheduler = new Scheduler({
      config,
      runs,
      workspaceRoot: dir,
      coordinator: { audit, artifacts, policy },
      logger: (message) => lines.push(message),
    });

    await scheduler.tick(new Date("2026-05-25T10:00:00.000Z").getTime());

    const memoryRuns = (await runs.list()).filter((run) => run.trigger_type === "memory_due");
    expect(memoryRuns).toHaveLength(1);
    expect(memoryRuns[0]).toMatchObject({
      type: "client_success",
      client_id: client.id,
    });
    const statusReports = await artifacts.list({ type: "client-success-status-report" });
    expect(statusReports.filter((report) => report.client_id === client.id)).toHaveLength(1);
    expect(lines.some((line) => line.includes("memory_trigger_scan triggered 1"))).toBe(true);

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("memory.trigger.run_started");
  });

  it("syncs GitHub signals for linked project repositories during daemon ticks", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    await new ProjectRegistry(dir).create({
      name: "Pizzeria Web",
      clientId: "client_test",
      repository: "https://github.com/acme/web",
    });
    const lines: string[] = [];
    const scheduler = new Scheduler({
      config,
      runs,
      workspaceRoot: dir,
      coordinator: { audit, artifacts, policy },
      githubClient: new FakeGitHubSignalClient(),
      logger: (message) => lines.push(message),
    });

    await scheduler.tick(Date.now());

    const signalReports = await artifacts.list({ type: "github-signal-report" });
    expect(signalReports).toHaveLength(1);
    const verificationReports = await artifacts.list({ type: "repository-verification-report" });
    expect(verificationReports).toHaveLength(1);
    expect(
      lines.some(
        (line) => line.includes("repository verification") && line.includes("checked 1 repositories"),
      ),
    ).toBe(true);

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("github.signals.synced");
    expect(log).toContain("github.check_failed.detected");
    expect(log).toContain("project.repositories.verified");
  });

  it("scans internal operating signals during daemon ticks", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    const client = await new ClientRegistry(dir).create({
      name: "Pizzeria Aurora",
      status: "active",
      industry: "food_and_beverage",
    });
    const clientPath = join(workspacePaths(dir).clientsDir, client.slug, "CLIENT.md");
    const clientDoc = await readDoc<ClientRecord>(clientPath);
    await writeDoc(
      clientPath,
      {
        ...clientDoc.front,
        last_client_message_at: "2026-05-20T09:00:00.000Z",
        last_owner_response_at: "2026-05-19T09:00:00.000Z",
      },
      clientDoc.body,
    );
    const project = await new ProjectRegistry(dir).create({
      name: "Pizzeria Aurora Booking Website",
      clientId: client.id,
      status: "blocked",
    });
    const projectPath = join(workspacePaths(dir).projectsDir, project.slug, "PROJECT.md");
    const projectDoc = await readDoc<ProjectRecord>(projectPath);
    await writeDoc(
      projectPath,
      { ...projectDoc.front, updated: "2026-05-20T09:00:00.000Z" },
      projectDoc.body,
    );
    const lines: string[] = [];
    const scheduler = new Scheduler({
      config,
      runs,
      workspaceRoot: dir,
      coordinator: { audit, artifacts, policy },
      logger: (message) => lines.push(message),
    });

    await scheduler.tick(new Date("2026-05-24T12:00:00.000Z").getTime());

    const signalReports = await artifacts.list({ type: "operational-signal-report" });
    expect(signalReports).toHaveLength(1);
    expect(lines.some((line) => line.includes("operational_signal_scan triggered 3"))).toBe(true);
    const thresholdRuns = (await runs.list()).filter((run) =>
      run.trigger_source.startsWith("bureauos."),
    );
    expect(thresholdRuns.map((run) => run.type).sort()).toEqual([
      "client_success",
      "content",
      "health_check",
    ]);

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("operational.signal_trigger.run_started");
  });
});
