export const VERSION = "0.0.0";

// Config
export { BureauConfigSchema, autonomyLevelName } from "./config/schema.js";
export type {
  BureauConfig,
  Preset,
  AutonomyMode,
  AutonomyLevel,
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
export type {
  CreateProjectInput,
  ProjectOwnershipInput,
  ProjectOwnershipRecord,
  ProjectOwnershipStatus,
  ProjectRecord,
  ProjectStatus,
} from "./registries/project.js";

export { OpportunityRegistry } from "./registries/opportunity.js";
export type {
  OpportunityRecord,
  OpportunityStatus,
  CreateOpportunityInput,
} from "./registries/opportunity.js";

export { ApprovalRegistry } from "./registries/approval.js";
export type { ApprovalRecord, ApprovalStatus, CreateApprovalInput } from "./registries/approval.js";

export { LocalNotificationCenter } from "./notifications/local.js";
export type {
  ApprovalNotificationInput,
  ApprovalNotificationSink,
  CreateLocalNotificationInput,
  LocalNotificationRecord,
  LocalNotificationSeverity,
  LocalNotificationStatus,
  LocalNotificationType,
} from "./notifications/local.js";

export { CompanyRegistry } from "./registries/company.js";
export type { CompanyRecord } from "./registries/company.js";

// Client intelligence
export { ClientIntelligenceService } from "./clients/intelligence.js";
export type {
  ClientAccountRisk,
  ClientClassification,
  ClientPaymentReliability,
  ClientProofPermission,
  ClientIntelligenceDeps,
  ClientIntelligenceItem,
  ClientIntelligenceSummary,
  ClientOpportunitySnapshot,
  ClientProjectSnapshot,
  ClientRevenueTier,
  ClientStrategicValue,
  ClientRelationshipHealth,
  ClientValueScore,
} from "./clients/intelligence.js";
export { ClientAccountPlanService } from "./clients/account-plans.js";
export type {
  ClientAccountPlanDeps,
  ClientAccountPlanInput,
  ClientAccountPlanResult,
} from "./clients/account-plans.js";
export { ClientSuccessStatusService } from "./clients/success-status.js";
export type {
  ClientSuccessStatusDeps,
  ClientSuccessStatusInput,
  ClientSuccessStatusResult,
} from "./clients/success-status.js";

// Memory helpers
export { appendDailyNote } from "./memory/daily.js";
export type { DailyNoteSection } from "./memory/daily.js";
export { appendDecision, recordDecision } from "./memory/decisions.js";
export type { DecisionInput, DecisionWriteResult } from "./memory/decisions.js";
export { writeRunOutcomeMemory } from "./memory/run-outcomes.js";
export type { RunOutcomeWritebackDeps, RunOutcomeWritebackResult } from "./memory/run-outcomes.js";
export {
  memoryIndexForConfig,
  memoryStoreForConfig,
  resolveSearchIndexPath,
} from "./memory/index-path.js";
export { createSemanticMemoryIndex } from "./memory/semantic-index.js";
export type { SemanticMemoryIndexFactoryDeps } from "./memory/semantic-index.js";
export {
  MEMORY_BOUNDARY_CAPABILITY,
  MEMORY_CAPABILITY,
  MemoryBoundaryService,
} from "./memory/isolation.js";
export type {
  AgentMemoryBoundary,
  AgentMemoryCapability,
  MemoryBoundaryDeps,
  MemoryBoundaryInput,
} from "./memory/isolation.js";
export {
  GLOBAL_MEMORY_ACTOR,
  GLOBAL_MEMORY_CAPABILITY,
  CoordinatorGlobalMemoryService,
} from "./memory/global.js";
export type {
  CoordinatorGlobalMemoryDeps,
  CoordinatorGlobalMemoryHit,
  CoordinatorGlobalMemoryInput,
  CoordinatorGlobalMemoryPacket,
} from "./memory/global.js";

// Policy
export { PolicyEngine } from "./policy/engine.js";
export type { PolicyInput, PolicyDecision, PolicyOutcome, RiskClass } from "./policy/engine.js";
export { PolicyExplainService } from "./policy/explain.js";
export type {
  PolicyExplainDecision,
  PolicyExplainOptions,
  PolicyExplainOutcome,
  PolicyExplainResult,
} from "./policy/explain.js";

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
  RunDispatcher,
  RunDispatchInput,
  RunDispatchResult,
  RunDispatchTerminalStatus,
} from "./runs/engine.js";
export { createCoordinatorRunDispatcher, dispatchRun } from "./runs/coordinator.js";
export type {
  DispatchInput,
  DispatchOutput,
  DispatchStep,
  CoordinatorDeps,
} from "./runs/coordinator.js";

