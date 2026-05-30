import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { workspacePaths } from "../paths.js";
import { ClientRegistry } from "../registries/client.js";
import { OpportunityRegistry, type OpportunityRecord } from "../registries/opportunity.js";
import { createGitHubIssueOpportunities } from "./opportunity-import.js";
import type {
  GitHubSignalCheckConclusion,
  GitHubSignalCheckRun,
  GitHubSignalIssue,
  GitHubSignalPullRequest,
} from "./signal-sync.js";

export interface GitHubWebhookIngestInput {
  event: string;
  payload: unknown;
  deliveryId?: string;
  source?: string;
  clientSlug?: string;
}

export interface GitHubWebhookIngestResult {
  event: string;
  action: string;
  repository: string;
  issues: readonly GitHubSignalIssue[];
  pullRequests: readonly GitHubSignalPullRequest[];
  checks: readonly GitHubSignalCheckRun[];
  failingChecks: readonly GitHubSignalCheckRun[];
  createdOpportunities: OpportunityRecord[];
  report: ArtifactRecord;
  /** "duplicate" when a prior delivery with the same id was already ingested. */
  status: "ingested" | "duplicate";
}

export interface GitHubWebhookIngestionDeps {
  artifacts?: ArtifactStore;
  audit?: AuditLog;
  clients?: ClientRegistry;
  opportunities?: OpportunityRegistry;
}

type JsonRecord = Record<string, unknown>;

const FAILING_CONCLUSIONS = new Set<GitHubSignalCheckConclusion>([
  "failure",
  "timed_out",
  "action_required",
  "startup_failure",
  "cancelled",
  "stale",
]);

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function labelsFrom(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    const record = asRecord(item);
    const name = stringValue(record["name"]);
    return name ? [name] : [];
  });
}

function repositoryFrom(payload: JsonRecord): { owner: string; repo: string; repository: string } {
  const repository = asRecord(payload["repository"]);
  const ownerRecord = asRecord(repository["owner"]);
  const name = stringValue(repository["name"]);
  const fullName = stringValue(repository["full_name"]);
  const [fullOwner, fullRepo] = fullName.includes("/") ? fullName.split("/") : ["", ""];
  const owner = stringValue(ownerRecord["login"]) || fullOwner;
  const repo = name || fullRepo;
  if (!owner || !repo) throw new Error("GitHub webhook repository is missing owner or repo");
  return { owner, repo, repository: `${owner}/${repo}` };
}

function parseIssue(payload: JsonRecord, owner: string, repo: string): GitHubSignalIssue[] {
  const issue = asRecord(payload["issue"]);
  if (!issue["number"]) return [];
  return [
    {
      owner,
      repo,
      number: numberValue(issue["number"]),
      title: stringValue(issue["title"]),
      url: stringValue(issue["html_url"]),
      labels: labelsFrom(issue["labels"]),
      state: stringValue(issue["state"]) === "closed" ? "closed" : "open",
      updatedAt: stringValue(issue["updated_at"]),
    },
  ];
}

function parsePullRequest(
  payload: JsonRecord,
  owner: string,
  repo: string,
): GitHubSignalPullRequest[] {
  const pr = asRecord(payload["pull_request"]);
  if (!pr["number"]) return [];
  const head = asRecord(pr["head"]);
  const base = asRecord(pr["base"]);
  const merged = pr["merged"] === true;
  const rawState = stringValue(pr["state"]);
  return [
    {
      owner,
      repo,
      number: numberValue(pr["number"]),
      title: stringValue(pr["title"]),
      url: stringValue(pr["html_url"]),
      head: stringValue(head["ref"]),
      headSha: stringValue(head["sha"]),
      base: stringValue(base["ref"]),
      state: merged ? "merged" : rawState === "closed" ? "closed" : "open",
      updatedAt: stringValue(pr["updated_at"]),
    },
  ];
}

