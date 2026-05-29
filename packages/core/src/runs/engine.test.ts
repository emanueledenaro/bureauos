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
});