// Supreme coordinator
export { CoordinatorIntakeService } from "./coordinator/intake.js";
export type {
  CoordinatorIntakeDeps,
  CoordinatorIntakeInput,
  CoordinatorIntakeResult,
  IntakeClassification,
} from "./coordinator/intake.js";
export { CoordinatorChatService } from "./coordinator/chat.js";
export type {
  CoordinatorChatDeps,
  CoordinatorChatInput,
  CoordinatorChatProviderMeta,
  CoordinatorChatResult,
  CoordinatorChatStreamEvent,
} from "./coordinator/chat.js";
export {
  COORDINATOR_MUTATION_PATH_INVENTORY,
  COORDINATOR_TOOL_DEFINITIONS,
  coordinatorToolPromptCatalog,
  implementedCoordinatorToolNames,
  listCoordinatorMutationPathInventory,
  parseCoordinatorToolPlan,
} from "./coordinator/tool-planning.js";
export type {
  CoordinatorImplementedToolAction,
  CoordinatorMutationPathInventoryItem,
  CoordinatorToolAction,
  CoordinatorToolDefinition,
  CoordinatorToolPlan,
  CoordinatorToolRouteClass,
} from "./coordinator/tool-planning.js";
export { CoordinatorToolRuntime, coordinatorToolMeta } from "./coordinator/tool-runtime.js";
export type {
  CoordinatorCreateIntakeToolExecution,
  CoordinatorCreateIntakeToolInput,
  CoordinatorToolExecutionSource,
  CoordinatorToolMeta,
  CoordinatorToolRuntimeDeps,
} from "./coordinator/tool-runtime.js";
export { CoordinatorMessageStore } from "./coordinator/messages.js";
export type {
  CoordinatorMessageAttachment,
  CoordinatorMessageInput,
  CoordinatorMessageRecord,
} from "./coordinator/messages.js";

// Project dispatch
export { ProjectDispatchService } from "./dispatch/project-dispatch.js";
export type {
  AgentHandoff,
  ProjectDispatchDeps,
  ProjectDispatchInput,
  ProjectDispatchResult,
} from "./dispatch/project-dispatch.js";

// Agents
export { AGENT_ROLES, AGENT_INDEX, getAgent, agentsByCategory } from "./agents/roles.js";
export type { AgentDefinition, AgentCategory, AgentScope } from "./agents/roles.js";
export { AgentRegistry, StubAgent } from "./agents/runtime.js";
export type {
  AgentRuntime,
  AgentRunInput,
  AgentRunOutput,
  AgentContext,
  AgentDeps,
  AgentCapabilityChecker,
  AgentCapabilityCheckInput,
  AgentCapabilityCheckResult,
} from "./agents/runtime.js";
export {
  MODEL_PROVIDER_CAPABILITY,
  configureAgentProviderRouting,
  providerChainForRole,
  selectAgentModel,
} from "./agents/provider-routing.js";
export type { AgentModelSelection } from "./agents/provider-routing.js";
export {
  buildDefaultAgentRegistry,
  ProjectManagerAgent,
  ProductAgent,
  DevelopmentAgent,
  QaAgent,
  SecurityAgent,
  ComplianceAgent,
} from "./agents/concrete/index.js";
export {
  agentHandoffBody,
  agentHandoffMetadata,
  blockedByInvalidHandoff,
  validateAgentHandoff,
  validateRequiredHandoff,
} from "./agents/handoff.js";
export type {
  AgentHandoffContract,
  AgentHandoffContractInput,
  AgentHandoffValidation,
} from "./agents/handoff.js";

// Reports
export { BusinessReportService } from "./reports/business.js";
export type {
  BusinessMetrics,
  BusinessReportDeps,
  BusinessReportResult,
  ProjectPortfolioItem,
  ProjectPortfolioRisk,
} from "./reports/business.js";

// Growth and revenue memory
export { GrowthMemoryService } from "./growth/memory.js";
export type {
  GrowthMemoryDeps,
  GrowthMemorySection,
  GrowthMemorySectionId,
  GrowthMemoryStatus,
  GrowthMemorySummary,
  GrowthMemoryUpdateInput,
} from "./growth/memory.js";
export { GrowthContentPipelineService } from "./growth/content-pipeline.js";
export type {
  GrowthContentDraftKind,
  GrowthContentPipelineDeps,
  GrowthContentPipelineDraft,
  GrowthContentPipelineInput,
  GrowthContentPipelineResult,
} from "./growth/content-pipeline.js";
export { RevenuePipelineService } from "./revenue/pipeline.js";
export type {
  RevenuePipelineDeps,
  RevenuePipelineFit,
  RevenuePipelineInput,
  RevenuePipelineItem,
  RevenuePipelineResult,
  RevenuePipelineStage,
} from "./revenue/pipeline.js";

