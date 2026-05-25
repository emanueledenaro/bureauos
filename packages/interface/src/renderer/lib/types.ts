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
  OpportunityRecord,
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
  runs: RunRecord[];
  agents: AgentDefinition[];
  capabilities: CapabilityDefinition[];
  providers: ProviderConnection[];
  providerConnectors: ProviderConnector[];
  settings?: SettingsSummary;
  artifacts: ArtifactRecord[];
  audit: AuditEvent[];
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
  github?: string;
  badges: string[];
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
