import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { defaultConfig } from "../config/loader.js";
import { CoordinatorIntakeService } from "../coordinator/intake.js";
import { buildCodexRuntimeFromConfig } from "../execution/codex-runtime.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { ProjectDispatchService, pendingProjectApprovals } from "./project-dispatch.js";
import type { ApprovalRecord } from "../registries/approval.js";
import type { ProjectRecord } from "../registries/project.js";

const run = promisify(execFile);

function projectRecord(id: string, name: string): ProjectRecord {
  return {
    id,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    client_id: "client_x",
    status: "in_progress",
    repository: "",
    stack: "",
    created: "2026-05-30T00:00:00.000Z",
    updated: "2026-05-30T00:00:00.000Z",
  };
}

function approvalFor(target: string, scope: string): ApprovalRecord {
  return {
    id: `approval_${target}`,
    action: "send_final_proposals",
    actor: "supreme_coordinator",
    target,
    scope,
    source: "",
    limit: "",
    run_id: "",
    risk_level: "medium",
    status: "pending",
    expires_at: "",
    one_off: false,
    recurring: false,
    created: "2026-05-30T00:00:00.000Z",
    updated: "2026-05-30T00:00:00.000Z",
    resolved_at: "",
    resolved_by: "",
    reason: "",
    consumed_at: "",
  };
}

describe("pendingProjectApprovals (SER-179)", () => {
  it("matches approvals by project id, not by name substring", () => {
    const projectA = projectRecord("project_a", "CRM");
    const projectB = projectRecord("project_b", "CRM Redesign");
    // Each approval targets its own project id; scopes mention both names so the
    // old substring branch would cross-match.
    const approvalA = approvalFor("project_a", "Approve CRM work for CRM Redesign context");
    const approvalB = approvalFor("project_b", "Approve CRM Redesign work");

    const forA = pendingProjectApprovals([approvalA, approvalB], projectA);
    const forB = pendingProjectApprovals([approvalA, approvalB], projectB);

    expect(forA.map((a) => a.id)).toEqual(["approval_project_a"]);
    expect(forB.map((a) => a.id)).toEqual(["approval_project_b"]);
  });

  it("still matches an approval carrying a project_id front-matter field", () => {
    const project = projectRecord("project_c", "Booking");
    const approval = { ...approvalFor("*", "wildcard"), project_id: "project_c" } as ApprovalRecord;
    expect(pendingProjectApprovals([approval], project).map((a) => a.id)).toEqual(["approval_*"]);
  });
});

