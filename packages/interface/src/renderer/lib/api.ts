declare global {
  interface Window {
    bureau?: {
      apiUrl: () => Promise<string>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}

let cachedBase: string | undefined;

function browserConfiguredBase(): string | undefined {
  if (typeof window === "undefined") return import.meta.env.VITE_BUREAUOS_API_BASE;
  const urlBase = new URLSearchParams(window.location.search).get("apiBase")?.trim();
  if (urlBase) return urlBase.replace(/\/+$/, "");
  const storedBase = window.localStorage.getItem("bureauos.apiBase")?.trim();
  if (storedBase) return storedBase.replace(/\/+$/, "");
  return import.meta.env.VITE_BUREAUOS_API_BASE?.trim().replace(/\/+$/, "");
}

async function getBase(): Promise<string> {
  const configuredBase = browserConfiguredBase();
  if (configuredBase) {
    cachedBase = configuredBase;
    return configuredBase;
  }
  if (cachedBase) return cachedBase;
  if (typeof window !== "undefined" && window.bureau) {
    cachedBase = await window.bureau.apiUrl();
    return cachedBase;
  }
  cachedBase = "http://127.0.0.1:3737";
  return cachedBase;
}

/**
 * Default client-side request timeout (SER-221). Without it, a stalled request
 * never settles, so the triggering control's loading state (useAsyncAction
 * `busy`, the dashboard "Loading…") sticks forever and the open socket leaks —
 * which under Chrome's 6-connections-per-host cap eventually exhausts the budget
 * and silently freezes every later fetch (SER-222). Bounding each request makes
 * a stalled call fail fast and visibly, and frees the socket within the window.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

export type ApiInit = RequestInit & { timeoutMs?: number };

export async function api<T>(path: string, init?: ApiInit): Promise<T> {
  const base = await getBase();
  if (!base)
    throw new Error("API server is not running. Run `bureau serve` or start the desktop app.");

  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...rest } = init ?? {};

  // One controller drives both the timeout and any caller-provided cancellation
  // (e.g. the dashboard aborting its in-flight fan-out on unmount), so the fetch
  // is torn down — and its socket released — on whichever fires first.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = (): void => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }

  try {
    const res = await fetch(`${base}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: { "content-type": "application/json", ...(rest.headers ?? {}) },
    });
    if (!res.ok) {
      let error = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) error = `${res.status} ${body.error}`;
      } catch {
        // Keep the HTTP status when the server returns an empty or non-JSON error.
      }
      throw new Error(error);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (timedOut) {
      throw new Error(
        `Request to ${path} timed out after ${Math.round(timeoutMs / 1000)}s. The API server may be busy or unreachable.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener("abort", onCallerAbort);
  }
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
    language: "en" | "it";
    mobile_first: boolean;
  };
  supreme_coordinator: {
    provider: string;
    model: string;
    user_facing: boolean;
    always_on: boolean;
  };
  autonomy: Record<string, boolean | number>;
  growth_autonomy: Record<string, boolean>;
  memory: Record<string, boolean | Record<string, string | boolean | number>>;
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
  source?: string;
  limit?: string;
  run_id?: string;
  risk_level?: string;
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
  updated?: string;
  completed?: string;
  created_by?: string;
  trigger_type?: string;
  trigger_source?: string;
  project_id?: string;
  client_id?: string;
  artifacts?: string[];
  decisions?: string[];
  dispatch_status?: string;
  blockers?: string[] | string;
  dispatch_blockers?: string[] | string;
  blocking_reason?: string;
  dispatch_error?: string;
  error?: string;
  next_action?: string;
  retry_attempts?: number;
  retry_child_runs?: string[];
  retry_parent_run_id?: string;
  retry_attempt?: number;
  retry_max_attempts?: number;
  retry_classification?: string;
  retry_report_id?: string;
  retry_blocker_reason?: string;
  retry_blocker_approval_id?: string;
  retry_escalation_reason?: string;
  retry_escalated_at?: string;
  last_retry_at?: string;
  next_retry_at?: string;
  source_work_item_type?: string;
  source_work_item_id?: string;
  source_work_item_url?: string;
  linear_identifier?: string;
  linear_url?: string;
  branch_name?: string;
  git_branch?: string;
  commit_sha?: string;
  head_sha?: string;
  pull_request_url?: string;
  github_pr_url?: string;
  pr_url?: string;
  pull_request_urls?: string[];
}
export interface AuditEvent {
  timestamp: string;
  actor: string;
  action: string;
  target?: string;
  capability?: string;
  policy_result?: "allow" | "deny" | "require_approval" | "escalate";
  approval_id?: string;
  artifact_id?: string;
  result: string;
  error?: string;
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
  run_id?: string;
  client_id?: string;
  project_id?: string;
  source_work_item_type?: string;
  source_work_item_id?: string;
  source_work_item_url?: string;
  linear_identifier?: string;
  linear_url?: string;
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
  pull_request_check_summary?: string[];
  issues_count?: number;
  pull_requests_count?: number;
  checks_count?: number;
  failing_checks_count?: number;
  failing_check_refs?: string[];
  stale_issues_count?: number;
  stale_pull_requests_count?: number;
  branch_name?: string;
  git_branch?: string;
  commit_sha?: string;
  head_sha?: string;
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
    semanticHits?: Array<{ path: string; snippet: string; score: number }>;
  };
}
export type CoordinatorChatStreamEvent =
  | { type: "status"; status: "started" | "provider_streaming" | "persisting" }
  | { type: "reasoning"; text: string }
  | {
      type: "delegation";
      phase: "planned" | "dispatched" | "running" | "completed" | "escalated";
      label: string;
      runId?: string;
      agentRole?: string;
      detail?: string;
    }
  | { type: "run_status"; runId: string; status: string; detail?: string }
  | { type: "artifact"; artifactId: string; artifactType: string; status?: string }
  | { type: "delta"; text: string }
  | { type: "final"; result: CoordinatorChatResult }
  | { type: "error"; error: string };
export interface CoordinatorChatStreamHandlers {
  onStatus?: (status: Extract<CoordinatorChatStreamEvent, { type: "status" }>["status"]) => void;
  onReasoning?: (text: string) => void;
  onDelegation?: (event: Extract<CoordinatorChatStreamEvent, { type: "delegation" }>) => void;
  onRunStatus?: (event: Extract<CoordinatorChatStreamEvent, { type: "run_status" }>) => void;
  onArtifact?: (event: Extract<CoordinatorChatStreamEvent, { type: "artifact" }>) => void;
  onDelta?: (text: string) => void;
  /** Optional external cancellation (composer Stop). Aborting ends the stream cleanly. */
  signal?: AbortSignal;
}
export interface CoordinatorGlobalMemoryPacket {
  rootMemory: string;
  generatedAt: string;
  topHits: Array<{ path: string; snippet: string; score: number }>;
  semanticHits?: Array<{ path: string; snippet: string; score: number }>;
  audit: AuditEvent;
}
export type MemoryBrowserCategory = "client" | "project" | "daily" | "decision";
export interface MemoryBrowserEntry {
  path: string;
  category: MemoryBrowserCategory;
  title: string;
  preview: string;
  score?: number;
  updated?: string;
}
export interface MemoryBrowserDetail extends MemoryBrowserEntry {
  body: string;
}
export interface MemoryBrowserResult {
  generated_at: string;
  query: string;
  semantic_index: {
    enabled: boolean;
    provider: "none" | "custom";
    index_path: string;
    min_score: number;
  };
  semantic_hits: Array<{ path: string; snippet: string; score: number }>;
  categories: Array<{ id: MemoryBrowserCategory; label: string; count: number }>;
  entries: MemoryBrowserEntry[];
  selected?: MemoryBrowserDetail;
}
export type PolicyExplainOutcome = "allow" | "deny" | "require_approval" | "escalate";
export interface PolicyExplainDecision {
  id: string;
  artifact_id: string;
  created: string;
  agent: string;
  capability: string;
  action: string;
  policy_action: string;
  target: string;
  source_status: "allowed" | "blocked";
  outcome: PolicyExplainOutcome;
  allowed: boolean;
  matched_rule: string;
  risk_class: "low" | "medium" | "high" | "critical";
  approval_required: boolean;
  approval_id?: string;
  reason: string;
  required_gates: string[];
  missing_gates: string[];
}
export interface PolicyExplainResult {
  generated_at: string;
  counts: Record<PolicyExplainOutcome, number>;
  decisions: PolicyExplainDecision[];
}
export interface LocalNotificationRecord {
  id: string;
  type:
    | "approval_needed"
    | "high_risk_blocker"
    | "client_issue"
    | "revenue_opportunity"
    | "daily_report";
  title: string;
  severity: "info" | "warning" | "critical";
  status: "unread" | "read" | "dismissed";
  source_type: string;
  source_id: string;
  target: string;
  dedupe_key: string;
  created: string;
  updated: string;
}
export interface ReportDetail {
  record: ArtifactRecord;
  body: string;
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
  compliance_review?: ArtifactRecord;
  approvals: ApprovalRecord[];
  report: ArtifactRecord;
  next_actions: string[];
}
export interface GrowthReviewResult {
  generated_at: string;
  report: ArtifactRecord;
  memory_ready: boolean;
  missing_sections: string[];
  recent_content_count: number;
  pipeline_value: number;
  follow_ups_due: number;
  recommendations: string[];
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
  approvals: ApprovalRecord[];
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
    reason: "max_attempts_reached" | "non_retryable_failure";
    blocker: string;
    approval?: ApprovalRecord;
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
/**
 * OAuth completion strategy shared by the authorize response and the callback
 * request. Mirrors `ProviderOAuthMethod` in `@bureauos/core`. "auto" means the
 * local callback server captured the redirect and BureauOS can finish without
 * owner input; "code" means the owner pastes the final redirect URL or code.
 */
export type ProviderOAuthMethod = "auto" | "code";

export interface ProviderAuthAuthorization {
  url: string;
  method: ProviderOAuthMethod;
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
  pulse: (signal?: AbortSignal) => api<CompanyPulse>("/company-pulse", { signal }),
  clients: (signal?: AbortSignal) => api<ClientRecord[]>("/clients", { signal }),
  clientIntelligence: (signal?: AbortSignal) =>
    api<ClientIntelligenceSummary>("/clients/intelligence", { signal }),
  generateClientSuccessStatus: (input: { clientSlug?: string; clientId?: string } = {}) =>
    api<ClientSuccessStatusResult>("/client-success-status/generate", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  projects: (signal?: AbortSignal) => api<ProjectRecord[]>("/projects", { signal }),
  projectOwnership: (signal?: AbortSignal) =>
    api<ProjectOwnershipRecord[]>("/project-ownership", { signal }),
  opportunities: (signal?: AbortSignal) => api<OpportunityRecord[]>("/opportunities", { signal }),
  generateRevenuePipeline: (input: { maxOpportunities?: number; opportunityId?: string } = {}) =>
    api<RevenuePipelineResult>("/revenue/pipeline/generate", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  growthMemory: (signal?: AbortSignal) => api<GrowthMemorySummary>("/growth/memory", { signal }),
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
  generateGrowthReview: (input: { recentDays?: number } = {}) =>
    api<GrowthReviewResult>("/growth/review/generate", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  approvals: (signal?: AbortSignal) => api<ApprovalRecord[]>("/approvals", { signal }),
  approvalsResolved: (signal?: AbortSignal) =>
    api<ApprovalRecord[]>("/approvals/resolved", { signal }),
  notifications: (signal?: AbortSignal) =>
    api<LocalNotificationRecord[]>("/notifications", { signal }),
  runs: (signal?: AbortSignal) => api<RunRecord[]>("/runs", { signal }),
  agents: (signal?: AbortSignal) => api<AgentDefinition[]>("/agents", { signal }),
  capabilities: (signal?: AbortSignal) => api<CapabilityDefinition[]>("/capabilities", { signal }),
  artifacts: (signal?: AbortSignal) => api<ArtifactRecord[]>("/artifacts", { signal }),
  providers: (signal?: AbortSignal) => api<ProviderConnection[]>("/providers", { signal }),
  settings: (signal?: AbortSignal) => api<SettingsSummary>("/settings", { signal }),
  updateSettings: (input: {
    autonomy?: Record<string, boolean>;
    growth_autonomy?: Record<string, boolean>;
    limits?: Record<string, number | boolean>;
    interface?: { language?: "en" | "it" };
  }) =>
    api<SettingsSummary>("/settings/autonomy", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  providerConnectors: (signal?: AbortSignal) =>
    api<ProviderConnector[]>("/provider/connectors", { signal }),
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

    // Streaming replies can legitimately pause between chunks while the provider
    // thinks, so a single hard deadline would kill long-but-healthy generations.
    // Instead bound *inactivity*: abort only if no byte arrives for this long, so
    // a dead stream surfaces a visible error (and clears the "Sending…" state,
    // SER-221) while a slow-but-progressing one keeps going.
    const STREAM_INACTIVITY_MS = 90_000;
    const controller = new AbortController();
    let timedOut = false;
    let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
    const armInactivityTimer = (): void => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, STREAM_INACTIVITY_MS);
    };

    armInactivityTimer();
    const onCallerAbort = (): void => controller.abort();
    if (handlers.signal) {
      if (handlers.signal.aborted) controller.abort();
      else handlers.signal.addEventListener("abort", onCallerAbort, { once: true });
    }
    try {
      const res = await fetch(`${base}/coordinator/messages/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      if (!res.body) throw new Error("Coordinator stream did not return a readable body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: CoordinatorChatResult | undefined;

      while (true) {
        const { value, done } = await reader.read();
        armInactivityTimer();
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
          if (event.type === "reasoning") handlers.onReasoning?.(event.text);
          if (event.type === "delegation") handlers.onDelegation?.(event);
          if (event.type === "run_status") handlers.onRunStatus?.(event);
          if (event.type === "artifact") handlers.onArtifact?.(event);
          if (event.type === "delta") handlers.onDelta?.(event.text);
          if (event.type === "final") finalResult = event.result;
          if (event.type === "error") throw new Error(event.error);
        }
        if (done) break;
      }

      if (!finalResult) throw new Error("Coordinator stream ended before a final message");
      return finalResult;
    } catch (err) {
      if (timedOut) {
        throw new Error(
          `Coordinator stream timed out after ${Math.round(STREAM_INACTIVITY_MS / 1000)}s with no response. The provider may be unreachable.`,
        );
      }
      throw err;
    } finally {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      if (handlers.signal) handlers.signal.removeEventListener("abort", onCallerAbort);
    }
  },
  coordinatorMemory: (query: string, limit = 12) =>
    api<CoordinatorGlobalMemoryPacket>(
      `/coordinator/memory?query=${encodeURIComponent(query)}&limit=${limit}`,
    ),
  memoryBrowser: (input: { query?: string; path?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (input.query) params.set("query", input.query);
    if (input.path) params.set("path", input.path);
    params.set("limit", String(input.limit ?? 80));
    return api<MemoryBrowserResult>(`/memory/browser?${params.toString()}`);
  },
  policyExplain: (limit = 20, signal?: AbortSignal) =>
    api<PolicyExplainResult>(`/policy/explain?limit=${limit}`, { signal }),
  audit: (n = 50, signal?: AbortSignal) => api<AuditEvent[]>(`/audit?n=${n}`, { signal }),
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
  reportDetail: (id: string) => api<ReportDetail>(`/reports/detail?id=${encodeURIComponent(id)}`),
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
  providerSetDefaultModel: (input: { provider: string; id?: string; defaultModel: string }) =>
    api<ProviderConnection[]>("/providers/auth/model", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  providerAuthMethods: () => api<Record<string, ProviderAuthMethod[]>>("/provider/auth"),
  providerOAuthAuthorize: (providerID: string, method: ProviderOAuthMethod = "auto") =>
    api<ProviderAuthAuthorization>(`/provider/${providerID}/oauth/authorize`, {
      method: "POST",
      body: JSON.stringify({ method }),
    }),
  providerOAuthCallback: (
    providerID: string,
    input: { method?: ProviderOAuthMethod; code?: string; defaultModel?: string } = {},
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
