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
export interface GrowthMemorySection {
  id: "brand" | "offers" | "channels";
  title: string;
  path: string;
  status: "empty" | "configured";
  updated: string;
  body: string;
  preview: string;
}
export interface GrowthMemorySummary {
  generated_at: string;
  ready: boolean;
  missing_sections: string[];
  sections: GrowthMemorySection[];
}
export type ClientAccountRisk = "blocked" | "follow_up_due" | "proposal" | "active" | "cold";
export interface ClientProjectSnapshot {
  id: string;
  slug: string;
  name: string;
  status: string;
  repository: string;
  stack: string;
  updated?: string;
}
export interface ClientOpportunitySnapshot {
  id: string;
  title: string;
  status: string;
  expected_value: number;
  expected_margin: number;
  next_action: string;
  updated?: string;
}
export interface ClientIntelligenceItem {
  client: ClientRecord;
  revenue: {
    pipeline_value: number;
    won_value: number;
    lost_value: number;
    average_expected_margin: number;
    open_opportunities: number;
    won_opportunities: number;
    stalled_opportunities: number;
  };
  delivery: {
    projects_total: number;
    active_projects: number;
    blocked_projects: number;
    delivered_projects: number;
    repositories_linked: number;
    pending_approvals: number;
  };
  relationship: {
    last_client_message_at: string;
    last_owner_response_at: string;
    next_follow_up_at: string;
    follow_up_due: boolean;
  };
  risk: ClientAccountRisk;
  next_action: string;
  latest_activity_at: string;
  memory_paths: {
    profile: string;
    projects: string;
    revenue: string;
    relationship: string;
    opportunities: string;
    risks: string;
  };
  projects: ClientProjectSnapshot[];
  opportunities: ClientOpportunitySnapshot[];
}
export interface ClientIntelligenceSummary {
  generated_at: string;
  totals: {
    clients: number;
    pipeline_value: number;
    won_value: number;
    active_projects: number;
    blocked_projects: number;
    follow_ups_due: number;
  };
  clients: ClientIntelligenceItem[];
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
  client_id?: string;
  client_name?: string;
  risk?: string;
  follow_up_due?: boolean;
  next_follow_up_at?: string;
  project_count?: number;
  missing_count?: number;
  unsupported_count?: number;
  unverified_count?: number;
  verified_count?: number;
  attention_count?: number;
  candidate_count?: number;
  max_attempts?: number;
  retry_count?: number;
  escalation_count?: number;
  repository?: string;
  github_event?: string;
  github_action?: string;
  pull_request_refs?: string[];
  pull_request_urls?: string[];
  issues_count?: number;
  pull_requests_count?: number;
  checks_count?: number;
  failing_checks_count?: number;
  stale_issues_count?: number;
  stale_pull_requests_count?: number;
  generated_at?: string;
  memory_ready?: boolean;
  missing_sections?: string[];
  pipeline_value?: number;
  open_opportunities?: number;
  draft_count?: number;
  draft_artifacts?: string[];
  kind?: string;
  channel?: string;
  title?: string;
  approval_required?: boolean;
  opportunity_id?: string;
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
export type CoordinatorChatStreamEvent =
  | { type: "status"; status: "started" | "provider_streaming" | "persisting" }
  | { type: "delta"; text: string }
  | { type: "final"; result: CoordinatorChatResult }
  | { type: "error"; error: string };
export interface CoordinatorChatStreamHandlers {
  onStatus?: (status: Extract<CoordinatorChatStreamEvent, { type: "status" }>["status"]) => void;
  onDelta?: (text: string) => void;
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
  cross_project_report: ArtifactRecord;
  business_operating_report: ArtifactRecord;
  portfolio: Array<{
    project_id: string;
    project_slug: string;
    project_name: string;
    client_id: string;
    client_name: string;
    status: string;
    manager_agent_id: string;
    team_id: string;
    assigned_agents: string[];
    pending_approvals: number;
    active_runs: number;
    runs_needing_human: number;
    client_pipeline_value: number;
    risk: string;
    next_action: string;
  }>;
  metrics: {
    clients_total: number;
    projects_total: number;
    opportunities_total: number;
    pipeline_value: number;
    approvals_pending: number;
  };
  next_actions: string[];
}
export interface GrowthContentPipelineDraft {
  kind: "social" | "campaign" | "creative" | "ads";
  channel: string;
  title: string;
  artifact: ArtifactRecord;
  client_id: string;
  opportunity_id: string;
  approval_required: boolean;
}
export interface GrowthContentPipelineResult {
  generated_at: string;
  memory_ready: boolean;
  missing_sections: string[];
  pipeline_value: number;
  open_opportunities: number;
  drafts: GrowthContentPipelineDraft[];
  report: ArtifactRecord;
  next_actions: string[];
}
export interface RevenuePipelineItem {
  opportunity: OpportunityRecord;
  client?: ClientRecord;
  score: number;
  fit: "high" | "medium" | "low";
  stage: "needs_qualification" | "qualified" | "proposal_ready";
  reasons: string[];
  risks: string[];
  next_action: string;
  artifacts: ArtifactRecord[];
}
export interface RevenuePipelineResult {
  generated_at: string;
  report: ArtifactRecord;
  pipeline_value: number;
  open_opportunities: number;
  qualified_count: number;
  proposal_ready_count: number;
  items: RevenuePipelineItem[];
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
export interface RepositoryVerificationItem {
  project: ProjectRecord;
  client?: ClientRecord;
  repository: string;
  parsed_repository: string;
  status: "missing" | "unsupported" | "unverified" | "verified" | "attention";
  reasons: string[];
  issues_count: number;
  pull_requests_count: number;
  checks_count: number;
  failing_checks_count: number;
  stale_issues_count: number;
  stale_pull_requests_count: number;
  signal_report_id: string;
}
export interface ProjectRepositoryVerificationResult {
  generated_at: string;
  report: ArtifactRecord;
  projects: RepositoryVerificationItem[];
}
export interface AutonomousRetryResult {
  triggered: Array<{
    originalRun: RunRecord;
    retryRun: RunRecord;
    attempt: number;
    triggerSource: string;
  }>;
  escalated: Array<{
    run: RunRecord;
    attempts: number;
    reason: "max_attempts_reached";
  }>;
  skipped: Array<{
    run: RunRecord;
    reason:
      | "duplicate"
      | "policy_blocked"
      | "already_escalated"
      | "already_recovered"
      | "retry_child";
    triggerSource?: string;
  }>;
  report?: ArtifactRecord;
}
export interface ClientSuccessStatusResult {
  generated_at: string;
  reports: ArtifactRecord[];
  clients: ClientIntelligenceItem[];
}
export interface MemoryTriggerResult {
  triggered: Array<{
    kind: "client_follow_up_due";
    triggerSource: string;
    run: RunRecord;
    artifactIds: string[];
  }>;
  skipped: Array<{
    kind: "client_follow_up_due";
    triggerSource: string;
    reason: "duplicate" | "policy_blocked";
  }>;
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
  models: Array<{
    id: string;
    name: string;
    capabilities: string[];
    budgetTier: "free" | "low" | "standard" | "high" | "premium";
  }>;
  authMethods: ProviderAuthMethod[];
  popular: boolean;
  requiresBaseUrl: boolean;
  noApiFallback: boolean;
}
export interface ProviderModelList {
  provider: string;
  source: "connector" | "connection";
  defaultModel: string;
  models: Array<{
    id: string;
    name: string;
    capabilities: string[];
    budgetTier: "free" | "low" | "standard" | "high" | "premium";
  }>;
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

function parseSseFrame(frame: string): { event: string; data: unknown } | undefined {
  const lines = frame.split(/\r?\n/);
  const event =
    lines
      .find((line) => line.startsWith("event:"))
      ?.slice("event:".length)
      .trim() ?? "message";
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (!data) return undefined;
  return { event, data: JSON.parse(data) as unknown };
}

export const Api = {
  pulse: () => api<CompanyPulse>("/company-pulse"),
  clients: () => api<ClientRecord[]>("/clients"),
  clientIntelligence: () => api<ClientIntelligenceSummary>("/clients/intelligence"),
  generateClientSuccessStatus: (input: { clientSlug?: string; clientId?: string } = {}) =>
    api<ClientSuccessStatusResult>("/client-success-status/generate", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  projects: () => api<ProjectRecord[]>("/projects"),
  projectOwnership: () => api<ProjectOwnershipRecord[]>("/project-ownership"),
  opportunities: () => api<OpportunityRecord[]>("/opportunities"),
  generateRevenuePipeline: (input: { maxOpportunities?: number; opportunityId?: string } = {}) =>
    api<RevenuePipelineResult>("/revenue/pipeline/generate", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  growthMemory: () => api<GrowthMemorySummary>("/growth/memory"),
  updateGrowthMemory: (input: { brand?: string; offers?: string; channels?: string }) =>
    api<GrowthMemorySummary>("/growth/memory", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  generateGrowthContent: (input: { maxDrafts?: number; focus?: string } = {}) =>
    api<GrowthContentPipelineResult>("/growth/content-pipeline/generate", {
      method: "POST",
      body: JSON.stringify(input),
    }),
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
  coordinatorChatStream: async (
    input: { message: string; attachments?: CoordinatorAttachmentInput[] },
    handlers: CoordinatorChatStreamHandlers = {},
  ): Promise<CoordinatorChatResult> => {
    const base = await getBase();
    if (!base)
      throw new Error("API server is not running. Run `bureau serve` or start the desktop app.");
    const res = await fetch(`${base}/coordinator/messages/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    if (!res.body) throw new Error("Coordinator stream did not return a readable body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult: CoordinatorChatResult | undefined;

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
        if (!frame || frame.startsWith(":")) continue;
        const parsed = parseSseFrame(frame);
        if (!parsed) continue;
        const event = parsed.data as CoordinatorChatStreamEvent;
        if (event.type === "status") handlers.onStatus?.(event.status);
        if (event.type === "delta") handlers.onDelta?.(event.text);
        if (event.type === "final") finalResult = event.result;
        if (event.type === "error") throw new Error(event.error);
      }
      if (done) break;
    }

    if (!finalResult) throw new Error("Coordinator stream ended before a final message");
    return finalResult;
  },
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
  verifyProjectRepositories: (input: { projectSlug?: string; staleDays?: number } = {}) =>
    api<ProjectRepositoryVerificationResult>("/project-repositories/verify", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  autonomyRetryScan: (input: { maxAttempts?: number } = {}) =>
    api<AutonomousRetryResult>("/autonomy/retries/scan", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  memoryTriggerScan: () =>
    api<MemoryTriggerResult>("/autonomy/memory-triggers/scan", {
      method: "POST",
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
