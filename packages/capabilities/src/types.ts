export type RiskClass = "low" | "medium" | "high" | "critical";

export interface CapabilityDefinition {
  id: string;
  name: string;
  type: "mcp" | "runtime" | "skill" | "shell" | "browser" | "custom";
  allowed_agents: readonly string[];
  actions: Readonly<Record<string, boolean>>;
  required_approvals: readonly string[];
  risk_class: RiskClass;
  audit_required: boolean;
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
