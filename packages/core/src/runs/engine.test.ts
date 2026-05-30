import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/loader.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { ensureDir, writeDoc } from "../registries/base.js";
import { ArtifactStore } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { PolicyEngine } from "../policy/engine.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { ClientRegistry } from "../registries/client.js";
import { ProjectRegistry } from "../registries/project.js";
import { RunEngine } from "./engine.js";

describe("RunEngine", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-runs-"));
    await initWorkspace({ root: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("runs a planning run to completion and writes an artifact", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const engine = new RunEngine(dir, { audit, artifacts, policy });

    const run = await engine.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "test",
      scope: "test scope",
    });

    expect(run.status).toBe("completed");
    expect(run.artifacts.length).toBe(1);

    const arts = await artifacts.list({ run_id: run.id });
    expect(arts.length).toBe(1);
    expect(arts[0]?.type).toBe("run-report");
  });

  it("persists Linear source work item metadata on runs and run artifacts", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const engine = new RunEngine(dir, { audit, artifacts, policy });

    const run = await engine.start({
      type: "feature",
      triggerType: "external_signal",
      triggerSource: "linear://issue/SER-34",
      sourceWorkItem: {
        type: "linear_issue",
        identifier: "SER-34",
        url: "https://linear.app/serium/issue/SER-34/link-linear-issue-metadata-to-bureauos-runs-and-artifacts",
      },
      scope: "SER-34: Link Linear issue metadata to BureauOS runs and artifacts",
    });

    expect(run.source_work_item_type).toBe("linear_issue");
    expect(run.source_work_item_id).toBe("SER-34");
    expect(run.linear_identifier).toBe("SER-34");

    const reloaded = await engine.get(run.id);
    expect(reloaded?.source_work_item_url).toBe(
      "https://linear.app/serium/issue/SER-34/link-linear-issue-metadata-to-bureauos-runs-and-artifacts",
    );
    expect(reloaded?.linear_url).toBe(
      "https://linear.app/serium/issue/SER-34/link-linear-issue-metadata-to-bureauos-runs-and-artifacts",
    );

    const runFile = await readFile(join(workspacePaths(dir).runsDir, `${run.id}.md`), "utf8");
    expect(runFile).toContain("source_work_item_id: SER-34");
    expect(runFile).toContain("Source work item: linear_issue:SER-34");

    const [artifact] = await artifacts.list({ run_id: run.id });
    expect(artifact?.source_work_item_type).toBe("linear_issue");
    expect(artifact?.source_work_item_id).toBe("SER-34");
    expect(artifact?.linear_url).toBe(
      "https://linear.app/serium/issue/SER-34/link-linear-issue-metadata-to-bureauos-runs-and-artifacts",
    );
  });

  it("uses an injected dispatcher when one is supplied", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const engine = new RunEngine(dir, {
      audit,
      artifacts,
      policy,
      dispatcher: async ({ run }) => {
        const artifact = await artifacts.write({
          type: "run-report",
          createdBy: run.created_by,
          runId: run.id,
          body: "# Dispatched\n\nReal dispatcher path used.",
        });
        return {
          status: "completed",
          artifactIds: [artifact.id],
          decisions: ["dispatcher-used"],
          metadata: { dispatch_mode: "test" },
        };
      },
    });

    const run = await engine.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "test",
      scope: "test scope",
    });

    expect(run.status).toBe("completed");
    expect(run.artifacts.length).toBe(1);
    expect(run.decisions).toContain("dispatcher-used");
    expect(run.dispatch_mode).toBe("test");

    const runFile = await readFile(join(workspacePaths(dir).runsDir, `${run.id}.md`), "utf8");
    expect(runFile).toContain("Dispatch: completed");
    expect(runFile).not.toContain("Stub dispatch completed");
    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("run.dispatch_completed");
    expect(log).not.toContain("run.dispatch_stub_completed");
  });

  it("persists blocked dispatcher results with blocker evidence", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const engine = new RunEngine(dir, {
      audit,
      artifacts,
      policy,
      dispatcher: async () => ({
        status: "blocked",
        blockers: ["missing acceptance criteria"],
        metadata: { dispatch_mode: "test" },
      }),
    });

    const run = await engine.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "test",
      scope: "test scope",
    });

    expect(run.status).toBe("blocked");
    expect(run.dispatch_blockers).toEqual(["missing acceptance criteria"]);
    expect(run.completed).toBe("");

    const runFile = await readFile(join(workspacePaths(dir).runsDir, `${run.id}.md`), "utf8");
    expect(runFile).toContain("Blockers: missing acceptance criteria");
    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("run.dispatch_blocked");
    expect(log).toContain("run.blocked");
  });

  it("writes completed run outcomes to scoped project and client memory", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const client = await new ClientRegistry(dir).create({ name: "Alpha Client" });
    const otherClient = await new ClientRegistry(dir).create({ name: "Beta Client" });
    const projects = new ProjectRegistry(dir);
    const project = await projects.create({ name: "Alpha Web", clientId: client.id });
    const otherProject = await projects.create({ name: "Beta Web", clientId: otherClient.id });
    const engine = new RunEngine(dir, { audit, artifacts, policy });

    const run = await engine.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "ser-51-test",
      scope: "Prepare scoped delivery plan",
      clientId: client.id,
      projectId: project.id,
    });

    const paths = workspacePaths(dir);
    const projectRuns = await readFile(join(paths.projectsDir, project.slug, "RUNS.md"), "utf8");
    const clientProjects = await readFile(
      join(paths.clientsDir, client.slug, "PROJECTS.md"),
      "utf8",
    );
    expect(projectRuns).toContain(`Run ${run.id} completed`);
    expect(projectRuns).toContain("- Status: completed");
    expect(projectRuns).toContain(run.artifacts[0]!);
    expect(clientProjects).toContain(`Run ${run.id} completed`);
    expect(clientProjects).toContain("Prepare scoped delivery plan");

    await expect(
      readFile(join(paths.projectsDir, otherProject.slug, "RUNS.md"), "utf8"),
    ).resolves.not.toContain(run.id);
    await expect(
      readFile(join(paths.clientsDir, otherClient.slug, "PROJECTS.md"), "utf8"),
    ).resolves.not.toContain(run.id);
    const log = await readFile(paths.auditLog, "utf8");
    expect(log).toContain("memory.run_outcome_written");
  });

  it("writes needs_human run outcomes to scoped RUNS.md and RISKS.md (SER-193)", async () => {
    const config = defaultConfig("freelancer");
    // A feature run maps to open_pull_requests; disabling it parks the run at
    // needs_human on start.
    config.autonomy.open_pull_requests = false;
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const client = await new ClientRegistry(dir).create({ name: "Parked Client" });
    const project = await new ProjectRegistry(dir).create({
      name: "Parked Web",
      clientId: client.id,
    });
    const engine = new RunEngine(dir, { audit, artifacts, policy });

    const run = await engine.start({
      type: "feature",
      triggerType: "owner_request",
      triggerSource: "ser-193-test",
      scope: "Implement booking flow",
      clientId: client.id,
      projectId: project.id,
    });
    expect(run.status).toBe("needs_human");

    const paths = workspacePaths(dir);
    const projectRuns = await readFile(join(paths.projectsDir, project.slug, "RUNS.md"), "utf8");
    const projectRisks = await readFile(join(paths.projectsDir, project.slug, "RISKS.md"), "utf8");
    expect(projectRuns).toContain(`Run ${run.id} needs_human`);
    expect(projectRisks).toContain(`Run ${run.id} needs_human`);
    const clientRisks = await readFile(join(paths.clientsDir, client.slug, "RISKS.md"), "utf8");
    expect(clientRisks).toContain(`Run ${run.id} needs_human`);

    const log = await readFile(paths.auditLog, "utf8");
    expect(log).toContain("memory.run_outcome_written");
  });

  it("writes blocked and failed run outcomes to scoped risk memory", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const client = await new ClientRegistry(dir).create({ name: "Risk Client" });
    const project = await new ProjectRegistry(dir).create({
      name: "Risk Web",
      clientId: client.id,
    });
    const blockedEngine = new RunEngine(dir, {
      audit,
      artifacts,
      policy,
      dispatcher: async () => ({
        status: "blocked",
        blockers: ["owner decision missing"],
        metadata: { approval_ids: ["approval_123"] },
      }),
    });

    const blocked = await blockedEngine.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "ser-51-blocked",
      scope: "Blocked scope",
      clientId: client.id,
      projectId: project.id,
    });
    expect(blocked.status).toBe("blocked");

    const failedEngine = new RunEngine(dir, {
      audit,
      artifacts,
      policy,
      dispatcher: async () => {
        throw new Error("runtime crashed");
      },
    });
    const failed = await failedEngine.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "ser-51-failed",
      scope: "Failed scope",
      clientId: client.id,
      projectId: project.id,
    });
    expect(failed.status).toBe("failed");

    const paths = workspacePaths(dir);
    const projectRisks = await readFile(join(paths.projectsDir, project.slug, "RISKS.md"), "utf8");
    const clientRisks = await readFile(join(paths.clientsDir, client.slug, "RISKS.md"), "utf8");
    expect(projectRisks).toContain(`Run ${blocked.id} blocked`);
    expect(projectRisks).toContain("owner decision missing");
    expect(projectRisks).toContain(`Run ${failed.id} failed`);
    expect(projectRisks).toContain("runtime crashed");
    expect(clientRisks).toContain(`Run ${blocked.id} blocked`);
    expect(clientRisks).toContain(`Run ${failed.id} failed`);

    const clientProjects = await readFile(
      join(paths.clientsDir, client.slug, "PROJECTS.md"),
      "utf8",
    );
    expect(clientProjects).toContain("Approvals: approval_123");
    expect(clientProjects).toContain("Error: runtime crashed");
  });

  it("records a structured decision record on completion when enabled", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const client = await new ClientRegistry(dir).create({ name: "Decision Client" });
    const project = await new ProjectRegistry(dir).create({
      name: "Decision Web",
      clientId: client.id,
    });
    const engine = new RunEngine(dir, { audit, artifacts, policy, recordDecisions: true });

    const run = await engine.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "ser-168-test",
      scope: "Prepare delivery plan",
      clientId: client.id,
      projectId: project.id,
    });
    expect(run.status).toBe("completed");

    const paths = workspacePaths(dir);
    const decisions = await readFile(paths.decisionsLog, "utf8");
    expect(decisions).toContain(`Run ${run.id} completed: Prepare delivery plan`);

    // The decision cross-links back into the run record.
    const reloaded = await engine.get(run.id);
    expect((reloaded?.decisions ?? []).some((id) => id.startsWith("decision_"))).toBe(true);
    const runFile = await readFile(join(paths.runsDir, `${run.id}.md`), "utf8");
    expect(runFile).toContain("## Decision Records");

    // The project decision log also receives the record.
    const projectDecisions = await readFile(
      join(paths.projectsDir, project.slug, "DECISIONS.md"),
      "utf8",
    );
    expect(projectDecisions).toContain(`Run ${run.id} completed`);

    const log = await readFile(paths.auditLog, "utf8");
    expect(log).toContain("memory.decision_recorded");
  });

  it("does not record decision records when the flag is off", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const engine = new RunEngine(dir, { audit, artifacts, policy });

    const run = await engine.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "ser-168-off",
      scope: "Plan without decision record",
    });
    expect(run.status).toBe("completed");
    expect((run.decisions ?? []).some((id) => id.startsWith("decision_"))).toBe(false);

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).not.toContain("memory.decision_recorded");
  });

  it("blocks a run when policy disallows the underlying action", async () => {
    const config = defaultConfig("freelancer");
    config.autonomy.open_pull_requests = false;
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const engine = new RunEngine(dir, { audit, artifacts, policy });

    const run = await engine.start({
      type: "feature",
      triggerType: "owner_request",
      triggerSource: "test",
      scope: "implement X",
    });
    expect(run.status).toBe("needs_human");
  });

  it("records a terminal decision when a dispatched run ends blocked (SER-192)", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const engine = new RunEngine(dir, {
      audit,
      artifacts,
      policy,
      recordDecisions: true,
      dispatcher: async () => ({
        status: "blocked",
        blockers: ["missing final scope approval"],
      }),
    });

    const run = await engine.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "ser-192-blocked",
      scope: "Draft proposal",
    });
    expect(run.status).toBe("blocked");

    const decisions = await readFile(workspacePaths(dir).decisionsLog, "utf8");
    expect(decisions).toContain(`Run ${run.id} blocked: Draft proposal`);
    expect(decisions).toContain("missing final scope approval");
    const runFile = await readFile(join(workspacePaths(dir).runsDir, `${run.id}.md`), "utf8");
    expect(runFile).toContain("## Decision Records");
  });

  it("records a terminal decision when a dispatched run fails (SER-192)", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const engine = new RunEngine(dir, {
      audit,
      artifacts,
      policy,
      recordDecisions: true,
      dispatcher: async () => {
        throw new Error("runtime exploded");
      },
    });

    const run = await engine.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "ser-192-failed",
      scope: "Generate report",
    });
    expect(run.status).toBe("failed");

    const decisions = await readFile(workspacePaths(dir).decisionsLog, "utf8");
    expect(decisions).toContain(`Run ${run.id} failed: Generate report`);
    expect(decisions).toContain("runtime exploded");
  });

  it("records a terminal decision when policy blocks a run at start (SER-192)", async () => {
    const config = defaultConfig("freelancer");
    config.autonomy.open_pull_requests = false;
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const engine = new RunEngine(dir, { audit, artifacts, policy, recordDecisions: true });

    const run = await engine.start({
      type: "feature",
      triggerType: "owner_request",
      triggerSource: "ser-192-policy",
      scope: "implement X",
    });
    expect(run.status).toBe("needs_human");

    const decisions = await readFile(workspacePaths(dir).decisionsLog, "utf8");
    expect(decisions).toContain(`Run ${run.id} needs_human: implement X`);
  });

  async function seedRun(id: string, status: string, updated: string): Promise<void> {
    const runsDir = workspacePaths(dir).runsDir;
    await ensureDir(runsDir);
    await writeDoc(
      join(runsDir, `${id}.md`),
      {
        id,
        type: "planning",
        status,
        trigger_type: "owner_request",
        trigger_source: "test",
        project_id: "",
        client_id: "",
        scope: `Run ${id}`,
        created_by: "supreme_coordinator",
        artifacts: [],
        decisions: [],
        created: updated,
        updated,
        completed: "",
        source_work_item_type: "",
        source_work_item_id: "",
        source_work_item_url: "",
        linear_identifier: "",
        linear_url: "",
      },
      `# Run ${id}\n\nScope: Run ${id}\nStatus: ${status}\n`,
    );
  }

  it("reconciles a run dangling in a non-terminal state past the threshold (SER-194)", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const engine = new RunEngine(dir, { audit, artifacts, policy });

    await seedRun("run_stale01", "in_progress", "2026-05-29T00:00:00.000Z");

    const reconciled = await engine.reconcileStaleRuns({
      now: new Date("2026-05-30T12:00:00.000Z"),
      staleMs: 60 * 60 * 1000,
    });

    expect(reconciled.map((r) => r.id)).toEqual(["run_stale01"]);
    const reloaded = await engine.get("run_stale01");
    expect(reloaded?.status).toBe("blocked");
    expect(String(reloaded?.["blocking_reason"])).toContain("stale");

    const auditLog = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(auditLog).toContain("run.reconciled_stale");
  });

  it("leaves fresh non-terminal and already-terminal runs untouched (SER-194)", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const engine = new RunEngine(dir, { audit, artifacts, policy });

    const now = new Date("2026-05-30T12:00:00.000Z");
    // Fresh in_progress (updated 1 minute ago) and an already-completed run.
    await seedRun("run_fresh01", "in_progress", "2026-05-30T11:59:00.000Z");
    await seedRun("run_done01", "completed", "2026-05-29T00:00:00.000Z");

    const reconciled = await engine.reconcileStaleRuns({ now, staleMs: 60 * 60 * 1000 });

    expect(reconciled).toHaveLength(0);
    expect((await engine.get("run_fresh01"))?.status).toBe("in_progress");
    expect((await engine.get("run_done01"))?.status).toBe("completed");
  });
});
