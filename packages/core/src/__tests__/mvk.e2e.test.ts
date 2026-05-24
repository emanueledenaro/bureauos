import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { ClientRegistry } from "../registries/client.js";
import { ProjectRegistry } from "../registries/project.js";
import { OpportunityRegistry } from "../registries/opportunity.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { ArtifactStore } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { defaultConfig } from "../config/loader.js";
import { PolicyEngine } from "../policy/engine.js";
import { RunEngine } from "../runs/engine.js";
import { appendDailyNote } from "../memory/daily.js";
import { appendDecision } from "../memory/decisions.js";

/**
 * Minimum Viable Kernel acceptance test.
 *
 * Mirrors the BACKLOG Phase 1.9 checklist: init -> client -> project ->
 * opportunity -> run -> artifact -> audit, plus daily note and decision
 * record write-back. If this passes the kernel ships.
 */
describe("MVK acceptance", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-mvk-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("supports the full kernel lifecycle end to end", async () => {
    // 1. Init the workspace.
    const init = await initWorkspace({ root: dir, organizationName: "MVK Inc", preset: "agency" });
    expect(init.config.organization.name).toBe("MVK Inc");
    expect(init.config.setup.preset).toBe("agency");

    const paths = workspacePaths(dir);

    // 2. Create a client.
    const clients = new ClientRegistry(dir);
    const client = await clients.create({ name: "Acme Co", industry: "fintech" });
    expect(client.slug).toBe("acme-co");

    // 3. Create a project for that client.
    const projects = new ProjectRegistry(dir);
    const project = await projects.create({
      name: "Website",
      clientId: client.id,
      stack: "Next.js",
      repository: "github.com/acme/web",
    });
    expect(project.client_id).toBe(client.id);

    // 4. Create an opportunity for the same client.
    const opps = new OpportunityRegistry(dir);
    const opp = await opps.create({
      title: "Mobile App for Acme",
      source: "owner_intake",
      clientId: client.id,
      expectedValue: 148_000,
      expectedMargin: 38,
    });
    expect(opp.status).toBe("intake");

    // 5. Start a run; the stub dispatch should complete and produce an artifact.
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(defaultConfig("agency"), approvals);
    const audit = new AuditLog(paths.auditLog);
    const artifacts = new ArtifactStore(dir);
    const runs = new RunEngine(dir, { audit, artifacts, policy });

    const run = await runs.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "mvk-test",
      scope: "build the first executive plan",
      clientId: client.id,
      projectId: project.id,
    });
    expect(run.status).toBe("completed");
    expect(run.artifacts.length).toBe(1);

    // 6. The run should have written a run-report artifact linked to the run.
    const runArtifacts = await artifacts.list({ run_id: run.id });
    expect(runArtifacts.length).toBe(1);
    expect(runArtifacts[0]?.type).toBe("run-report");
    expect(runArtifacts[0]?.client_id).toBe(client.id);

    // 7. Write a daily note and a decision record; both must show up on disk.
    const dailyPath = await appendDailyNote(dir, "Decisions", "MVK acceptance test recorded.");
    const dailyContent = await readFile(dailyPath, "utf8");
    expect(dailyContent).toContain("MVK acceptance test recorded.");

    await appendDecision(dir, {
      actor: "test",
      what: "Adopt MVK acceptance test as the bar for Phase 1 completion",
      why: "Guards every kernel surface in one fast integration test",
      affects: [run.id],
      runId: run.id,
    });
    const decisions = await readFile(paths.decisionsLog, "utf8");
    expect(decisions).toContain("Adopt MVK acceptance test");
    expect(decisions).toContain(run.id);

    // 8. Audit log must contain entries for init, run lifecycle, and the artifact write.
    const auditContent = await readFile(paths.auditLog, "utf8");
    const events = auditContent
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { action: string });
    const actions = events.map((e) => e.action);
    expect(actions).toContain("workspace.init");
    expect(actions).toContain("run.created");
    expect(actions).toContain("run.completed");
    expect(actions).toContain("run.artifact_written");

    // 9. Policy should still block a high-risk action without approval.
    const block = await policy.evaluate({ action: "deploy_production", actor: "release" });
    expect(block.allowed).toBe(false);
    expect(block.outcome).toBe("require_approval");

    // 10. Approving a one-off action and re-evaluating must flip the outcome.
    const approval = await approvals.request({
      action: "deploy_production",
      actor: "owner",
      target: project.id,
      scope: "one-off MVK deploy approval",
      oneOff: true,
    });
    await approvals.resolve(approval.id, "approved", "owner", "MVK test allows this");
    const allow = await policy.evaluate({
      action: "deploy_production",
      actor: "release",
      target: project.id,
    });
    expect(allow.allowed).toBe(true);
    expect(allow.approval_id).toBe(approval.id);

    // 11. Opportunity remains discoverable through listing.
    const allOpps = await opps.list();
    expect(allOpps.find((o) => o.id === opp.id)?.expected_value).toBe(148_000);
  });
});