// Always-on operational signals
export { OperationalSignalTriggerService } from "./autonomy/operational-triggers.js";
export type {
  OperationalSignalThresholds,
  OperationalSignalTriggerDeps,
  OperationalSignalTriggerInput,
  OperationalSignalTriggerKind,
  OperationalSignalTriggerResult,
  SkippedOperationalSignal,
  TriggeredOperationalRun,
} from "./autonomy/operational-triggers.js";
export { MemoryTriggerService } from "./autonomy/memory-triggers.js";
export type {
  MemoryTriggerDeps,
  MemoryTriggerInput,
  MemoryTriggerKind,
  MemoryTriggerResult,
  SkippedMemoryTrigger,
  TriggeredMemoryRun,
} from "./autonomy/memory-triggers.js";
export { AutonomousRetryService } from "./autonomy/retry.js";
export type {
  AutonomousRetryDeps,
  AutonomousRetryInput,
  AutonomousRetryResult,
  AutonomousRetryStatus,
  EscalatedAutonomousRetry,
  SkippedAutonomousRetry,
  TriggeredAutonomousRetry,
} from "./autonomy/retry.js";
export { ProjectHealthReviewService } from "./autonomy/project-health.js";
export type {
  ProjectHealthItem,
  ProjectHealthReviewDeps,
  ProjectHealthReviewInput,
  ProjectHealthReviewResult,
  ProjectHealthRisk,
} from "./autonomy/project-health.js";
export { ProjectRepositoryVerificationService } from "./autonomy/repository-verification.js";
export type {
  ProjectRepositoryVerificationDeps,
  ProjectRepositoryVerificationInput,
  ProjectRepositoryVerificationResult,
  RepositoryVerificationItem,
  RepositoryVerificationStatus,
} from "./autonomy/repository-verification.js";

// Growth reviews
export { GrowthReviewService } from "./growth/review.js";
export type { GrowthReviewDeps, GrowthReviewInput, GrowthReviewResult } from "./growth/review.js";

// Capability usage
export { CapabilityUseService } from "./capabilities/usage.js";
export type {
  CapabilityUseDeps,
  CapabilityUseInput,
  CapabilityUseResult,
} from "./capabilities/usage.js";

// Linear work scope ingestion
export { LinearIssueActionService } from "./linear/issue-actions.js";
export { LinearIssueIngestionService } from "./linear/issue-ingestion.js";
export { LinearIssueReaderService } from "./linear/issue-reader.js";
export { linearIssueToRunScope } from "./linear/work-scope.js";
export type {
  LinearIssueActionAdapter,
  LinearIssueActionBaseInput,
  LinearIssueActionDeps,
  LinearIssueActionExternalResult,
  LinearIssueActionResult,
  LinearIssueCommentAdapterInput,
  LinearIssueCommentInput,
  LinearIssueStateAdapterInput,
  LinearIssueStateInput,
  LinearIssueUpdateAdapterInput,
  LinearIssueUpdateInput,
} from "./linear/issue-actions.js";
export type {
  LinearIssueIngestionDeps,
  LinearIssueIngestionInput,
  LinearIssueIngestionResult,
} from "./linear/issue-ingestion.js";
export type {
  LinearIssueAdapter,
  LinearIssueListInput,
  LinearIssueListResult,
  LinearIssueReaderDeps,
  LinearIssueReadInput,
  LinearIssueReadResult,
} from "./linear/issue-reader.js";
export type { LinearIssueRunScope, LinearIssueScopeInput } from "./linear/work-scope.js";

// Source work item metadata
export {
  linearIssueSourceWorkItem,
  sourceWorkItemFromFrontMatter,
  sourceWorkItemFromTriggerSource,
  sourceWorkItemFrontMatter,
  sourceWorkItemLabel,
} from "./work-items/source.js";
export type { SourceWorkItemInput } from "./work-items/source.js";

// Development execution helpers
export {
  DevelopmentBranchService,
  branchNameForDevelopmentRun,
} from "./execution/development-branch.js";
export type {
  DevelopmentBranchClient,
  DevelopmentBranchCreateRequest,
  DevelopmentBranchInput,
  DevelopmentBranchResult,
  DevelopmentBranchSafety,
  DevelopmentBranchServiceDeps,
} from "./execution/development-branch.js";
export {
  ProjectTestRunnerService,
  SubprocessProjectCommandRunner,
  resolveProjectTestCommand,
} from "./execution/project-test-runner.js";
export type {
  ProjectCommandRunner,
  ProjectCommandRunnerOptions,
  ProjectTestCommand,
  ProjectTestExecution,
  ProjectTestRunnerDeps,
  ProjectTestRunnerInput,
  ProjectTestRunnerResult,
  ResolvedProjectTestCommand,
} from "./execution/project-test-runner.js";
export { buildCodexRuntimeFromConfig } from "./execution/codex-runtime.js";
export type { BuildCodexRuntimeOptions } from "./execution/codex-runtime.js";