function checkConclusion(value: unknown): GitHubSignalCheckConclusion {
  const raw = stringValue(value);
  if (
    raw === "success" ||
    raw === "failure" ||
    raw === "neutral" ||
    raw === "cancelled" ||
    raw === "skipped" ||
    raw === "timed_out" ||
    raw === "action_required" ||
    raw === "startup_failure" ||
    raw === "stale"
  ) {
    return raw;
  }
  return null;
}

function checkStatus(value: unknown): GitHubSignalCheckRun["status"] {
  const raw = stringValue(value);
  if (
    raw === "queued" ||
    raw === "in_progress" ||
    raw === "completed" ||
    raw === "waiting" ||
    raw === "requested" ||
    raw === "pending"
  ) {
    return raw;
  }
  return "completed";
}

function parseCheckRun(payload: JsonRecord, owner: string, repo: string): GitHubSignalCheckRun[] {
  const check = asRecord(payload["check_run"]);
  if (!check["id"]) return [];
  return [
    {
      owner,
      repo,
      id: numberValue(check["id"]),
      name: stringValue(check["name"]),
      url: stringValue(check["html_url"]),
      status: checkStatus(check["status"]),
      conclusion: checkConclusion(check["conclusion"]),
      headSha: stringValue(check["head_sha"]),
      startedAt: stringValue(check["started_at"]),
      completedAt: stringValue(check["completed_at"]),
    },
  ];
}

function isFailingCheck(check: GitHubSignalCheckRun): boolean {
  return check.status === "completed" && FAILING_CONCLUSIONS.has(check.conclusion);
}

function bodyFor(args: {
  event: string;
  action: string;
  repository: string;
  deliveryId: string;
  issues: readonly GitHubSignalIssue[];
  pullRequests: readonly GitHubSignalPullRequest[];
  checks: readonly GitHubSignalCheckRun[];
  failingChecks: readonly GitHubSignalCheckRun[];
  createdOpportunities: readonly OpportunityRecord[];
}): string {
  return `# GitHub Webhook Signal

## Source

- Event: ${args.event}
- Action: ${args.action || "(none)"}
- Delivery: ${args.deliveryId || "(none)"}
- Repository: ${args.repository}

## Classified Signals

- Issues: ${args.issues.length}
- Pull requests: ${args.pullRequests.length}
- Check runs: ${args.checks.length}
- Failing checks: ${args.failingChecks.length}
- New opportunities: ${args.createdOpportunities.length}

## Issues

${
  args.issues.length
    ? args.issues
        .map((issue) => `- #${issue.number} ${issue.state} ${issue.title} (${issue.url})`)
        .join("\n")
    : "- none"
}

## Pull Requests

${
  args.pullRequests.length
    ? args.pullRequests
        .map((pr) => `- #${pr.number} ${pr.state} ${pr.title} (${pr.url})`)
        .join("\n")
    : "- none"
}

## Checks

${
  args.checks.length
    ? args.checks
        .map(
          (check) =>
            `- ${check.name} ${check.conclusion ?? check.status} on ${check.headSha.slice(0, 12)} (${check.url})`,
        )
        .join("\n")
    : "- none"
}

## Autonomous Interpretation

