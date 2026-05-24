import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../../artifacts/store.js";
import { AuditLog } from "../../audit/log.js";
import { defaultConfig } from "../../config/loader.js";
import { PolicyEngine } from "../../policy/engine.js";
import { ApprovalRegistry } from "../../registries/approval.js";
import { initWorkspace } from "../../init/initializer.js";
import { workspacePaths } from "../../paths.js";
import { buildDefaultAgentRegistry } from "./index.js";

describe("concrete agents", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-concrete-"));
    await initWorkspace({ root: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("each concrete agent writes the artifact type that matches its role", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const registry = buildDefaultAgentRegistry({ artifacts, audit, policy });

    const expectedArtifactTypes: Record<string, string> = {
      project_manager: "run-report",
      product: "feature-spec",
      development: "technical-plan",
      qa: "test-plan",
      security: "security-review",
      compliance: "compliance-review",
    };

    for (const [roleId, expectedType] of Object.entries(expectedArtifactTypes)) {
      const agent = registry.get(roleId);
      const out = await agent.execute({
        context: { runId: `run_test_${roleId}`, scope: "smoke test" },
        capabilities: new Map(),
      });
      expect(out.ok).toBe(true);
      expect(out.artifactIds.length).toBe(1);
      const written = await artifacts.read(out.artifactIds[0]!);
      expect(written?.record.type).toBe(expectedType);
      expect(written?.record.created_by).toBe(roleId);
    }
  });

  it("every templated agent role writes its signature artifact", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const registry = buildDefaultAgentRegistry({ artifacts, audit, policy });

    const templated: Record<string, string> = {
      supreme_coordinator: "executive-report",
      ux: "design-spec",
      reviewer: "pr-review",
      release: "run-report",
      visibility: "brand-brief",
      content: "social-post-brief",
      social: "social-post-brief",
      creative: "creative-brief",
      ads: "ad-campaign-brief",
      marketing: "campaign-brief",
      conversion: "conversion-audit",
      sales: "lead-qualification-report",
      pricing: "pricing-brief",
      proposal: "proposal-brief",
      client_success: "client-account-plan",
    };

    for (const [roleId, expectedType] of Object.entries(templated)) {
      const agent = registry.get(roleId);
      expect(agent.definition.id).toBe(roleId);
      const out = await agent.execute({
        context: { runId: `run_${roleId}`, scope: "stub run" },
        capabilities: new Map(),
      });
      expect(out.ok).toBe(true);
      expect(out.artifactIds.length).toBe(1);
      const written = await artifacts.read(out.artifactIds[0]!);
      expect(written?.record.type).toBe(expectedType);
      expect(written?.record.created_by).toBe(roleId);
    }
  });
});
