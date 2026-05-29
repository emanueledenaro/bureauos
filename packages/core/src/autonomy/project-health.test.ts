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
import { ClientRegistry } from "../registries/client.js";
import { OpportunityRegistry } from "../registries/opportunity.js";
import { ProjectRegistry } from "../registries/project.js";
import { RunEngine } from "../runs/engine.js";
import { ProjectHealthReviewService } from "./project-health.js";

describe("ProjectHealthReviewService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-project-health-"));
    await initWorkspace({ root: dir, organizationName: "Project Health", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("generates a portfolio health report from real projects, approvals, runs, and pipeline", async () => {
    const client = await new ClientRegistry(dir).create({
      name: "Miraglia Pizza",
      status: "active",
      industry: "food_and_beverage",
    });
    const project = await new ProjectRegistry(dir).create({
      name: "Miraglia Booking Website",
      clientId: client.id,
      status: "blocked",
      repository: "https://github.com/example/miraglia",
    });
    await new OpportunityRegistry(dir).create({
      title: "Booking website",
      source: "owner_intake",
      clientId: client.id,
      expectedValue: 5000,
      expectedMargin: 45,
    });
    await new ApprovalRegistry(dir).request({
      action: "final_scope",
      actor: "proposal",
      target: project.id,
      scope: "Miraglia Booking Website scope",
    });
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("agency"), new ApprovalRegistry(dir));
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    await artifacts.write({
      type: "github-signal-report",
      createdBy: "supreme_coordinator",
      projectId: project.id,
      clientId: client.id,
      status: "submitted",
      metadata: {
        repository: "example/miraglia",
        pull_requests_count: 1,
        failing_checks_count: 2,
        stale_issues_count: 1,
        stale_pull_requests_count: 1,
      },
      body: "# GitHub Signal Report",
    });

    const result = await new ProjectHealthReviewService(dir, { audit, artifacts, runs }).generate({
      runId: "run_project_health",
      now: new Date("2026-05-25T10:00:00.000Z"),
    });

    expect(result.report).toMatchObject({
      type: "project-health-report",
      run_id: "run_project_health",
      status: "submitted",
      project_count: 1,
      blocked_count: 1,
    });
    expect(result.projects[0]).toMatchObject({
      project: { id: project.id, name: "Miraglia Booking Website" },
      client: { id: client.id, name: "Miraglia Pizza" },
      risk: "blocked",
      pending_approvals: 1,
      github_failing_checks: 2,
      github_stale_items: 2,
      github_open_pull_requests: 1,
      open_pipeline_value: 5000,
    });

    const written = await artifacts.read(result.report.id);
    expect(written?.body).toContain("# Project Health Review");
    expect(written?.body).toContain("Miraglia Booking Website");
    expect(written?.body).toContain("project is blocked");
    expect(written?.body).toContain("GitHub failing checks 2");
    expect(written?.body).toContain("2 stale GitHub issue/PR signal(s)");
    expect(written?.body).toContain("Owner approval is still required");

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("project.health_review.generated");
  });

  it("writes an empty health report without inventing projects", async () => {
    const result = await new ProjectHealthReviewService(dir).generate({
      now: new Date("2026-05-25T10:00:00.000Z"),
    });

    expect(result.projects).toEqual([]);
    const written = await new ArtifactStore(dir).read(result.report.id);
    expect(written?.body).toContain("No projects recorded");
  });
});