BureauOS received this event without owner prompting, persisted it as company memory, and classified whether it should become delivery, QA, or opportunity work.
`;
}

export class GitHubWebhookIngestionService {
  private readonly artifacts: ArtifactStore;
  private readonly audit: AuditLog;
  private readonly clients: ClientRegistry;
  private readonly opportunities: OpportunityRegistry;

  constructor(
    private readonly workspaceRoot: string,
    deps: GitHubWebhookIngestionDeps = {},
  ) {
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
    this.clients = deps.clients ?? new ClientRegistry(workspaceRoot);
    this.opportunities = deps.opportunities ?? new OpportunityRegistry(workspaceRoot);
  }

  async ingest(input: GitHubWebhookIngestInput): Promise<GitHubWebhookIngestResult> {
    const event = input.event.trim();
    if (!event) throw new Error("GitHub webhook event is required");

    const payload = asRecord(input.payload);
    const action = stringValue(payload["action"]);
    const { owner, repo, repository } = repositoryFrom(payload);

    // Idempotency (SER-176): GitHub retries deliveries (non-2xx, timeouts, manual
    // redelivery). If a signal report already exists for this delivery id, skip
    // re-ingestion so retries don't duplicate artifacts, per-signal audit
    // records, or opportunity writes. One audit note records the skip.
    const deliveryId = input.deliveryId?.trim();
    if (deliveryId) {
      const priorReports = await this.artifacts.list({ type: "github-signal-report" });
      const seen = priorReports.find((artifact) => artifact["delivery_id"] === deliveryId);
      if (seen) {
        await this.audit.append({
          actor: "github",
          action: "github.webhook.duplicate_skipped",
          target: `${repository}:${event}${action ? `:${action}` : ""}`,
          capability: "github.webhook",
          artifact_id: seen.id,
          result: "ok",
        });
        return {
          event,
          action,
          repository,
          issues: [],
          pullRequests: [],
          checks: [],
          failingChecks: [],
          createdOpportunities: [],
          report: seen,
          status: "duplicate",
        };
      }
    }

    const issues = event === "issues" ? parseIssue(payload, owner, repo) : [];
    const pullRequests = event === "pull_request" ? parsePullRequest(payload, owner, repo) : [];
    const checks = event === "check_run" ? parseCheckRun(payload, owner, repo) : [];
    const failingChecks = checks.filter(isFailingCheck);
    const createdOpportunities =
      event === "issues" && (action === "opened" || action === "reopened")
        ? await createGitHubIssueOpportunities({
            clients: this.clients,
            opportunities: this.opportunities,
            owner,
            repo,
            issues,
            clientSlug: input.clientSlug,
          })
        : [];

    const report = await this.artifacts.write({
      type: "github-signal-report",
      createdBy: "supreme_coordinator",
      metadata: {
        repository,
        github_event: event,
        github_action: action,
        delivery_id: input.deliveryId ?? "",
        issues_count: issues.length,
        pull_requests_count: pullRequests.length,
        pull_request_refs: pullRequests
          .slice(0, 3)
          .map((pr) => `#${pr.number} ${pr.state} ${pr.title}`),
        pull_request_urls: pullRequests.slice(0, 3).map((pr) => pr.url),
        checks_count: checks.length,
        failing_checks_count: failingChecks.length,
      },
      body: bodyFor({
        event,
        action,
        repository,
        deliveryId: input.deliveryId ?? "",
        issues,
        pullRequests,
        checks,
        failingChecks,
        createdOpportunities,
      }),
    });

    for (const issue of issues) {
      await this.audit.append({
        actor: "github",
        action: "github.issue_webhook.ingested",
        target: `${repository}#${issue.number}`,
        capability: "github.webhook",
        artifact_id: report.id,
        result: "ok",
      });
    }
    for (const pr of pullRequests) {
      await this.audit.append({
        actor: "github",
        action: "github.pr_webhook.ingested",
        target: `${repository}#${pr.number}`,
        capability: "github.webhook",
        artifact_id: report.id,
        result: "ok",
      });
    }
    for (const check of failingChecks) {
      await this.audit.append({
        actor: "github",
        action: "github.check_failed.detected",
        target: `${repository}@${check.headSha}:${check.name}`,
        capability: "github.webhook",
        artifact_id: report.id,
        result: "ok",
      });
    }
    await this.audit.append({
      actor: "github",
      action: "github.webhook.ingested",
      target: `${repository}:${event}${action ? `:${action}` : ""}`,
      capability: "github.webhook",
      artifact_id: report.id,
      result: "ok",
    });

    return {
      event,
      action,
      repository,
      issues,
      pullRequests,
      checks,
      failingChecks,
      createdOpportunities,
      report,
      status: "ingested",
    };
  }
}