// Provider auth
export {
  authorizeOpenAICodexOAuth,
  completeOpenAICodexOAuth,
  providerAuthMethods,
} from "./providers/openai-codex-oauth-session.js";
export type {
  ProviderAuthAuthorization,
  ProviderOAuthCallbackInput,
  ProviderOAuthCallbackResult,
  ProviderOAuthMethod,
} from "./providers/openai-codex-oauth-session.js";
export type { ProviderAuthMethod } from "@bureauos/providers";

// GitHub planning
export { GitHubIssueDraftService } from "./github/issue-drafts.js";
export type {
  GitHubIssueDraft,
  GitHubIssueDraftDeps,
  GitHubIssueDraftResult,
} from "./github/issue-drafts.js";
export { GitHubIssuePublishService } from "./github/issue-publisher.js";
export type {
  GitHubIssuePublishClient,
  GitHubIssuePublishClientIssue,
  GitHubIssuePublishDeps,
  GitHubIssuePublishInput,
  GitHubIssuePublishResult,
  EnsureRepositoryLabelsInput,
  EnsureRepositoryLabelsResult,
} from "./github/issue-publisher.js";
export { GitHubPullRequestPublishService } from "./github/pr-publisher.js";
export type {
  GitHubPullRequestPublishClient,
  GitHubPullRequestPublishClientPr,
  GitHubPullRequestPublishDeps,
  GitHubPullRequestPublishInput,
  GitHubPullRequestPublishResult,
} from "./github/pr-publisher.js";
export { GitHubRepositoryProvisionService } from "./github/repository-provisioner.js";
export type {
  GitHubRepositoryProvisionClient,
  GitHubRepositoryProvisionClientRepo,
  GitHubRepositoryProvisionDeps,
  GitHubRepositoryProvisionInput,
  GitHubRepositoryProvisionResult,
} from "./github/repository-provisioner.js";
export { parseGitHubRepository } from "./github/repository-utils.js";
export type { ParsedGitHubRepository } from "./github/repository-utils.js";
export { GitHubSignalSyncService } from "./github/signal-sync.js";
export type {
  GitHubSignalCheckConclusion,
  GitHubSignalCheckRun,
  GitHubSignalClient,
  GitHubSignalIssue,
  GitHubSignalPullRequest,
  GitHubSignalSyncDeps,
  GitHubSignalSyncInput,
  GitHubSignalSyncResult,
} from "./github/signal-sync.js";
export { GitHubWebhookIngestionService } from "./github/webhook-ingestion.js";
export type {
  GitHubWebhookIngestInput,
  GitHubWebhookIngestResult,
  GitHubWebhookIngestionDeps,
} from "./github/webhook-ingestion.js";
export { GitHubSignalTriggerService } from "./github/signal-triggers.js";
export type {
  GitHubSignalTriggerDeps,
  GitHubSignalTriggerInput,
  GitHubSignalTriggerKind,
  GitHubSignalTriggerResult,
  SkippedGitHubSignal,
  TriggeredGitHubRun,
} from "./github/signal-triggers.js";

// API server
export { startApiServer } from "./api/server.js";
export type { ApiServerOptions, ApiServer } from "./api/server.js";

// Daemon
export { Scheduler } from "./daemon/scheduler.js";
export type { SchedulerOptions } from "./daemon/scheduler.js";
export { DaemonSchedulerStateStore, DaemonStateStore } from "./daemon/state.js";
export type {
  SchedulerCursorRecord,
  SchedulerStateRecord,
  DaemonStateRecord,
  DaemonStatus,
  DaemonSchedulerStatus,
  DaemonHeartbeat,
  DaemonHeartbeatLastRun,
  DaemonHeartbeatLastError,
  DaemonDiagnosticEvent,
  DaemonStatusSnapshot,
  DaemonLockRecord,
  DaemonLockSnapshot,
  DaemonLockAcquisition,
  ProcessAliveCheck,
} from "./daemon/state.js";
export { DaemonLifecycleSupervisor } from "./daemon/supervisor.js";
export type {
  DaemonLifecycleSupervisorOptions,
  DaemonSpawn,
  DaemonKill,
  DaemonStartResult,
  DaemonStopResult,
  SpawnedDaemonProcess,
} from "./daemon/supervisor.js";
