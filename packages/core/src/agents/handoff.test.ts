import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { agentHandoffMetadata, validateAgentHandoff } from "./handoff.js";

describe("agent handoff contracts", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-agent-handoff-"));
    await initWorkspace({ root: dir, organizationName: "Handoff Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("validates a complete handoff for the target agent", async () => {
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const handoff = await artifacts.write({
      type: "agent-handoff",
      createdBy: "project_manager",
      runId: "run_handoff",
      projectId: "project_1",
      clientId: "client_1",
      metadata: agentHandoffMetadata({
        sourceAgentId: "project_manager",
        targetAgentId: "development",
        runId: "run_handoff",
        projectId: "project_1",
        clientId: "client_1",
        scope: "Implement booking checkout",
        dispatchPacketId: "art_packet",
        inputArtifactIds: ["art_packet", "art_spec"],
        expectedOutputTypes: ["technical-plan"],
        acceptanceChecks: ["Development produces a technical plan or explicit blocker."],
      }),
      body: "# Agent Handoff",
    });

    const result = await validateAgentHandoff(
      {
        context: {
          runId: "run_handoff",
          scope: "Implement booking checkout",
          handoffArtifactId: handoff.id,
        },
        capabilities: new Map(),
      },
      { artifacts, audit },
      "development",
    );

    expect(result.ok).toBe(true);
    expect(result.contract).toMatchObject({
      sourceAgentId: "project_manager",
      targetAgentId: "development",
      scope: "Implement booking checkout",
      inputArtifactIds: ["art_packet", "art_spec"],
      expectedOutputTypes: ["technical-plan"],
    });
    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("agent.handoff.validated");
  });

  it("fails with an actionable artifact when required fields are missing", async () => {
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const handoff = await artifacts.write({
      type: "agent-handoff",
      createdBy: "project_manager",
      runId: "run_handoff",
      metadata: {
        source_agent_id: "project_manager",
        target_agent_id: "qa",
        run_id: "run_handoff",
        scope: "Verify checkout",
        input_artifact_ids: ["art_packet"],
        expected_output_types: ["test-plan"],
      },
      body: "# Broken Handoff",
    });

    const result = await validateAgentHandoff(
      {
        context: {
          runId: "run_handoff",
          scope: "Verify checkout",
          handoffArtifactId: handoff.id,
        },
        capabilities: new Map(),
      },
      { artifacts, audit },
      "qa",
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("missing acceptance_checks");
    expect(result.artifact?.type).toBe("agent-handoff-validation");
    const validation = await artifacts.read(result.artifact!.id);
    expect(validation?.body).toContain("Required Fix");
    expect(validation?.body).toContain("missing acceptance_checks");
  });

  it("fails with an actionable artifact when routed to the wrong target agent", async () => {
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const handoff = await artifacts.write({
      type: "agent-handoff",
      createdBy: "project_manager",
      runId: "run_handoff",
      metadata: agentHandoffMetadata({
        sourceAgentId: "project_manager",
        targetAgentId: "reviewer",
        runId: "run_handoff",
        scope: "Review checkout",
        dispatchPacketId: "art_packet",
        inputArtifactIds: ["art_packet"],
        expectedOutputTypes: ["pr-review"],
        acceptanceChecks: ["Reviewer produces a PR review or explicit blocker."],
      }),
      body: "# Agent Handoff",
    });

    const result = await validateAgentHandoff(
      {
        context: {
          runId: "run_handoff",
          scope: "Review checkout",
          handoffArtifactId: handoff.id,
        },
        capabilities: new Map(),
      },
      { artifacts, audit },
      "qa",
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("wrong target_agent_id: expected qa, got reviewer");
    const validation = await artifacts.read(result.artifact!.id);
    expect(validation?.record.expected_agent_id).toBe("qa");
    expect(validation?.record.actual_target_agent_id).toBe("reviewer");
    expect(validation?.body).toContain("Route the handoff only to the target agent");
  });
});
