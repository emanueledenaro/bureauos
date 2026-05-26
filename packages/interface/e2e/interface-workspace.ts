import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApprovalRegistry,
  ArtifactStore,
  CapabilityUseService,
  AuditLog,
  ClientRegistry,
  defaultConfig,
  initWorkspace,
  OpportunityRegistry,
  PolicyEngine,
  ProjectRegistry,
  RunEngine,
  startApiServer,
  workspacePaths,
  type ApiServer,
} from "@bureauos/core";

export type InterfaceWorkspaceKind = "empty" | "seeded";

export interface InterfaceWorkspace {
  kind: InterfaceWorkspaceKind;
  root: string;
  api: ApiServer;
  url: string;
  close: () => Promise<void>;
}

export async function createInterfaceWorkspace(
  kind: InterfaceWorkspaceKind,
): Promise<InterfaceWorkspace> {
  const root = await mkdtemp(join(tmpdir(), `bureauos-interface-${kind}-`));
  const config = defaultConfig("freelancer");
  await initWorkspace({
    root,
    organizationName: kind === "seeded" ? "BureauOS Seeded QA" : "BureauOS Empty QA",
    preset: "freelancer",
  });

  if (kind === "seeded") await seedWorkspace(root, config);

  const api = await startApiServer({ workspaceRoot: root, config, port: 0 });
  return {
    kind,
    root,
    api,
    url: api.url,
    close: () => api.close(),
  };
}

