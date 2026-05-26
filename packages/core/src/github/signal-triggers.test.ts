import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { defaultConfig } from "../config/loader.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { PolicyEngine } from "../policy/engine.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { RunEngine } from "../runs/engine.js";
import { GitHubSignalTriggerService } from "./signal-triggers.js";
import type {
  GitHubSignalCheckRun,
  GitHubSignalIssue,
  GitHubSignalPullRequest,
} from "./signal-sync.js";

const failingCheck: GitHubSignalCheckRun = {
  owner: "acme",
  repo: "web",
  id: 91,
  name: "ci / test",
  url: "https://github.com/acme/web/actions/runs/91",
  status: "completed",
  conclusion: "failure",
  headSha: "abc123def456",
  startedAt: "2026-05-24T08:00:00.000Z",
  completedAt: "2026-05-24T08:04:00.000Z",
};

const stalePullRequest: GitHubSignalPullRequest = {
  owner: "acme",
  repo: "web",
  number: 12,
  title: "Add booking checkout",
  url: "https://github.com/acme/web/pull/12",
  head: "feature/booking",
  headSha: "abc123def456",
  base: "main",
  state: "open",
  updatedAt: "2026-05-01T10:00:00.000Z",
};

const staleIssue: GitHubSignalIssue = {
  owner: "acme",
  repo: "web",
  number: 7,
  title: "Booking form fails on mobile",
  url: "https://github.com/acme/web/issues/7",
  labels: ["type:bug"],
  state: "open",
  updatedAt: "2026-05-01T09:00:00.000Z",
};

describe("GitHubSignalTriggerService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-github-triggers-"));
    await initWorkspace({ root: dir, organizationName: "Signal Trigger Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("starts idempotent threshold runs from failing checks and stale work", async () => {
    const config = defaultConfig("agency");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    const report = await artifacts.write({
      type: "github-signal-report",
      createdBy: "supreme_coordinator",
      projectId: "project_acme",
      clientId: "client_acme",
      body: "# GitHub Signal Report",
    });
    const service = new GitHubSignalTriggerService({
      runs,
      audit,
      policy,
      workspaceRoot: dir,
      coordinator: { audit, artifacts, policy },
    });

    const result = await service.trigger({
      repository: "acme/web",
      report,
      failingChecks: [failingCheck],
      staleIssues: [staleIssue],
      stalePullRequests: [stalePullRequest],
    });
    const duplicate = await service.trigger({
      repository: "acme/web",
      report,
      failingChecks: [failingCheck],
      staleIssues: [staleIssue],
      stalePullRequests: [stalePullRequest],
    });

    expect(result.triggered.map((item) => item.kind).sort()).toEqual([
      "failing_check",
      "stale_issue",
      "stale_pull_request",
    ]);
    expect(duplicate.triggered).toHaveLength(0);
    expect(duplicate.skipped.map((item) => item.reason)).toEqual([
      "duplicate",
      "duplicate",
      "duplicate",
    ]);

    const allRuns = await runs.list();
    expect(allRuns.map((run) => run.trigger_type)).toEqual(["threshold", "threshold", "threshold"]);
    expect(allRuns.map((run) => run.type).sort()).toEqual(["bug", "health_check", "health_check"]);
    expect(allRuns.every((run) => run.project_id === "project_acme")).toBe(true);
    expect(allRuns.every((run) => run.client_id === "client_acme")).toBe(true);
    expect(allRuns.every((run) => run.artifacts.includes(report.id))).toBe(true);

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("github.signal_trigger.run_started");
    expect(log).toContain("coordinator.step_completed");
  });

  it("blocks threshold runs when triage autonomy is disabled", async () => {
    const config = defaultConfig("agency");
    config.autonomy.start_triage_runs = false;
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    const report = await artifacts.write({
      type: "github-signal-report",
      createdBy: "supreme_coordinator",
      body: "# GitHub Signal Report",
    });

    const result = await new GitHubSignalTriggerService({ runs, audit, policy }).trigger({
      repository: "acme/web",
      report,
      failingChecks: [failingCheck],
    });

    expect(result.triggered).toHaveLength(0);
    expect(result.skipped).toEqual([
      {
        kind: "failing_check",
        triggerSource: "github.check_failed:acme/web@abc123def456:91",
        reason: "policy_blocked",
      },
    ]);
    expect(await runs.list()).toHaveLength(0);

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("github.signal_trigger.blocked");
  });
});
