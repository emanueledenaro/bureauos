export const VERSION = "0.0.0";

// Config
export { BureauConfigSchema } from "./config/schema.js";
export type {
  BureauConfig,
  Preset,
  AutonomyMode,
  ProviderName,
} from "./config/schema.js";
export { loadConfig, defaultConfig, ConfigError } from "./config/loader.js";

// Paths and IDs
export { workspacePaths } from "./paths.js";
export type { WorkspacePaths } from "./paths.js";
export { newId, slugify } from "./ids.js";

// Audit
export { AuditLog } from "./audit/log.js";
export type { AuditEvent, AuditEventInput } from "./audit/log.js";

// Init
export { initWorkspace, InitError } from "./init/initializer.js";
export type { InitOptions, InitResult } from "./init/initializer.js";

// Registries
export {
  parseFrontMatter,
  renderFrontMatter,
  fileExists,
  ensureDir,
  writeDoc,
  readDoc,
  listDocs,
  listDirs,
} from "./registries/base.js";
export type { FrontMatter, ParsedDocument } from "./registries/base.js";

export { ClientRegistry } from "./registries/client.js";
export type { ClientRecord, ClientStatus, CreateClientInput } from "./registries/client.js";

export { ProjectRegistry } from "./registries/project.js";
export type { ProjectRecord, ProjectStatus, CreateProjectInput } from "./registries/project.js";

export { OpportunityRegistry } from "./registries/opportunity.js";
export type {
  OpportunityRecord,
  OpportunityStatus,
  CreateOpportunityInput,
} from "./registries/opportunity.js";

export { ApprovalRegistry } from "./registries/approval.js";
export type { ApprovalRecord, ApprovalStatus, CreateApprovalInput } from "./registries/approval.js";

// Policy
export { PolicyEngine } from "./policy/engine.js";
export type { PolicyInput, PolicyDecision, PolicyOutcome, RiskClass } from "./policy/engine.js";

// Artifacts
export { ArtifactStore } from "./artifacts/store.js";
export type { ArtifactRecord, ArtifactType, WriteArtifactInput } from "./artifacts/store.js";

// Runs
export { RunEngine } from "./runs/engine.js";
export type {
  RunRecord,
  RunStatus,
  RunType,
  RunTriggerType,
  StartRunInput,
  RunEngineDeps,
} from "./runs/engine.js";

// Agents
export { AGENT_ROLES, AGENT_INDEX, getAgent, agentsByCategory } from "./agents/roles.js";
export type { AgentDefinition, AgentCategory, AgentScope } from "./agents/roles.js";

// API server
export { startApiServer } from "./api/server.js";
export type { ApiServerOptions, ApiServer } from "./api/server.js";
