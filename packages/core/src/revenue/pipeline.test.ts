import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { ClientRegistry } from "../registries/client.js";
import { OpportunityRegistry } from "../registries/opportunity.js";
import { RevenuePipelineService } from "./pipeline.js";

describe("RevenuePipelineService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-revenue-pipeline-"));
    await initWorkspace({ root: dir, organizationName: "Revenue Pipeline", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("qualifies high-fit opportunities and drafts pricing/proposal artifacts", async () => {
    const client = await new ClientRegistry(dir).create({
      name: "Nebula Studios",
      status: "active",
      industry: "software",
    });
    const opportunity = await new OpportunityRegistry(dir).create({
      title: "AAAS Launch Package",
      source: "owner_pipeline",
      clientId: client.id,
      expectedValue: 12000,
      expectedMargin: 55,
    });

    const result = await new RevenuePipelineService(dir).generate({
      runId: "run_revenue_pipeline",
      now: new Date("2026-05-25T10:00:00.000Z"),
    });

    expect(result.report).toMatchObject({
      type: "revenue-pipeline-report",
      run_id: "run_revenue_pipeline",
      pipeline_value: 12000,
      open_opportunities: 1,
      proposal_ready_count: 1,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      fit: "high",
      stage: "proposal_ready",
      score: expect.any(Number),
    });
    expect(result.items[0]?.artifacts.map((artifact) => artifact.type)).toEqual([
      "lead-qualification-report",
      "pricing-brief",
      "proposal-brief",
      "compliance-review",
    ]);
    expect(result.items[0]?.approvals.map((approval) => approval.action).sort()).toEqual([
      "change_pricing",
      "send_client_messages",
      "send_final_proposals",
    ]);

    const updated = await new OpportunityRegistry(dir).get(opportunity.id);
    expect(updated).toMatchObject({
      status: "proposal_draft",
      qualification_status: "qualified",
      proposal_status: "draft_ready",
      pricing_status: "draft_ready",
    });

    const proposal = await new ArtifactStore(dir).read(result.items[0]?.artifacts[2]?.id ?? "");
    expect(proposal?.body).toContain("# Proposal Brief");
    expect(proposal?.body).toContain("Client contact allowed: no");
    const compliance = await new ArtifactStore(dir).read(result.items[0]?.artifacts[3]?.id ?? "");
    expect(compliance?.body).toContain("# Compliance Review");
    expect(compliance?.body).toContain("send_final_proposals");

    const approvals = await new ApprovalRegistry(dir).listPending();
    expect(approvals).toHaveLength(3);
    expect(approvals[0]).toMatchObject({
      source: expect.stringContaining("revenue.pipeline:"),
      limit: expect.stringContaining("Draft value $12,000"),
      expires_at: "2026-06-01T10:00:00.000Z",
    });

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("revenue.pipeline.generated");
    expect(log).toContain("external_commitment.approval_requested");
  });

  it("creates a conversion audit when no opportunity is ready", async () => {
    const result = await new RevenuePipelineService(dir).generate({
      now: new Date("2026-05-25T10:00:00.000Z"),
    });

    expect(result.items).toEqual([]);
    expect(result.open_opportunities).toBe(0);
    expect(result.report).toMatchObject({
      type: "revenue-pipeline-report",
      opportunity_count: 0,
    });

    const artifacts = await new ArtifactStore(dir).list({ type: "conversion-audit" });
    expect(artifacts).toHaveLength(1);
    const audit = await new ArtifactStore(dir).read(artifacts[0]?.id ?? "");
    expect(audit?.body).toContain("No qualified opportunity is currently available");
  });
});