describe("ProjectDispatchService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-project-dispatch-"));
    await initWorkspace({ root: dir, organizationName: "Dispatch Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("routes a dispatched feature run to the REAL codex runtime and fail-closed-blocks an ungated code change (SER-239)", async () => {
    const config = defaultConfig("agency");
    config.runtime.codex.enabled = true;
    config.runtime.codex.commands = [
      {
        command: "node",
        args: ["-e", "require('fs').writeFileSync('feature.ts','// built by the dev agent\\n')"],
        label: "edit",
      },
    ];
    // The development agent's gates: edit_code -> push_commits, run_tests -> observe_signals.
    config.autonomy.push_commits = true;
    config.autonomy.observe_signals = true;

    const intake = await new CoordinatorIntakeService(dir, { config }).process({
      clientName: "Pizzeria Aurora",
      message: "Vuole un sito con prenotazioni.",
      source: "owner_chat",
    });

    // Commit a clean baseline AFTER intake so the dev run's diff is just its
    // own edit (and well under the runtime's changed-file limit).
    await run("git", ["init", "-q"], { cwd: dir });
    await run("git", ["config", "user.email", "ci@bureauos.test"], { cwd: dir });
    await run("git", ["config", "user.name", "BureauOS CI"], { cwd: dir });
    await run("git", ["add", "."], { cwd: dir });
    await run("git", ["commit", "-q", "-m", "baseline"], { cwd: dir });

    // The dispatch service builds the codex runtime from config internally
    // (buildDevelopmentExecution); assert the config is actually runtime-enabled
    // before we rely on that path.
    expect(buildCodexRuntimeFromConfig(config)).toBeDefined();

    await new ProjectDispatchService(dir, { config }).dispatch({
      projectSlug: intake.project.slug,
      runType: "feature",
      scope: "Build the booking page",
    });

    // The wiring reached the REAL runtime path — not the template-only fallback...
    const auditLog = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(auditLog).not.toContain("agent.development.template_only");
    // ...and the fail-closed safety correctly blocked an autonomous code change
    // that lacks a linked issue + test evidence (the "stop and ask" behavior),
    // so no real edit was applied.
    expect(auditLog).toContain("agent.development.runtime_blocked");
    expect(auditLog).toMatch(/tests_required|linked_issue/);
  }, 60_000);

  it("creates project-scoped dispatch and handoff packets before running specialist agents", async () => {
    const intake = await new CoordinatorIntakeService(dir, {
      config: defaultConfig("agency"),
    }).process({
      clientName: "Pizzeria Aurora",
      message:
        "Oggi ho parlato con una pizzeria: vuole un sito con prenotazioni, identita, logo, posizione e contenuti.",
      source: "owner_chat",
    });

    const result = await new ProjectDispatchService(dir, {
      config: defaultConfig("agency"),
    }).dispatch({
      projectSlug: intake.project.slug,
      runType: "feature",
      scope: "Prepare dev-ready work for booking website MVP",
      briefing: "Create the first implementation-ready delivery packet.",
    });

    // The feature pipeline runs real concrete agents; QA legitimately blocks
    // when no acceptance evidence is attached, so this dispatch is truthfully
    // blocked rather than a clean completion (SER-185).
    const blockedSteps = result.dispatch.steps.filter((step) => !step.ok);
    expect(blockedSteps.length).toBeGreaterThan(0);

    expect(result.project.id).toBe(intake.project.id);
    expect(result.client?.id).toBe(intake.client.id);
    expect(result.ownership).toMatchObject({
      project_id: intake.project.id,
      manager_agent_id: "project_manager",
      escalation_agent_id: "supreme_coordinator",
    });
    expect(result.pipeline).toEqual(["product", "ux", "development", "qa", "security", "reviewer"]);
    expect(result.packet.type).toBe("project-dispatch-packet");
    expect(result.handoffs).toHaveLength(6);
    expect(result.handoffs.map((handoff) => handoff.role)).toEqual(result.pipeline);
    expect(result.run.artifacts).toEqual(
      expect.arrayContaining([
        result.packet.id,
        ...result.handoffs.map((handoff) => handoff.artifact.id),
      ]),
    );

    const artifacts = await new ArtifactStore(dir).list({ run_id: result.run.id });
    expect(artifacts.map((artifact) => artifact.type)).toEqual(
      expect.arrayContaining([
        "project-dispatch-packet",
        "agent-handoff",
        "feature-spec",
        "design-spec",
        "technical-plan",
        "test-plan",
        "security-review",
        "pr-review",
      ]),
    );

    const packet = await new ArtifactStore(dir).read(result.packet.id);
    expect(packet?.body).toContain("Memory Boundary");
    expect(packet?.body).toContain("Allowed project memory");
    expect(packet?.body).toContain("Project Manager Ownership");
    expect(packet?.body).toContain("Manager agent: project_manager");
    expect(packet?.body).toContain("Source Artifacts");

    const developmentHandoff = await new ArtifactStore(dir).read(
      result.handoffs.find((handoff) => handoff.role === "development")!.artifact.id,
    );
    expect(developmentHandoff?.record).toMatchObject({
      type: "agent-handoff",
      source_agent_id: "project_manager",
      target_agent_id: "development",
      scope: "Prepare dev-ready work for booking website MVP",
      dispatch_packet_id: result.packet.id,
    });
    expect(developmentHandoff?.record.input_artifact_ids).toContain(result.packet.id);
    expect(developmentHandoff?.record.expected_output_types).toEqual(["technical-plan"]);
    expect(developmentHandoff?.record.acceptance_checks).toHaveLength(4);
    expect(developmentHandoff?.body).toContain("## Contract");
    expect(developmentHandoff?.body).toContain("## Acceptance Checks");

    const runs = await readFile(
      join(workspacePaths(dir).projectsDir, intake.project.slug, "RUNS.md"),
      "utf8",
    );
    expect(runs).toContain(`Dispatch ${result.run.id}`);
    expect(runs).toContain("Project Manager: project_manager");
    expect(runs).toContain(result.packet.id);
    expect(runs).toContain("Result: blocked");

    // Truthful blocked propagation (SER-185): error audit, RISKS.md entry, and
    // the blocker surfaced in the summary and next actions.
    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("project.dispatch.blocked");
    expect(audit).toContain('"result":"error"');
    expect(audit).not.toContain("project.dispatch.completed");

    const risks = await readFile(
      join(workspacePaths(dir).projectsDir, intake.project.slug, "RISKS.md"),
      "utf8",
    );
    expect(risks).toContain(`Dispatch ${result.run.id} blocked`);

    expect(result.summary).toContain("blocked");
    expect(result.next_actions.join(" ")).toContain("Resolve specialist blockers");
  });
});