async function seedWorkspace(
  root: string,
  config: ReturnType<typeof defaultConfig>,
): Promise<void> {
  const clients = new ClientRegistry(root);
  const projects = new ProjectRegistry(root);
  const opportunities = new OpportunityRegistry(root);
  const approvals = new ApprovalRegistry(root);
  const artifacts = new ArtifactStore(root);
  const audit = new AuditLog(workspacePaths(root).auditLog);
  const policy = new PolicyEngine(config, approvals);
  const runs = new RunEngine(root, { audit, artifacts, policy });
  const capabilities = new CapabilityUseService(root, {
    config,
    approvals,
    artifacts,
    policy,
    audit,
  });

  const client = await clients.create({
    name: "Acme Labs",
    status: "active",
    industry: "SaaS",
    notes: "Seed client for Operating Room visual regression coverage.",
  });
  const project = await projects.create({
    name: "Acme Website Refresh",
    clientId: client.id,
    status: "in_progress",
    repository: "https://github.com/acme-labs/website",
    stack: "Next.js, TypeScript",
    notes: "Seed delivery project used by interface E2E tests.",
  });
  await opportunities.create({
    title: "Website Refresh for Acme Labs",
    source: "owner_intake",
    clientId: client.id,
    expectedValue: 12_000,
    expectedMargin: 0.42,
    notes: "Seed opportunity used by revenue and growth screens.",
  });
  await approvals.request({
    action: "send_final_proposals",
    actor: "supreme_coordinator",
    target: "Website Refresh for Acme Labs",
    scope: "Send final proposal to the client.",
    riskLevel: "high",
    body: "Seed approval used by risk and approvals screens.",
  });
  await runs.start({
    type: "health_check",
    triggerType: "owner_request",
    triggerSource: "SER-74 interface E2E seed",
    scope: "Verify the seeded Operating Room state.",
    clientId: client.id,
    projectId: project.id,
  });
  await runs.start({
    type: "health_check",
    triggerType: "owner_request",
    triggerSource: "SER-72 agent layer seed",
    scope: "Development agent validates the seeded website workflow.",
    createdBy: "development",
    clientId: client.id,
    projectId: project.id,
  });
  const linkedRun = await runs.start({
    type: "feature",
    triggerType: "external_signal",
    triggerSource: "linear://issue/SER-89",
    sourceWorkItem: {
      type: "linear_issue",
      identifier: "SER-89",
      url: "https://linear.app/serium/issue/SER-89/build-linear-and-github-linked-work-dashboard",
    },
    scope: "Build linked work dashboard.",
    clientId: client.id,
    projectId: project.id,
  });
  const linkedSignal = await artifacts.write({
    type: "github-signal-report",
    createdBy: "github",
    runId: linkedRun.id,
    clientId: client.id,
    projectId: project.id,
    metadata: {
      repository: "acme-labs/website",
      pull_request_refs: ["#42 open Build linked work dashboard"],
      pull_request_urls: ["https://github.com/acme-labs/website/pull/42"],
      pull_requests_count: 1,
      checks_count: 4,
      failing_checks_count: 0,
      stale_issues_count: 0,
      stale_pull_requests_count: 0,
      branch_name: "codex/ser-89-linked-work-dashboard",
      head_sha: "abc123def4567890",
    },
    body: "# GitHub Signal\n\nLinked work dashboard PR signal.",
  });
  await runs.attachArtifacts(linkedRun.id, [linkedSignal.id]);
  const staleRun = await runs.start({
    type: "bug",
    triggerType: "external_signal",
    triggerSource: "linear://issue/SER-90",
    sourceWorkItem: {
      type: "linear_issue",
      identifier: "SER-90",
      url: "https://linear.app/serium/issue/SER-90/add-local-notifications-for-approval-required-work",
    },
    scope: "Triage stale GitHub work.",
    clientId: client.id,
    projectId: project.id,
  });
  const staleSignal = await artifacts.write({
    type: "github-signal-report",
    createdBy: "github",
    runId: staleRun.id,
    clientId: client.id,
    projectId: project.id,
    metadata: {
      repository: "acme-labs/website",
      pull_request_refs: ["#7 open Fix stale notification branch"],
      pull_request_urls: ["https://github.com/acme-labs/website/pull/7"],
      pull_requests_count: 1,
      checks_count: 2,
      failing_checks_count: 1,
      stale_issues_count: 1,
      stale_pull_requests_count: 1,
      branch_name: "codex/ser-90-local-alerts",
      head_sha: "def456abc1237890",
    },
    body: "# GitHub Signal\n\nStale work signal.",
  });
  await runs.attachArtifacts(staleRun.id, [staleSignal.id]);
  const retryBlockedRun = await runs.start({
    type: "bug",
    triggerType: "threshold",
    triggerSource: "bureauos.retry:seeded-checkout:2",
    scope: "Recover failed checkout flow.",
    clientId: client.id,
    projectId: project.id,
  });
  const retryApproval = await approvals.request({
    action: "resolve_retry_blocker",
    actor: "supreme_coordinator",
    target: retryBlockedRun.id,
    scope: "Resolve retry blocker for seeded checkout flow.",
    runId: retryBlockedRun.id,
    riskLevel: "medium",
    body: "Seed retry blocker approval used by Risk view E2E tests.",
  });
  await runs.patch(retryBlockedRun.id, {
    status: "blocked",
    completed: "",
    retry_attempts: 2,
    retry_child_runs: ["run_seed_retry_1", "run_seed_retry_2"],
    retry_escalated_at: "2026-05-26T12:00:00.000Z",
    retry_escalation_reason: "max_attempts_reached",
    retry_classification: "retryable_failure",
    retry_blocker_reason:
      "Retry limit reached after 2 attempt(s). Owner intervention required before another retry.",
    retry_blocker_approval_id: retryApproval.id,
  });
  await capabilities.check({
    agent: "development",
    capabilityId: "codex",
    action: "read_repo",
    target: "github.com/acme-labs/website",
  });
  await capabilities.check({
    agent: "product",
    capabilityId: "codex",
    action: "edit_code",
    target: "github.com/acme-labs/website?api_key=sk-seededsecret123456",
  });
  await capabilities.check({
    agent: "development",
    capabilityId: "codex",
    action: "open_pr",
    target: "github.com/acme-labs/website/pull/7",
  });
  await audit.append({
    actor: "qa",
    action: "interface.seeded_workspace_ready",
    target: project.id,
    result: "ok",
  });
}
