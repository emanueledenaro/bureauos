import { join, resolve } from "node:path";

/**
 * Canonical layout of a BureauOS workspace.
 * Mirrors `docs/bos-kernel-infrastructure.md` "Runtime Data Layout".
 */
export interface WorkspacePaths {
  root: string;
  workspaceDir: string;
  configFile: string;
  memoryDir: string;
  rootMemory: string;
  companyMemory: string;
  clientsIndex: string;
  projectsIndex: string;
  decisionsLog: string;
  activeWorkLog: string;
  risksLog: string;
  brandMemory: string;
  offersMemory: string;
  channelsMemory: string;
  leadsMemory: string;
  campaignsMemory: string;
  conversionNotes: string;
  pricingMemory: string;
  proposalsMemory: string;
  complianceMemory: string;
  approvalsMemory: string;
  publicClaimsMemory: string;
  policiesMemory: string;
  dailyDir: string;
  coordinatorDir: string;
  coordinatorMessages: string;
  clientsDir: string;
  projectsDir: string;
  opportunitiesDir: string;
  runsDir: string;
  artifactsDir: string;
  indexesDir: string;
  auditDir: string;
  auditLog: string;
  daemonDir: string;
  daemonStatus: string;
  daemonLock: string;
  daemonLog: string;
  daemonSchedulerState: string;
  approvalsPendingDir: string;
  approvalsResolvedDir: string;
}

export function workspacePaths(root: string): WorkspacePaths {
  const r = resolve(root);
  const ws = join(r, ".bureauos");
  const mem = join(ws, "memory");
  return {
    root: r,
    workspaceDir: ws,
    configFile: join(ws, "bureauos.yaml"),
    memoryDir: mem,
    rootMemory: join(mem, "ROOT.md"),
    companyMemory: join(mem, "COMPANY.md"),
    clientsIndex: join(mem, "CLIENTS.md"),
    projectsIndex: join(mem, "PROJECTS.md"),
    decisionsLog: join(mem, "DECISIONS.md"),
    activeWorkLog: join(mem, "ACTIVE_WORK.md"),
    risksLog: join(mem, "RISKS.md"),
    brandMemory: join(mem, "BRAND.md"),
    offersMemory: join(mem, "OFFERS.md"),
    channelsMemory: join(mem, "CHANNELS.md"),
    leadsMemory: join(mem, "LEADS.md"),
    campaignsMemory: join(mem, "CAMPAIGNS.md"),
    conversionNotes: join(mem, "CONVERSION_NOTES.md"),
    pricingMemory: join(mem, "PRICING.md"),
    proposalsMemory: join(mem, "PROPOSALS.md"),
    complianceMemory: join(mem, "COMPLIANCE.md"),
    approvalsMemory: join(mem, "APPROVALS.md"),
    publicClaimsMemory: join(mem, "PUBLIC_CLAIMS.md"),
    policiesMemory: join(mem, "POLICIES.md"),
    dailyDir: join(mem, "memory"),
    coordinatorDir: join(mem, "coordinator"),
    coordinatorMessages: join(mem, "coordinator", "messages.jsonl"),
    clientsDir: join(mem, "clients"),
    projectsDir: join(mem, "projects"),
    opportunitiesDir: join(mem, "opportunities"),
    runsDir: join(mem, "runs"),
    artifactsDir: join(mem, "artifacts"),
    indexesDir: join(mem, "indexes"),
    auditDir: join(ws, "audit"),
    auditLog: join(ws, "audit", "audit.log"),
    daemonDir: join(ws, "daemon"),
    daemonStatus: join(ws, "daemon", "status.json"),
    daemonLock: join(ws, "daemon", "daemon.lock"),
    daemonLog: join(ws, "daemon", "daemon.log"),
    daemonSchedulerState: join(ws, "daemon", "scheduler-state.json"),
    approvalsPendingDir: join(ws, "approvals", "pending"),
    approvalsResolvedDir: join(ws, "approvals", "resolved"),
  };
}
