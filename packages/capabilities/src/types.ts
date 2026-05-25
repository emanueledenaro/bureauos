export type RiskClass = "low" | "medium" | "high" | "critical";
export type CapabilityType =
  | "mcp"
  | "runtime"
  | "skill"
  | "registry"
  | "tool_bus"
  | "shell"
  | "browser"
  | "custom";

export type CapabilityStatus = "available" | "configured" | "designed" | "blocked";

export interface CapabilityDefinition {
  id: string;
  name: string;
  description: string;
  type: CapabilityType;
  allowed_agents: readonly string[];
  actions: Readonly<Record<string, boolean>>;
  required_approvals: readonly string[];
  risk_class: RiskClass;
  audit_required: boolean;
  status: CapabilityStatus;
  connector?: string;
}

export interface CapabilityUseRecord {
  capability_id: string;
  agent: string;
  action: string;
  target: string;
  approval_id?: string;
  result: "ok" | "error";
  artifact_id?: string;
}

export interface CapabilityUseRequest {
  capability_id: string;
  agent: string;
  action: string;
  target?: string;
}

export interface CapabilityUseDecision {
  capability_id: string;
  agent: string;
  action: string;
  allowed: boolean;
  reason: string;
  required_approvals: readonly string[];
  risk_class: RiskClass;
  audit_required: boolean;
  status: CapabilityStatus;
}
