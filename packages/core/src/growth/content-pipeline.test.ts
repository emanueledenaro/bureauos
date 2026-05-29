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
import { GrowthContentPipelineService } from "./content-pipeline.js";
import { GrowthMemoryService } from "./memory.js";

describe("GrowthContentPipelineService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-growth-content-"));
    await initWorkspace({ root: dir, organizationName: "Growth Content", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("generates approval-gated growth drafts from memory and revenue context", async () => {
    await new GrowthMemoryService(dir).update({
      brand: "BureauOS is an AAAS operating room for owner-led software companies.",
      offers: "Autonomous delivery operations, client memory, and growth execution.",
      channels: "X, LinkedIn, GitHub.",
      actor: "owner",
    });
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

    const result = await new GrowthContentPipelineService(dir).generate({
      maxDrafts: 4,
      focus: "AAAS launch",
      runId: "run_growth_content",
      now: new Date("2026-05-25T10:00:00.000Z"),
    });

    expect(result.memory_ready).toBe(true);
    expect(result.pipeline_value).toBe(12000);
    expect(result.open_opportunities).toBe(1);
    expect(result.report).toMatchObject({
      type: "content-pipeline-report",
      run_id: "run_growth_content",
      status: "submitted",
      draft_count: 4,
      memory_ready: true,
    });
    expect(result.drafts.map((draft) => draft.kind)).toEqual([
      "social",
      "campaign",
      "creative",
      "ads",
    ]);
    expect(result.drafts.every((draft) => draft.approval_required)).toBe(true);
    expect(result.drafts.every((draft) => draft.opportunity_id === opportunity.id)).toBe(true);
    expect(result.compliance_review).toMatchObject({
      type: "compliance-review",
      approval_required: true,
      source: "growth.content_pipeline",
    });
    expect(result.approvals.map((approval) => approval.action).sort()).toEqual([
      "launch_ad_campaigns",
      "publish_public_content",
      "publish_social_posts",
      "run_paid_ads",
    ]);

    const draft = await new ArtifactStore(dir).read(result.drafts[0]?.artifact.id ?? "");
    expect(draft?.record).toMatchObject({
      type: "social-post-brief",
      status: "draft",
      client_id: client.id,
      opportunity_id: opportunity.id,
      approval_required: true,
    });
    expect(draft?.body).toContain("Publishing, paid spend, client contact");
    expect(draft?.body).toContain("Do not name the client");

    const report = await new ArtifactStore(dir).read(result.report.id);
    expect(report?.body).toContain("# Content Pipeline Report");
    expect(report?.body).toContain("Open pipeline: $12,000");
    expect(report?.record.approval_ids).toEqual(result.approvals.map((approval) => approval.id));

    const approvals = await new ApprovalRegistry(dir).listPending();
    expect(approvals).toHaveLength(4);
    expect(approvals[0]).toMatchObject({
      source: expect.stringContaining("growth.content_pipeline:"),
      limit: expect.stringContaining("paid spend 0"),
      expires_at: "2026-06-01T10:00:00.000Z",
    });

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("growth.content_pipeline.generated");
    expect(log).toContain("external_commitment.approval_requested");
  });

  it("writes a blocked report when growth memory is incomplete", async () => {
    const result = await new GrowthContentPipelineService(dir).generate({
      now: new Date("2026-05-25T10:00:00.000Z"),
    });

    expect(result.memory_ready).toBe(false);
    expect(result.drafts).toEqual([]);
    expect(result.missing_sections).toEqual(
      expect.arrayContaining(["brand", "offers", "channels"]),
    );
    expect(result.report).toMatchObject({
      type: "content-pipeline-report",
      status: "submitted",
      draft_count: 0,
      memory_ready: false,
    });

    const report = await new ArtifactStore(dir).read(result.report.id);
    expect(report?.body).toContain("Blocked before draft generation");
    expect(report?.body).toContain("No content was published");

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("growth.content_pipeline.blocked");
  });
});
