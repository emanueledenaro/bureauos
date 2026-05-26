import type {
  AgentDefinition,
  ApprovalRecord,
  ArtifactRecord,
  AuditEvent,
  CapabilityDefinition,
  ClientIntelligenceSummary,
  ClientRecord,
  CompanyPulse,
  GrowthMemorySummary,
  LocalNotificationRecord,
  OpportunityRecord,
  PolicyExplainResult,
  ProjectOwnershipRecord,
  ProjectRecord,
  ProviderConnection,
  ProviderConnector,
  RunRecord,
  SettingsSummary,
} from "./api";
import type { Tone } from "./tone";

export type AdaptiveMode =
  | "coordinator"
  | "portfolio"
  | "today"
  | "goals"
  | "revenue"
  | "delivery"
  | "growth"
  | "clients"
  | "risk"
  | "approvals"
  | "memory"
  | "agents"
  | "reports"
  | "settings";

export interface DashboardState {
  pulse?: CompanyPulse;
  clients: ClientRecord[];
  clientIntelligence?: ClientIntelligenceSummary;
  projects: ProjectRecord[];
  projectOwnership: ProjectOwnershipRecord[];
  opportunities: OpportunityRecord[];
  growthMemory?: GrowthMemorySummary;
  approvals: ApprovalRecord[];
  resolvedApprovals: ApprovalRecord[];
  notifications: LocalNotificationRecord[];
  runs: RunRecord[];
  agents: AgentDefinition[];
  capabilities: CapabilityDefinition[];
  providers: ProviderConnection[];
  providerConnectors: ProviderConnector[];
  settings?: SettingsSummary;
  artifacts: ArtifactRecord[];
  audit: AuditEvent[];
  policyExplain?: PolicyExplainResult;
  error?: string;
  loading: boolean;
}

export interface Workstream {
  id: string;
  title: string;
  status: string;
  tone: Tone;
  progress: number;
  meta: string;
  delivery?: WorkstreamDeliverySignal;
  badges: string[];
}

export interface WorkstreamPullRequestLink {
  label: string;
  url?: string;
  title?: string;
}

export interface WorkstreamDeliverySignal {
  repository: string;
  label: string;
  detail: string;
  tone: Tone;
  pullRequests: WorkstreamPullRequestLink[];
}

export type LinkedWorkState = "linked" | "missing" | "stale";

export interface LinkedWorkItem {
  id: string;
  runId: string;
  runType: string;
  runScope: string;
  runStatus: string;
  runTone: Tone;
  issueLabel: string;
  issueUrl?: string;
  issueState: LinkedWorkState;
  issueDetail: string;
  pullRequests: WorkstreamPullRequestLink[];
  prState: LinkedWorkState;
  prDetail: string;
  repository: string;
  branch: string;
  commit: string;
  checks: number;
  failingChecks: number;
  staleCount: number;
  created?: string;
}

export interface PortfolioLane {
  key: string;
  label: string;
  subtitle: string;
  capacity: string;
  capacityPercent: number;
  streams: Workstream[];
}

export interface CapacitySegment {
  label: string;
  value: string;
  width: number;
  toneClass: string;
}

export interface TodayAction {
  id: string;
  priority: number;
  tone: Tone;
  source: string;
  title: string;
  detail: string;
  meta: string;
  route: AdaptiveMode;
  created?: string;
}

export interface GoalItem {
  id: string;
  title: string;
  description: string;
  progress: number;
  tone: Tone;
  current: string;
  target: string;
  nextAction: string;
  route: AdaptiveMode;
  signals: string[];
}

export interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  file: File;
  previewUrl?: string;
}
