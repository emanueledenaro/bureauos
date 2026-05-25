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
export interface SettingsSummary {
  config_path: string;
  organization: { name: string };
  setup: {
    preset: string;
    mode: string;
    generated_by: string;
    advanced_config_required: boolean;
  };
  interface: {
    enabled: boolean;
    mode: string;
    mobile_first: boolean;
  };
  supreme_coordinator: {
    provider: string;
    model: string;
    user_facing: boolean;
    always_on: boolean;
  };
  autonomy: Record<string, boolean>;
  growth_autonomy: Record<string, boolean>;
  memory: Record<string, boolean>;
  limits: Record<string, number | boolean>;
  github: Record<string, boolean>;
  triggers: {
    github: Record<string, boolean>;
    schedules: Record<string, string>;
    thresholds: Record<string, number>;
  };
  agents: {
    configured: number;
    roles: number;
  };
  capabilities: {
    configured: number;
    catalog: number;
  };
  providers: {
    connectors: number;
    configured_overrides: string[];
    enabled: string[];
    disabled: string[];
  };
}

export interface ClientRecord {
  id: string;
  slug: string;
  name: string;
  status: string;
  industry: string;
  created?: string;
  updated?: string;
}
export interface ProjectRecord {
  id: string;
  slug: string;
  name: string;
  client_id: string;
  status: string;
  repository: string;
  stack: string;
  created?: string;
  updated?: string;
}
export interface ProjectOwnershipRecord {
  id: string;
  project_id: string;
  project_slug: string;
  client_id: string;
  manager_agent_id: string;
  manager_role: string;
  team_id: string;
  status: string;
  assigned_agents: string[];
  escalation_agent_id: string;
  created?: string;
  updated?: string;
}
export interface OpportunityRecord {
  id: string;
  title: string;
  source?: string;
  client_id: string;
  status: string;
  expected_value: number;
  expected_margin: number;
  qualification_status?: string;
  proposal_status?: string;
  pricing_status?: string;
  next_action?: string;
  created?: string;
  updated?: string;
}
export interface ApprovalRecord {
  id: string;
  action: string;
  actor: string;
  target: string;
  scope: string;
  status: string;
  expires_at?: string;
  one_off?: boolean;
  recurring?: boolean;
  created?: string;
  updated?: string;
  resolved_at?: string;
  resolved_by?: string;
  reason?: string;
}
export interface RunRecord {
  id: string;
  type: string;
  status: string;
  scope: string;
  created: string;
  trigger_type?: string;
  trigger_source?: string;
  project_id?: string;
  client_id?: string;
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
export interface CapabilityDefinition {
  id: string;
  name: string;
  description: string;
  type: string;
  allowed_agents: string[];
  actions: Record<string, boolean>;
  required_approvals: string[];
  risk_class: "low" | "medium" | "high" | "critical";
  audit_required: boolean;
  status: "available" | "configured" | "designed" | "blocked";
  connector?: string;
}
export interface ArtifactRecord {
  id: string;
  type: string;
  status: string;
  created?: string;
  repository?: string;
  github_event?: string;
  github_action?: string;
  issues_count?: number;
  pull_requests_count?: number;
  checks_count?: number;
  failing_checks_count?: number;
  stale_issues_count?: number;
  stale_pull_requests_count?: number;
}
export interface CoordinatorAttachmentInput {
  name: string;
  type: string;
  size: number;
  text?: string;
  dataUrl?: string;
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
export interface CoordinatorMessageRecord {
  id: string;
  role: "owner" | "coordinator";
  text: string;
  created: string;
  attachments?: Array<{ name: string; size: number; type: string }>;
  result?: CoordinatorIntakeResult;
  meta?: Record<string, unknown>;
}
export interface CoordinatorChatResult {
  mode: "intake" | "answer";
  ownerMessage: CoordinatorMessageRecord;
  coordinatorMessage: CoordinatorMessageRecord;
  result?: CoordinatorIntakeResult;
  provider: {
    status: "used" | "unavailable" | "failed";
    provider?: string;
    model?: string;
    reason?: string;
  };
  memory: {
    generatedAt: string;
    hits: Array<{ path: string; snippet: string; score: number }>;
  };
}
export interface CoordinatorGlobalMemoryPacket {
  rootMemory: string;
  generatedAt: string;
  topHits: Array<{ path: string; snippet: string; score: number }>;
  audit: AuditEvent;
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
export interface GitHubCreatedIssue {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  labels: readonly string[];
  state: "open" | "closed";
}
export interface GitHubIssuePublishResult {
  status: "created" | "blocked";
  project: ProjectRecord;
  client?: ClientRecord;
  repository: {
    owner: string;
    repo: string;
    url: string;
  };
  approval?: ApprovalRecord;
  created: GitHubCreatedIssue[];
  source_artifacts: string[];
  report?: ArtifactRecord;
}
export interface AgentHandoff {
  role: string;
  artifact: ArtifactRecord;
}
export interface ProjectDispatchResult {
  summary: string;
  next_actions: string[];
  project: ProjectRecord;
  ownership: ProjectOwnershipRecord;
  client?: ClientRecord;
  run: RunRecord;
  pipeline: string[];
  packet: ArtifactRecord;
  handoffs: AgentHandoff[];
  artifacts: ArtifactRecord[];
}
export interface ProviderConnection {
  provider: string;
  provider_name: string;
  id: string;
  source: "auth" | "env";
  auth_mode: "oauth" | "api-key" | "local";
  has_api_key: boolean;
  api_key_masked: string;
  oauth_token_masked: string;
  base_url: string;
  default_model: string;
  no_api_fallback: boolean;
  status: "ok" | "missing";
  reason?: string;
}
export interface ProviderAuthPromptCondition {
  key: string;
  op: "eq" | "neq";
  value: string;
}
export interface ProviderAuthTextPrompt {
  type: "text";
  key: string;
  message: string;
  placeholder?: string;
  when?: ProviderAuthPromptCondition;
}
export interface ProviderAuthSelectPromptOption {
  label: string;
  value: string;
  hint?: string;
}
export interface ProviderAuthSelectPrompt {
  type: "select";
  key: string;
  message: string;
  options: ProviderAuthSelectPromptOption[];
  when?: ProviderAuthPromptCondition;
}
export type ProviderAuthPrompt = ProviderAuthTextPrompt | ProviderAuthSelectPrompt;
export interface ProviderAuthMethod {
  type: "oauth" | "api" | "local";
  label: string;
  prompts?: ProviderAuthPrompt[];
}
export interface ProviderConnector {
  id: string;
  name: string;
  description: string;
  source: "builtin" | "config";
  defaultAuthMode: "oauth" | "api-key" | "local";
  defaultModel: string;
  models: Array<{ id: string; name: string }>;
  authMethods: ProviderAuthMethod[];
  popular: boolean;
  requiresBaseUrl: boolean;
  noApiFallback: boolean;
}
export interface ProviderModelList {
  provider: string;
  source: "connector" | "connection";
  defaultModel: string;
  models: Array<{ id: string; name: string }>;
}
export interface ProviderAuthAuthorization {
  url: string;
  method: "auto" | "code";
  instructions: string;
}
export interface ProviderOAuthCallbackResult {
  status: "connected" | "pending";
  providers?: ProviderConnection[];
}

export const Api = {
  pulse: () => api<CompanyPulse>("/company-pulse"),
  clients: () => api<ClientRecord[]>("/clients"),
  projects: () => api<ProjectRecord[]>("/projects"),
  projectOwnership: () => api<ProjectOwnershipRecord[]>("/project-ownership"),
  opportunities: () => api<OpportunityRecord[]>("/opportunities"),
  approvals: () => api<ApprovalRecord[]>("/approvals"),
  approvalsResolved: () => api<ApprovalRecord[]>("/approvals/resolved"),
  runs: () => api<RunRecord[]>("/runs"),
  agents: () => api<AgentDefinition[]>("/agents"),
  capabilities: () => api<CapabilityDefinition[]>("/capabilities"),
  artifacts: () => api<ArtifactRecord[]>("/artifacts"),
  providers: () => api<ProviderConnection[]>("/providers"),
  settings: () => api<SettingsSummary>("/settings"),
  providerConnectors: () => api<ProviderConnector[]>("/provider/connectors"),
  providerModels: (provider: string) =>
    api<ProviderModelList>(`/provider/models?provider=${encodeURIComponent(provider)}`),
  coordinatorMessages: (limit = 50) =>
    api<CoordinatorMessageRecord[]>(`/coordinator/messages?limit=${limit}`),
  coordinatorChat: (input: { message: string; attachments?: CoordinatorAttachmentInput[] }) =>
    api<CoordinatorChatResult>("/coordinator/messages", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  coordinatorMemory: (query: string, limit = 12) =>
    api<CoordinatorGlobalMemoryPacket>(
      `/coordinator/memory?query=${encodeURIComponent(query)}&limit=${limit}`,
    ),
  audit: (n = 50) => api<AuditEvent[]>(`/audit?n=${n}`),
  coordinatorIntake: (input: {
    message: string;
    clientName?: string;
    projectName?: string;
    expectedValue?: number;
    attachments?: CoordinatorAttachmentInput[];
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
  githubCreateIssues: (input: { projectSlug: string; owner: string; repo: string }) =>
    api<GitHubIssuePublishResult>("/github/create-issues", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  dispatchProject: (input: { projectSlug: string; runType?: string; scope?: string }) =>
    api<ProjectDispatchResult>("/projects/dispatch", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  providerLogin: (input: {
    provider: string;
    mode?: "oauth" | "api-key" | "local";
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    baseUrl?: string;
    defaultModel?: string;
  }) =>
    api<ProviderConnection[]>("/providers/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  providerLogout: (input: { provider: string; id?: string }) =>
    api<{ removed: boolean; providers: ProviderConnection[] }>("/providers/auth/logout", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  providerAuthMethods: () => api<Record<string, ProviderAuthMethod[]>>("/provider/auth"),
  providerOAuthAuthorize: (providerID: string, method = 0) =>
    api<ProviderAuthAuthorization>(`/provider/${providerID}/oauth/authorize`, {
      method: "POST",
      body: JSON.stringify({ method }),
    }),
  providerOAuthCallback: (
    providerID: string,
    input: { method?: number; code?: string; defaultModel?: string } = {},
  ) =>
    api<ProviderOAuthCallbackResult>(`/provider/${providerID}/oauth/callback`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  resolveApproval: (id: string, status: "approved" | "rejected", reason?: string) =>
    api<ApprovalRecord>("/approvals/resolve", {
      method: "POST",
      body: JSON.stringify({ id, status, reason }),
    }),
};
