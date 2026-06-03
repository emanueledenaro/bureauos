import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
import { ProjectRegistry, type ProjectRecord } from "../registries/project.js";
import {
  type GitHubPullRequestPublishClient,
  type GitHubPullRequestPublishClientPr,
} from "../github/pr-publisher.js";

/** Fake PR client for dispatch wiring tests: records calls, never hits GitHub. */
class RecordingPrClient implements GitHubPullRequestPublishClient {
  readonly created: Array<unknown> = [];
  async createPullRequest(
    owner: string,
    repo: string,
    input: { title: string; body: string; head: string; base: string; draft?: boolean },
  ): Promise<GitHubPullRequestPublishClientPr> {
    this.created.push({ owner, repo, input });
    return {
      owner,
      repo,
      number: this.created.length,
      title: input.title,
      url: `https://github.com/${owner}/${repo}/pull/${this.created.length}`,
      head: input.head,
      headSha: "abc",
      base: input.base,
      state: "open",
      updatedAt: "2026-05-30T00:00:00.000Z",
    };
  }
}

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

  /**
   * Provider-codegen config the owner-build relaxation gates on, with the codex
   * runtime writing a real file (the deterministic dev-edit stand-in, mirroring
   * the orchestration e2e). `push_commits` (edit_code) + `observe_signals`
   * (run_tests) are on so the ONLY remaining dev gate is `linked_issue` — exactly
   * what an owner build is meant to satisfy.
   */
  async function ownerBuildConfig() {
    const config = defaultConfig("agency");
    config.runtime.codex.enabled = true;
    config.runtime.codex.codegen_mode = "provider";
    config.runtime.codex.commands = [
      {
        command: "node",
        args: ["-e", "require('fs').writeFileSync('feature.ts','// built by the dev agent\\n')"],
        label: "edit",
      },
    ];
    config.autonomy.push_commits = true;
    config.autonomy.observe_signals = true;
    return config;
  }

  async function seedBaselineCommit() {
    await run("git", ["init", "-q"], { cwd: dir });
    await run("git", ["config", "user.email", "ci@bureauos.test"], { cwd: dir });
    await run("git", ["config", "user.name", "BureauOS CI"], { cwd: dir });
    await run("git", ["add", "."], { cwd: dir });
    await run("git", ["commit", "-q", "-m", "baseline"], { cwd: dir });
  }

  it("owner build (AB-U5): an explicit owner build satisfies linked_issue traceably so the dev agent edits code", async () => {
    const config = await ownerBuildConfig();
    const intake = await new CoordinatorIntakeService(dir, { config }).process({
      clientName: "Pizzeria Aurora",
      message: "Vuole un sito con prenotazioni.",
      source: "owner_chat",
    });
    await seedBaselineCommit();

    const result = await new ProjectDispatchService(dir, { config }).dispatch({
      projectSlug: intake.project.slug,
      runType: "feature",
      scope: "Build the booking page",
      // The explicit owner-build authorization (what the chat dispatch_build path
      // passes). No `source`/`linkedWorkItem` is supplied — the relaxation must
      // come from the owner-build signal alone.
      ownerBuild: true,
    });

    // The run carries a RECORDED owner-build work item (traceable), derived from
    // the project — `linked_issue` is satisfied by a recorded reference, not by
    // removing the gate.
    expect(result.run.source_work_item_type).toBe("owner_build");
    expect(result.run.source_work_item_id).toBe(`owner-build/${intake.project.id}`);

    const auditLog = await readFile(workspacePaths(dir).auditLog, "utf8");
    // The dev agent's edit_code/run_tests gates were NOT blocked on linked_issue:
    // the runtime actually executed the edit (not the fail-closed block).
    expect(auditLog).toContain("agent.development.runtime_executed");
    expect(auditLog).not.toContain("agent.development.runtime_blocked");
    // No capability use was blocked for the development agent's edit_code gate.
    expect(auditLog).not.toMatch(/"action":"capability\.use\.blocked"[^\n]*linked_issue/);

    // The authorization is recorded for traceability: what authorized the edit
    // (the owner build request + the work item) is an inspectable artifact + audit.
    expect(auditLog).toContain("project.dispatch.owner_build_authorized");
    // ArtifactStore.list returns the record (front matter) directly.
    const artifacts = await new ArtifactStore(dir).list({ run_id: result.run.id });
    const authorization = artifacts.find(
      (artifact) => artifact["authorization"] === "owner_build_request",
    );
    expect(authorization?.type).toBe("decision-record");
    expect(authorization?.["satisfies_gate"]).toBe("linked_issue");
    expect(authorization?.["authorizes_capability"]).toBe("codex.edit_code");
    expect(authorization?.["source_work_item_id"]).toBe(`owner-build/${intake.project.id}`);

    // The dev agent committed its edit onto the run branch — code was written.
    const repo = join(dir, "workspaces", intake.project.slug);
    const branch = `bureauos/${intake.project.slug}/${result.run.id}`;
    const committedFiles = (
      await run("git", ["show", "--name-only", "--pretty=format:", branch], { cwd: repo })
    ).stdout;
    expect(committedFiles).toContain("feature.ts");
  }, 60_000);

  it("SAFETY (AB-U5): a NON-owner feature run with the SAME config still fail-closes on linked_issue", async () => {
    // Identical provider-codegen config and pipeline as the owner build above —
    // the ONLY difference is that `ownerBuild` is not set (an autonomous /
    // scheduler / non-owner dispatch). The relaxation must NOT apply: the dev
    // agent still blocks on linked_issue and writes no code.
    const config = await ownerBuildConfig();
    const intake = await new CoordinatorIntakeService(dir, { config }).process({
      clientName: "Trattoria Belluno",
      message: "Vuole un sito con prenotazioni.",
      source: "owner_chat",
    });
    await seedBaselineCommit();

    const result = await new ProjectDispatchService(dir, { config }).dispatch({
      projectSlug: intake.project.slug,
      runType: "feature",
      scope: "Build the booking page",
      // No ownerBuild signal: this stands in for a non-owner-initiated build.
    });

    // No work item was stamped — the run has no traceable authorization, so the
    // gate stays closed.
    expect(result.run.source_work_item_type).toBe("");
    expect(result.run.source_work_item_id).toBe("");

    const auditLog = await readFile(workspacePaths(dir).auditLog, "utf8");
    // The dev runtime was BLOCKED on linked_issue and no edit was applied.
    expect(auditLog).toContain("agent.development.runtime_blocked");
    expect(auditLog).not.toContain("agent.development.runtime_executed");
    expect(auditLog).toMatch(/linked_issue/);
    // No owner-build authorization was ever recorded for a non-owner run.
    expect(auditLog).not.toContain("project.dispatch.owner_build_authorized");

    // The development step is reported as blocked (fail-closed), not completed.
    const devStep = result.dispatch.steps.find((step) => step.role === "development");
    expect(devStep?.ok).toBe(false);
  }, 60_000);

  it("provisions an isolated worktree for a dispatched code run and releases it (SER-243/241)", async () => {
    const config = defaultConfig("agency");
    config.runtime.codex.enabled = true;

    const intake = await new CoordinatorIntakeService(dir, { config }).process({
      clientName: "Trattoria Belluno",
      message: "Vuole un sito con menu e prenotazioni.",
      source: "owner_chat",
    });

    const result = await new ProjectDispatchService(dir, { config }).dispatch({
      projectSlug: intake.project.slug,
      runType: "feature",
      scope: "Build the booking page",
    });

    const repo = join(dir, "workspaces", intake.project.slug);
    // The per-project repo was provisioned (separate from the .bureauos brain)...
    expect((await stat(join(repo, ".git"))).isDirectory()).toBe(true);
    // ...a dedicated run branch was created and survives for later push/PR...
    const branch = `bureauos/${intake.project.slug}/${result.run.id}`;
    await expect(
      run("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: repo }),
    ).resolves.toBeDefined();
    // ...and the worktree itself was released (no leftover working directory).
    await expect(
      stat(join(dir, "workspaces", ".worktrees", intake.project.slug, result.run.id)),
    ).rejects.toThrow();
  }, 60_000);

  it("does NOT attempt delivery when the dispatched run is blocked (off-by-default safe, SER-241)", async () => {
    // The feature pipeline's QA legitimately blocks with no acceptance evidence,
    // so this run is blocked. Delivery must not fire: no push, no PR, no
    // delivered/blocked delivery result — today's no-delivery behavior preserved.
    const config = defaultConfig("agency");
    const intake = await new CoordinatorIntakeService(dir, { config }).process({
      clientName: "Pizzeria Aurora",
      message: "Vuole un sito con prenotazioni.",
      source: "owner_chat",
    });
    // Link a repository so the only reason delivery does not fire is the blocked run.
    await new ProjectRegistry(dir).update(intake.project.slug, {
      repository: "https://github.com/acme/site",
    });
    const github = new RecordingPrClient();

    const result = await new ProjectDispatchService(dir, {
      config,
      githubPrPublishClient: github,
    }).dispatch({
      projectSlug: intake.project.slug,
      runType: "feature",
      scope: "Prepare dev-ready work for booking website MVP",
    });

    expect(result.dispatch.steps.some((step) => !step.ok)).toBe(true);
    expect(result.delivery).toBeUndefined();
    expect(github.created).toHaveLength(0);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).not.toContain("project.dispatch.delivered");
    expect(audit).not.toContain("project.dispatch.branch_pushed");
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
    // The run's final status reflects the real pipeline outcome, not the
    // dispatcher-less stub completion (so the owner build card shows "blocked").
    expect(result.run.status).toBe("blocked");

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
