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
});
