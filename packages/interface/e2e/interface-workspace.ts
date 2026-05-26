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
