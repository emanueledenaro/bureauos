declare global {
  interface Window {
    bureau?: {
      apiUrl: () => Promise<string>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}

let cachedBase: string | undefined;

async function getBase(): Promise<string> {
  if (cachedBase) return cachedBase;
  if (typeof window !== "undefined" && window.bureau) {
    cachedBase = await window.bureau.apiUrl();
    return cachedBase;
  }
  cachedBase = "http://127.0.0.1:3737";
  return cachedBase;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getBase();
  if (!base)
    throw new Error("API server is not running. Run `bureau serve` or start the desktop app.");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export interface CompanyPulse {
  organization: string;
  preset: string;
  mode: string;
  counts: {
    clients: number;
    projects: number;
    opportunities: number;
    approvals_pending: number;
    runs: number;
  };
  revenue: {
    pipeline_value: number;
    active_opportunities: number;
  };
}

export interface ClientRecord {
  id: string;
  slug: string;
  name: string;
  status: string;
  industry: string;
}
export interface ProjectRecord {
  id: string;
  slug: string;
  name: string;
  client_id: string;
  status: string;
  repository: string;
  stack: string;
}
export interface OpportunityRecord {
  id: string;
  title: string;
  client_id: string;
  status: string;
  expected_value: number;
  expected_margin: number;
}
export interface ApprovalRecord {
  id: string;
  action: string;
  actor: string;
  target: string;
  scope: string;
  status: string;
}
export interface RunRecord {
  id: string;
  type: string;
  status: string;
  scope: string;
  created: string;
}
export interface AuditEvent {
  timestamp: string;
  actor: string;
  action: string;
  target?: string;
  result: string;
}
export interface AgentDefinition {
  id: string;
  role: string;
  category: string;
  scope: string;
  description: string;
}
export interface ArtifactRecord {
  id: string;
  type: string;
  status: string;
}
export interface CoordinatorIntakeResult {
  summary: string;
  next_actions: string[];
  client: ClientRecord;
  project: ProjectRecord;
  opportunity: OpportunityRecord;
  run: RunRecord;
  artifacts: ArtifactRecord[];
  approvals: ApprovalRecord[];
}
export interface BusinessReportResult {
  generated_at: string;
  executive_report: ArtifactRecord;
  business_operating_report: ArtifactRecord;
  metrics: {
    clients_total: number;
    projects_total: number;
    opportunities_total: number;
    pipeline_value: number;
    approvals_pending: number;
  };
  next_actions: string[];
}
export interface GitHubIssueDraft {
  title: string;
  body: string;
  labels: string[];
  source_artifacts: string[];
}
export interface GitHubIssueDraftResult {
  project: ProjectRecord;
  client?: ClientRecord;
  drafts: GitHubIssueDraft[];
  artifacts: ArtifactRecord[];
}

export const Api = {
  pulse: () => api<CompanyPulse>("/company-pulse"),
  clients: () => api<ClientRecord[]>("/clients"),
  projects: () => api<ProjectRecord[]>("/projects"),
  opportunities: () => api<OpportunityRecord[]>("/opportunities"),
  approvals: () => api<ApprovalRecord[]>("/approvals"),
  runs: () => api<RunRecord[]>("/runs"),
  agents: () => api<AgentDefinition[]>("/agents"),
  audit: (n = 50) => api<AuditEvent[]>(`/audit?n=${n}`),
  coordinatorIntake: (input: {
    message: string;
    clientName?: string;
    projectName?: string;
    expectedValue?: number;
  }) =>
    api<CoordinatorIntakeResult>("/coordinator/intake", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  reports: () => api<ArtifactRecord[]>("/reports"),
  generateReports: () =>
    api<BusinessReportResult>("/reports/generate", {
      method: "POST",
    }),
  githubIssueDrafts: (projectSlug: string) =>
    api<GitHubIssueDraftResult>("/github/issue-drafts", {
      method: "POST",
      body: JSON.stringify({ projectSlug }),
    }),
  resolveApproval: (id: string, status: "approved" | "rejected", reason?: string) =>
    api<ApprovalRecord>("/approvals/resolve", {
      method: "POST",
      body: JSON.stringify({ id, status, reason }),
    }),
};
