import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { OpportunityRegistry } from "../registries/opportunity.js";
import { GitHubWebhookIngestionService } from "./webhook-ingestion.js";

describe("GitHubWebhookIngestionService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-github-webhook-"));
    await initWorkspace({ root: dir, organizationName: "Webhook Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("turns opened GitHub issues into memory signals and opportunities", async () => {
    const result = await new GitHubWebhookIngestionService(dir).ingest({
      event: "issues",
      deliveryId: "delivery-1",
      payload: {
        action: "opened",
        repository: {
          name: "web",
          full_name: "acme/web",
          owner: { login: "acme" },
        },
        issue: {
          number: 7,
          title: "Booking form fails on mobile",
          html_url: "https://github.com/acme/web/issues/7",
          labels: [{ name: "type:bug" }],
          state: "open",
          updated_at: "2026-05-24T10:00:00.000Z",
        },
      },
    });

    expect(result.repository).toBe("acme/web");
    expect(result.issues).toHaveLength(1);
    expect(result.createdOpportunities.map((opportunity) => opportunity.source)).toEqual([
      "github:acme/web#7",
    ]);
    expect(result.report.type).toBe("github-signal-report");

    const report = await new ArtifactStore(dir).read(result.report.id);
    expect(report?.body).toContain("GitHub Webhook Signal");
    expect(report?.body).toContain("Booking form fails on mobile");

    const opportunities = await new OpportunityRegistry(dir).list();
    expect(opportunities).toHaveLength(1);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.issue_webhook.ingested");
    expect(audit).toContain("github.webhook.ingested");
  });

  it("classifies failing check_run webhooks", async () => {
    const result = await new GitHubWebhookIngestionService(dir).ingest({
      event: "check_run",
      deliveryId: "delivery-2",
      payload: {
        action: "completed",
        repository: {
          name: "web",
          full_name: "acme/web",
          owner: { login: "acme" },
        },
        check_run: {
          id: 91,
          name: "ci / test",
          html_url: "https://github.com/acme/web/actions/runs/91",
          status: "completed",
          conclusion: "failure",
          head_sha: "abc123def456",
          started_at: "2026-05-24T08:00:00.000Z",
          completed_at: "2026-05-24T08:04:00.000Z",
        },
      },
    });

    expect(result.checks).toHaveLength(1);
    expect(result.failingChecks.map((check) => check.name)).toEqual(["ci / test"]);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.check_failed.detected");
  });

  it("suppresses a re-delivered webhook with the same delivery id (SER-176)", async () => {
    const service = new GitHubWebhookIngestionService(dir);
    const payload = {
      action: "opened",
      repository: { name: "web", full_name: "acme/web", owner: { login: "acme" } },
      issue: {
        number: 9,
        title: "Retry duplicate signal",
        html_url: "https://github.com/acme/web/issues/9",
        labels: [{ name: "type:bug" }],
        state: "open",
        updated_at: "2026-05-24T10:00:00.000Z",
      },
    };

    const first = await service.ingest({ event: "issues", deliveryId: "delivery-dup", payload });
    expect(first.status).toBe("ingested");

    const reportsAfterFirst = await new ArtifactStore(dir).list({ type: "github-signal-report" });
    const opportunitiesAfterFirst = await new OpportunityRegistry(dir).list();

    // Same delivery id arrives again (GitHub retry): no new artifact, no new
    // opportunity, and the result is flagged duplicate.
    const second = await service.ingest({ event: "issues", deliveryId: "delivery-dup", payload });
    expect(second.status).toBe("duplicate");
    expect(second.report.id).toBe(first.report.id);

    const reportsAfterSecond = await new ArtifactStore(dir).list({ type: "github-signal-report" });
    expect(reportsAfterSecond).toHaveLength(reportsAfterFirst.length);
    const opportunitiesAfterSecond = await new OpportunityRegistry(dir).list();
    expect(opportunitiesAfterSecond).toHaveLength(opportunitiesAfterFirst.length);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.webhook.duplicate_skipped");
  });

  it("drops a malformed issue payload without throwing (SER-212)", async () => {
    const result = await new GitHubWebhookIngestionService(dir).ingest({
      event: "issues",
      deliveryId: "malformed-1",
      payload: {
        action: "opened",
        repository: { name: "web", full_name: "acme/web", owner: { login: "acme" } },
        issue: "not-an-object",
      },
    });
    expect(result.repository).toBe("acme/web");
    expect(result.issues).toEqual([]);
    expect(result.createdOpportunities).toEqual([]);
  });

  it("filters non-string labels off an issue (SER-212)", async () => {
    const result = await new GitHubWebhookIngestionService(dir).ingest({
      event: "issues",
      deliveryId: "labels-1",
      payload: {
        action: "opened",
        repository: { name: "web", full_name: "acme/web", owner: { login: "acme" } },
        issue: {
          number: 5,
          title: "Mixed labels",
          html_url: "https://github.com/acme/web/issues/5",
          labels: [{ name: "type:bug" }, 42, null, "raw-string", { nope: true }],
          state: "open",
          updated_at: "2026-05-24T10:00:00.000Z",
        },
      },
    });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.labels).toEqual(["type:bug", "raw-string"]);
  });

  it("normalizes an unknown check_run conclusion/status and does not flag it failing (SER-212)", async () => {
    const result = await new GitHubWebhookIngestionService(dir).ingest({
      event: "check_run",
      deliveryId: "check-unknown-1",
      payload: {
        action: "completed",
        repository: { name: "web", full_name: "acme/web", owner: { login: "acme" } },
        check_run: {
          id: 77,
          name: "weird",
          html_url: "https://github.com/acme/web/actions/runs/77",
          status: "bizarre-status",
          conclusion: "made-up",
          head_sha: "deadbeef",
        },
      },
    });
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]!.status).toBe("completed");
    expect(result.checks[0]!.conclusion).toBeNull();
    expect(result.failingChecks).toEqual([]);
  });
});
