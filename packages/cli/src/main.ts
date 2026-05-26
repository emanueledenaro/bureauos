import { readFile } from "node:fs/promises";
import {
  ApprovalRegistry,
  ArtifactStore,
  AuditLog,
  AutonomousRetryService,
  BusinessReportService,
  CapabilityUseService,
  ClientAccountPlanService,
  ClientIntelligenceService,
  ClientRegistry,
  ClientSuccessStatusService,
  ConfigError,
  CoordinatorToolRuntime,
  DaemonStateStore,
  DaemonLifecycleSupervisor,
  GitHubIssueDraftService,
  GitHubIssuePublishService,
  GitHubPullRequestPublishService,
  GitHubRepositoryProvisionService,
  GitHubSignalTriggerService,
  GitHubSignalSyncService,
  GrowthContentPipelineService,
  GrowthMemoryService,
  GrowthReviewService,
  InitError,
  MemoryTriggerService,
  OpportunityRegistry,
  PolicyEngine,
  ProjectDispatchService,
  ProjectHealthReviewService,
  ProjectRepositoryVerificationService,
  ProjectRegistry,
  RevenuePipelineService,
  RunEngine,
  Scheduler,
  VERSION,
  appendDailyNote,
  createCoordinatorRunDispatcher,
  autonomyLevelName,
  defaultConfig,
  initWorkspace,
  loadConfig,
  linearIssueSourceWorkItem,
  recordDecision,
  startApiServer,
  sourceWorkItemFromTriggerSource,
  sourceWorkItemLabel,
  workspacePaths,
  type BureauConfig,
  type CreateProjectInput,
  type DailyNoteSection,
  type Preset,
  type RunType,
} from "@bureauos/core";
import { LocalMemoryStore } from "@bureauos/memory";
import {
  ProviderAuthStore,
  buildConfiguredProviderRouter,
  maskSecret,
  type ProviderType,
} from "@bureauos/providers";
import {
  CapabilityRegistry,
  GITHUB_LABEL_TAXONOMY,
  OctokitGitHubClient,
} from "@bureauos/capabilities";

const HELP = `bureau ${VERSION}

Usage:
  bureau <command> [options]

Workspace:
  init [--preset p] [--name n] [--force]   Initialize a new BureauOS workspace
  status                                    Show company pulse
  intake --message <m> [--client n]         Let the Supreme Coordinator create client/project/opportunity work
  config validate [path]                    Validate the local bureauos.yaml

Memory:
  memory search <query>                     Search executive and project memory

Registries:
  client create --name <n> [--status s] [--industry i]
  client list
  client intelligence                       Show value, delivery, and relationship memory per client
  client account-plan [--client slug]       Generate client account plan artifacts from intelligence
  client success-status [--client slug]     Generate client-success status reports and draft follow-ups
  project create --name <n> --client <slug> [--status s] [--repo url] [--stack s] [--manager-agent id]
  project dispatch --project <slug> [--type feature] [--scope s]
  project health [--project slug]           Generate project health review artifacts
  project verify-repositories [--project slug]
                                            Verify linked repositories without mutating code
  project list
  opportunity create --title <t> --source <s> --client <slug> [--value v] [--margin m]
  opportunity list
  revenue pipeline [--opportunity id] [--max-opportunities n]
                                            Qualify opportunities and draft pricing/proposal work
  growth memory                            Show brand, offer, and channel memory
  growth memory set [--brand t] [--offers t] [--channels t]
  growth content [--max-drafts n] [--focus t]
                                            Generate draft-only social/campaign/creative/ads content
  growth review [--recent-days n]           Generate growth review artifact

Runs and audit:
  run new --type <t> --scope <s> [--client slug] [--project slug] [--linear-issue id] [--linear-url u] [--stub]
  run list
  autonomy memory-scan                      Start due follow-up runs from durable memory
  autonomy retry-scan [--max-attempts n]    Retry failed/blocked runs within policy limits
  audit tail [-n N]
  audit search <q>

Reports:
  report generate                           Generate executive, cross-project, and operating reports

Memory write:
  decision --what "..." --why "..." [--run id]   Append a decision record
  follow-up --section Events|Decisions|Runs|Follow-ups --line "..."

Policy:
  policy explain <action> [--actor a] [--target t]

Approvals:
  approvals list
  approvals approve <id> [--reason r]
  approvals reject <id> [--reason r]

Providers:
  auth login --provider p [--api-key k] [--base-url u] [--model m]
  auth login --provider openai-codex --access-token t [--refresh-token t] [--model m]
  auth list
  auth logout --provider p [--id provider-default]
  providers list

Capabilities:
  capabilities list                         Show agent tool/runtime capability boundaries
  capabilities check --agent A --capability C --action X
                                            Audit a policy-bounded capability-use request

Server:
  serve [--port N]                          Start the local HTTP API server
  daemon start [--port N]                   Start scheduler + API server in the background
  daemon stop                               Stop the recorded daemon process
  daemon status                             Show daemon PID, API URL, and scheduler state
  daemon run [--port N]                     Run scheduler + API server in foreground

GitHub:
  github provision-repo --project slug --owner O [--repo R]
                                            Create and link a policy-gated GitHub repository
  github draft-issues --project slug         Generate GitHub-ready issue drafts from project artifacts
  github create-issues --project slug --owner O --repo R
                                            Create GitHub issues from approved drafts under policy
  github create-pr --project slug --owner O --repo R --head H --title T
                                            Open a policy-gated GitHub pull request
  github ensure-labels --owner O --repo R   Apply the BureauOS label taxonomy
  github sync --owner O --repo R [--project slug] [--state]
                                            Pull issues, PRs, and check signals into memory

Misc:
  --version | -v       Print version
  --help | -h          This help
`;

type Handler = (args: readonly string[]) => Promise<number>;

const PRESETS: ReadonlySet<Preset> = new Set(["freelancer", "agency", "startup", "operator"]);
const PROVIDER_TYPES: ReadonlySet<ProviderType> = new Set([
  "openai-codex",
  "openai",
  "anthropic",
  "google",
  "local",
  "openrouter",
  "custom",
]);
const RUN_TYPES: ReadonlySet<RunType> = new Set([
  "feature",
  "bug",
  "review",
  "release",
  "planning",
  "retrospective",
  "visibility",
  "content",
  "campaign",
  "conversion",
  "sales",
  "social",
  "creative",
  "ads",
  "compliance",
  "client_success",
  "intake",
  "health_check",
]);

function parseFlags(
  args: readonly string[],
  schema: Record<string, { type: "string" | "number" | "boolean"; alias?: string }>,
): Record<string, string | number | boolean | undefined> | string {
  const out: Record<string, string | number | boolean | undefined> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg || !arg.startsWith("--")) {
      // also accept -X aliases
      if (arg && arg.startsWith("-") && arg.length === 2) {
        const aliasMatch = Object.entries(schema).find(([, def]) => def.alias === arg.slice(1));
        if (aliasMatch) {
          const [name, def] = aliasMatch;
          if (def.type === "boolean") {
            out[name] = true;
            continue;
          }
          const next = args[i + 1];
          if (next === undefined) return `missing value for ${arg}`;
          out[name] = def.type === "number" ? Number(next) : next;
          i++;
          continue;
        }
      }
      return `unexpected argument "${arg ?? ""}"`;
    }
    const key = arg.slice(2);
    const def = schema[key];
    if (!def) return `unknown option "--${key}"`;
    if (def.type === "boolean") {
      out[key] = true;
      continue;
    }
    const next = args[i + 1];
    if (next === undefined) return `missing value for --${key}`;
    out[key] = def.type === "number" ? Number(next) : next;
    i++;
  }
  return out;
}

function err(message: string): number {
  process.stderr.write(`bureau: ${message}\n`);
  return 1;
}

function parseDailyNoteSection(value: string | undefined): DailyNoteSection | undefined {
  const section = value ?? "Follow-ups";
  if (
    section === "Events" ||
    section === "Runs" ||
    section === "Decisions" ||
    section === "Follow-ups"
  ) {
    return section;
  }
  return undefined;
}

async function loadWorkspaceConfig(cwd: string): Promise<BureauConfig> {
  const paths = workspacePaths(cwd);
  try {
    return await loadConfig(paths.configFile);
  } catch (e) {
    if (e instanceof ConfigError) {
      throw new Error(`no workspace at ${paths.workspaceDir} (run \`bureau init\` first)`);
    }
    throw e;
  }
}

function githubClientFromEnv(): OctokitGitHubClient | undefined {
  const token = process.env["GITHUB_TOKEN"];
  return token ? new OctokitGitHubClient({ token }) : undefined;
}

function parseProvider(value: unknown): ProviderType | undefined {
  if (typeof value !== "string") return undefined;
  return PROVIDER_TYPES.has(value as ProviderType) ? (value as ProviderType) : undefined;
}

function defaultProviderId(provider: ProviderType): string {
  return `${provider}-default`;
}

function providerAuthStore(): ProviderAuthStore {
  return ProviderAuthStore.forWorkspace(process.cwd());
}

async function auditProviderAuth(action: string, target: string): Promise<void> {
  await new AuditLog(workspacePaths(process.cwd()).auditLog).append({
    actor: "owner",
    action,
    target,
    result: "ok",
  });
}

// --- Handlers ---

const handleInit: Handler = async (args) => {
  const flags = parseFlags(args, {
    preset: { type: "string", alias: "p" },
    name: { type: "string", alias: "n" },
    force: { type: "boolean", alias: "f" },
    help: { type: "boolean", alias: "h" },
  });
  if (typeof flags === "string") return err(`init: ${flags}`);
  if (flags.help) {
    process.stdout.write(
      "bureau init [--preset freelancer|agency|startup|operator] [--name <n>] [--force]\n",
    );
    return 0;
  }
  if (typeof flags.preset === "string" && !PRESETS.has(flags.preset as Preset)) {
    return err(`init: unknown preset "${flags.preset}"`);
  }
  try {
    const result = await initWorkspace({
      root: process.cwd(),
      ...(typeof flags.preset === "string" ? { preset: flags.preset as Preset } : {}),
      ...(typeof flags.name === "string" ? { organizationName: flags.name } : {}),
      force: flags.force === true,
    });
    process.stdout.write(`bureau: initialized workspace at ${result.workspaceDir}\n`);
    process.stdout.write(`bureau: ${result.filesCreated.length} files created\n`);
    process.stdout.write(`bureau: config written to ${result.configFile}\n`);
    return 0;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof InitError) return err(`init: ${message}`);
    return err(`init: ${message}`);
  }
};

const handleStatus: Handler = async () => {
  try {
    const config = await loadWorkspaceConfig(process.cwd());
    const clients = await new ClientRegistry(process.cwd()).list();
    const projects = await new ProjectRegistry(process.cwd()).list();
    const opportunities = await new OpportunityRegistry(process.cwd()).list();
    const approvals = await new ApprovalRegistry(process.cwd()).listPending();
    const runs = await new RunEngine(process.cwd(), {
      audit: new AuditLog(workspacePaths(process.cwd()).auditLog),
      artifacts: new ArtifactStore(process.cwd()),
      policy: new PolicyEngine(config, new ApprovalRegistry(process.cwd())),
    }).list();
    const lines = [
      `Workspace: ${config.organization.name}`,
      `Preset:    ${config.setup.preset}`,
      `Mode:      ${config.setup.mode}`,
      "",
      `Clients:        ${clients.length}`,
      `Projects:       ${projects.length}`,
      `Opportunities:  ${opportunities.length}`,
      `Runs:           ${runs.length}`,
      `Approvals pending: ${approvals.length}`,
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  } catch (e) {
    return err(`status: ${(e as Error).message}`);
  }
};

const handleIntake: Handler = async (args) => {
  const flags = parseFlags(args, {
    message: { type: "string", alias: "m" },
    client: { type: "string", alias: "c" },
    project: { type: "string", alias: "p" },
    source: { type: "string" },
    value: { type: "number" },
    margin: { type: "number" },
    industry: { type: "string" },
  });
  if (typeof flags === "string") return err(`intake: ${flags}`);
  if (typeof flags.message !== "string") return err("intake: --message is required");
  const config = await loadWorkspaceConfig(process.cwd());
  const runtime = new CoordinatorToolRuntime(process.cwd(), { config });
  const execution = await runtime.executeCreateIntake({
    message: flags.message,
    source: typeof flags.source === "string" ? flags.source : "cli",
    ...(typeof flags.client === "string" ? { clientName: flags.client } : {}),
    ...(typeof flags.project === "string" ? { projectName: flags.project } : {}),
    ...(typeof flags.industry === "string" ? { industry: flags.industry } : {}),
    ...(typeof flags.value === "number" ? { expectedValue: flags.value } : {}),
    ...(typeof flags.margin === "number" ? { expectedMargin: flags.margin } : {}),
    toolSource: "cli",
  });
  const result = execution.result;

  process.stdout.write(`bureau: ${result.summary}\n`);
  process.stdout.write(`client:      ${result.client.id} (${result.client.slug})\n`);
  process.stdout.write(`project:     ${result.project.id} (${result.project.slug})\n`);
  process.stdout.write(`opportunity: ${result.opportunity.id}\n`);
  process.stdout.write(`run:         ${result.run.id}\n`);
  process.stdout.write(`artifacts:   ${result.artifacts.map((a) => a.id).join(", ")}\n`);
  if (result.approvals.length > 0) {
    process.stdout.write(`approvals:   ${result.approvals.map((a) => a.id).join(", ")}\n`);
  }
  return 0;
};

const handleConfigValidate: Handler = async (args) => {
  const path = args[0] ?? workspacePaths(process.cwd()).configFile;
  try {
    const config = await loadConfig(path);
    process.stdout.write(
      `bureau: config OK (${config.organization.name}, preset ${config.setup.preset})\n`,
    );
    return 0;
  } catch (e) {
    return err(`config validate: ${(e as Error).message}`);
  }
};

const handleMemorySearch: Handler = async (args) => {
  const query = args.join(" ").trim();
  if (!query) return err("memory search: missing query");
  const store = new LocalMemoryStore(workspacePaths(process.cwd()).memoryDir);
  const hits = await store.search(query, { limit: 20 });
  if (hits.length === 0) {
    process.stdout.write("(no matches)\n");
    return 0;
  }
  for (const h of hits) {
    process.stdout.write(`${h.score.toString().padStart(4)}  ${h.path}\n`);
    process.stdout.write(`      ${h.snippet}\n`);
  }
  return 0;
};

const handleClientCreate: Handler = async (args) => {
  const flags = parseFlags(args, {
    name: { type: "string", alias: "n" },
    status: { type: "string" },
    industry: { type: "string" },
  });
  if (typeof flags === "string") return err(`client create: ${flags}`);
  if (typeof flags.name !== "string") return err("client create: --name is required");
  const registry = new ClientRegistry(process.cwd());
  const record = await registry.create({
    name: flags.name,
    ...(typeof flags.status === "string"
      ? { status: flags.status as "lead" | "active" | "paused" | "churned" }
      : {}),
    ...(typeof flags.industry === "string" ? { industry: flags.industry } : {}),
  });
  await new AuditLog(workspacePaths(process.cwd()).auditLog).append({
    actor: "cli",
    action: "client.create",
    target: record.id,
    result: "ok",
  });
  process.stdout.write(`bureau: created client ${record.id} (${record.slug})\n`);
  return 0;
};

const handleClientList: Handler = async () => {
  const registry = new ClientRegistry(process.cwd());
  const all = await registry.list();
  if (all.length === 0) {
    process.stdout.write("(no clients)\n");
    return 0;
  }
  for (const c of all) {
    process.stdout.write(`${c.id}  ${c.slug.padEnd(24)}  ${c.status.padEnd(10)}  ${c.name}\n`);
  }
  return 0;
};

const handleClientIntelligence: Handler = async () => {
  const summary = await new ClientIntelligenceService(process.cwd()).summarize();
  if (summary.clients.length === 0) {
    process.stdout.write("(no clients)\n");
    return 0;
  }
  process.stdout.write(
    `clients: ${summary.totals.clients} | pipeline: ${summary.totals.pipeline_value} | won: ${summary.totals.won_value} | follow-ups due: ${summary.totals.follow_ups_due}\n`,
  );
  for (const item of summary.clients) {
    process.stdout.write(
      `${item.client.slug.padEnd(24)}  ${item.risk.padEnd(14)}  pipeline=${String(item.revenue.pipeline_value).padEnd(8)}  won=${String(item.revenue.won_value).padEnd(8)}  projects=${item.delivery.projects_total}\n`,
    );
    process.stdout.write(`  next: ${item.next_action}\n`);
  }
  return 0;
};

const handleClientAccountPlan: Handler = async (args) => {
  const flags = parseFlags(args, {
    client: { type: "string", alias: "c" },
    run: { type: "string" },
  });
  if (typeof flags === "string") return err(`client account-plan: ${flags}`);
  let clientId: string | undefined;
  if (typeof flags.client === "string") {
    const client = await new ClientRegistry(process.cwd()).get(flags.client);
    if (!client) return err(`client account-plan: client "${flags.client}" not found`);
    clientId = client.id;
  }
  const result = await new ClientAccountPlanService(process.cwd()).generate({
    ...(clientId ? { clientId } : {}),
    ...(typeof flags.run === "string" ? { runId: flags.run } : {}),
  });
  process.stdout.write(`bureau: generated ${result.plans.length} client account plan(s)\n`);
  for (const plan of result.plans) {
    process.stdout.write(
      `${plan.id}  ${String(plan.client_name ?? plan.client_id).padEnd(24)}  score=${String(
        plan.value_score ?? "unknown",
      ).padEnd(7)}  risk=${String(plan.risk ?? "unknown")}\n`,
    );
  }
  return 0;
};

const handleClientSuccessStatus: Handler = async (args) => {
  const flags = parseFlags(args, {
    client: { type: "string", alias: "c" },
    run: { type: "string" },
  });
  if (typeof flags === "string") return err(`client success-status: ${flags}`);
  let clientId: string | undefined;
  if (typeof flags.client === "string") {
    const client = await new ClientRegistry(process.cwd()).get(flags.client);
    if (!client) return err(`client success-status: client "${flags.client}" not found`);
    clientId = client.id;
  }
  const result = await new ClientSuccessStatusService(process.cwd()).generate({
    ...(clientId ? { clientId } : {}),
    ...(typeof flags.run === "string" ? { runId: flags.run } : {}),
  });
  process.stdout.write(`bureau: generated ${result.reports.length} client success report(s)\n`);
  for (const report of result.reports) {
    process.stdout.write(
      `${report.id}  ${String(report.client_name ?? report.client_id).padEnd(24)}  risk=${String(
        report.risk ?? "unknown",
      ).padEnd(14)}  follow_up_due=${String(report.follow_up_due ?? "unknown")}\n`,
    );
  }
  return 0;
};

const handleProjectCreate: Handler = async (args) => {
  const flags = parseFlags(args, {
    name: { type: "string", alias: "n" },
    client: { type: "string", alias: "c" },
    status: { type: "string" },
    repo: { type: "string" },
    stack: { type: "string" },
    "manager-agent": { type: "string" },
    "team-agents": { type: "string" },
  });
  if (typeof flags === "string") return err(`project create: ${flags}`);
  if (typeof flags.name !== "string") return err("project create: --name is required");
  if (typeof flags.client !== "string") return err("project create: --client <slug> is required");
  const clientRegistry = new ClientRegistry(process.cwd());
  const client = await clientRegistry.get(flags.client);
  if (!client) return err(`project create: client "${flags.client}" not found`);
  const registry = new ProjectRegistry(process.cwd());
  const input: CreateProjectInput = {
    name: flags.name,
    clientId: client.id,
    ...(typeof flags.status === "string"
      ? {
          status: flags.status as
            | "intake"
            | "proposal"
            | "approved"
            | "in_progress"
            | "blocked"
            | "delivered"
            | "cancelled",
        }
      : {}),
    ...(typeof flags.repo === "string" ? { repository: flags.repo } : {}),
    ...(typeof flags.stack === "string" ? { stack: flags.stack } : {}),
    ...(typeof flags["manager-agent"] === "string"
      ? { managerAgentId: flags["manager-agent"] }
      : {}),
    ...(typeof flags["team-agents"] === "string"
      ? {
          assignedAgents: flags["team-agents"]
            .split(",")
            .map((agent) => agent.trim())
            .filter(Boolean),
        }
      : {}),
  };
  const record = await registry.create(input);
  const ownership = await registry.getOwnership(record.slug);
  await new AuditLog(workspacePaths(process.cwd()).auditLog).append({
    actor: "cli",
    action: "project.create",
    target: record.id,
    result: "ok",
  });
  process.stdout.write(
    `bureau: created project ${record.id} (${record.slug}) for client ${client.id}\n`,
  );
  process.stdout.write(`pm:         ${ownership?.manager_agent_id ?? "project_manager"}\n`);
  return 0;
};

const handleProjectList: Handler = async () => {
  const registry = new ProjectRegistry(process.cwd());
  const all = await registry.list();
  const ownership = new Map(
    (await registry.listOwnership()).map((item) => [item.project_id, item.manager_agent_id]),
  );
  if (all.length === 0) {
    process.stdout.write("(no projects)\n");
    return 0;
  }
  for (const p of all) {
    const pm = ownership.get(p.id) ?? "project_manager";
    process.stdout.write(
      `${p.id}  ${p.slug.padEnd(24)}  ${p.status.padEnd(12)}  ${pm.padEnd(18)}  ${p.name}\n`,
    );
  }
  return 0;
};

const handleProjectDispatch: Handler = async (args) => {
  const flags = parseFlags(args, {
    project: { type: "string", alias: "p" },
    type: { type: "string", alias: "t" },
    scope: { type: "string", alias: "s" },
    briefing: { type: "string", alias: "b" },
  });
  if (typeof flags === "string") return err(`project dispatch: ${flags}`);
  if (typeof flags.project !== "string") {
    return err("project dispatch: --project <slug> is required");
  }
  const runType = typeof flags.type === "string" ? flags.type : "planning";
  if (!RUN_TYPES.has(runType as RunType)) {
    return err(`project dispatch: unknown run type "${runType}"`);
  }
  const config = await loadWorkspaceConfig(process.cwd());
  const result = await new ProjectDispatchService(process.cwd(), { config }).dispatch({
    projectSlug: flags.project,
    runType: runType as RunType,
    ...(typeof flags.scope === "string" ? { scope: flags.scope } : {}),
    ...(typeof flags.briefing === "string" ? { briefing: flags.briefing } : {}),
    source: "cli",
  });

  process.stdout.write(`bureau: ${result.summary}\n`);
  process.stdout.write(`pm:       ${result.ownership.manager_agent_id}\n`);
  process.stdout.write(`run:      ${result.run.id}\n`);
  process.stdout.write(`packet:   ${result.packet.id}\n`);
  process.stdout.write(`pipeline: ${result.pipeline.join(", ")}\n`);
  process.stdout.write(
    `handoffs: ${result.handoffs.map((handoff) => handoff.artifact.id).join(", ")}\n`,
  );
  return 0;
};

const handleProjectHealth: Handler = async (args) => {
  const flags = parseFlags(args, {
    project: { type: "string", alias: "p" },
    run: { type: "string" },
  });
  if (typeof flags === "string") return err(`project health: ${flags}`);
  let projectId: string | undefined;
  if (typeof flags.project === "string") {
    const project = await new ProjectRegistry(process.cwd()).get(flags.project);
    if (!project) return err(`project health: project "${flags.project}" not found`);
    projectId = project.id;
  }
  const config = await loadWorkspaceConfig(process.cwd());
  const approvals = new ApprovalRegistry(process.cwd());
  const audit = new AuditLog(workspacePaths(process.cwd()).auditLog);
  const artifacts = new ArtifactStore(process.cwd());
  const policy = new PolicyEngine(config, approvals);
  const runs = new RunEngine(process.cwd(), { audit, artifacts, policy });
  const result = await new ProjectHealthReviewService(process.cwd(), {
    audit,
    artifacts,
    runs,
  }).generate({
    ...(projectId ? { projectId } : {}),
    ...(typeof flags.run === "string" ? { runId: flags.run } : {}),
  });
  process.stdout.write(
    `bureau: generated project health review ${result.report.id} for ${result.projects.length} project(s)\n`,
  );
  for (const item of result.projects) {
    process.stdout.write(
      `${item.project.slug.padEnd(28)}  ${item.risk.padEnd(12)}  score=${String(item.score).padEnd(
        4,
      )}  next=${item.next_action}\n`,
    );
  }
  return 0;
};

const handleProjectVerifyRepositories: Handler = async (args) => {
  const flags = parseFlags(args, {
    project: { type: "string", alias: "p" },
    token: { type: "string" },
    run: { type: "string" },
    "stale-days": { type: "number" },
  });
  if (typeof flags === "string") return err(`project verify-repositories: ${flags}`);
  if (typeof flags["stale-days"] === "number" && !Number.isFinite(flags["stale-days"])) {
    return err("project verify-repositories: --stale-days must be a number");
  }

  await loadWorkspaceConfig(process.cwd());
  let projectId: string | undefined;
  if (typeof flags.project === "string") {
    const project = await new ProjectRegistry(process.cwd()).get(flags.project);
    if (!project) return err(`project verify-repositories: project "${flags.project}" not found`);
    projectId = project.id;
  }

  const token = typeof flags.token === "string" ? flags.token : process.env["GITHUB_TOKEN"];
  const audit = new AuditLog(workspacePaths(process.cwd()).auditLog);
  const artifacts = new ArtifactStore(process.cwd());
  const result = await new ProjectRepositoryVerificationService(process.cwd(), {
    audit,
    artifacts,
    ...(token ? { githubClient: new OctokitGitHubClient({ token }) } : {}),
  }).verify({
    ...(projectId ? { projectId } : {}),
    ...(typeof flags.run === "string" ? { runId: flags.run } : {}),
    ...(typeof flags["stale-days"] === "number" ? { staleDays: flags["stale-days"] } : {}),
  });

  process.stdout.write(
    `bureau: generated repository verification ${result.report.id} for ${result.projects.length} project(s)\n`,
  );
  if (!token) {
    process.stdout.write(
      "github: no token configured; live GitHub state was not checked for linked repositories\n",
    );
  }
  for (const item of result.projects) {
    process.stdout.write(
      `${item.project.slug.padEnd(28)}  ${item.status.padEnd(11)}  repo=${(
        item.parsed_repository ||
        item.repository ||
        "(none)"
      ).padEnd(26)}  failing=${item.failing_checks_count}  stale=${
        item.stale_issues_count + item.stale_pull_requests_count
      }\n`,
    );
  }
  return 0;
};

const handleOpportunityCreate: Handler = async (args) => {
  const flags = parseFlags(args, {
    title: { type: "string", alias: "t" },
    source: { type: "string", alias: "s" },
    client: { type: "string", alias: "c" },
    value: { type: "number", alias: "v" },
    margin: { type: "number", alias: "m" },
  });
  if (typeof flags === "string") return err(`opportunity create: ${flags}`);
  if (typeof flags.title !== "string") return err("opportunity create: --title is required");
  if (typeof flags.source !== "string") return err("opportunity create: --source is required");
  if (typeof flags.client !== "string")
    return err("opportunity create: --client <slug> is required");
  const clientRegistry = new ClientRegistry(process.cwd());
  const client = await clientRegistry.get(flags.client);
  if (!client) return err(`opportunity create: client "${flags.client}" not found`);
  const registry = new OpportunityRegistry(process.cwd());
  const record = await registry.create({
    title: flags.title,
    source: flags.source,
    clientId: client.id,
    ...(typeof flags.value === "number" ? { expectedValue: flags.value } : {}),
    ...(typeof flags.margin === "number" ? { expectedMargin: flags.margin } : {}),
  });
  await new AuditLog(workspacePaths(process.cwd()).auditLog).append({
    actor: "cli",
    action: "opportunity.create",
    target: record.id,
    result: "ok",
  });
  process.stdout.write(`bureau: created opportunity ${record.id}\n`);
  return 0;
};

const handleOpportunityList: Handler = async () => {
  const registry = new OpportunityRegistry(process.cwd());
  const all = await registry.list();
  if (all.length === 0) {
    process.stdout.write("(no opportunities)\n");
    return 0;
  }
  for (const o of all) {
    process.stdout.write(`${o.id}  ${o.status.padEnd(14)}  ${o.title}\n`);
  }
  return 0;
};

const handleRevenuePipeline: Handler = async (args) => {
  const flags = parseFlags(args, {
    opportunity: { type: "string", alias: "o" },
    "max-opportunities": { type: "number" },
    run: { type: "string" },
  });
  if (typeof flags === "string") return err(`revenue pipeline: ${flags}`);
  if (
    typeof flags["max-opportunities"] === "number" &&
    !Number.isFinite(flags["max-opportunities"])
  ) {
    return err("revenue pipeline: --max-opportunities must be a number");
  }
  await loadWorkspaceConfig(process.cwd());
  const result = await new RevenuePipelineService(process.cwd()).generate({
    ...(typeof flags.opportunity === "string" ? { opportunityId: flags.opportunity } : {}),
    ...(typeof flags["max-opportunities"] === "number"
      ? { maxOpportunities: flags["max-opportunities"] }
      : {}),
    ...(typeof flags.run === "string" ? { runId: flags.run } : {}),
  });
  process.stdout.write(`bureau: generated revenue pipeline report ${result.report.id}\n`);
  process.stdout.write(
    `pipeline: ${result.pipeline_value} | open: ${result.open_opportunities} | qualified: ${result.qualified_count} | proposal-ready: ${result.proposal_ready_count}\n`,
  );
  for (const item of result.items) {
    process.stdout.write(
      `${item.opportunity.id}  ${item.fit.padEnd(6)}  score=${String(item.score).padEnd(
        3,
      )}  stage=${item.stage.padEnd(20)}  artifacts=${item.artifacts
        .map((artifact) => artifact.id)
        .join(",")}\n`,
    );
    process.stdout.write(`  next: ${item.next_action}\n`);
  }
  for (const action of result.next_actions) {
    process.stdout.write(`next: ${action}\n`);
  }
  return 0;
};

const handleRunNew: Handler = async (args) => {
  const flags = parseFlags(args, {
    type: { type: "string", alias: "t" },
    scope: { type: "string", alias: "s" },
    client: { type: "string", alias: "c" },
    project: { type: "string", alias: "p" },
    source: { type: "string" },
    "linear-issue": { type: "string" },
    "linear-url": { type: "string" },
    stub: { type: "boolean" },
  });
  if (typeof flags === "string") return err(`run new: ${flags}`);
  if (typeof flags.type !== "string") return err("run new: --type is required");
  if (typeof flags.scope !== "string") return err("run new: --scope is required");
  const sourceWorkItem =
    typeof flags["linear-issue"] === "string"
      ? linearIssueSourceWorkItem(flags["linear-issue"], String(flags["linear-url"] ?? ""))
      : typeof flags.source === "string"
        ? sourceWorkItemFromTriggerSource(flags.source)
        : undefined;
  const triggerSource =
    sourceWorkItem?.type === "linear_issue"
      ? `linear://issue/${sourceWorkItem.identifier}`
      : typeof flags.source === "string"
        ? flags.source
        : "cli";
  const config = await loadWorkspaceConfig(process.cwd());
  const approvals = new ApprovalRegistry(process.cwd());
  const audit = new AuditLog(workspacePaths(process.cwd()).auditLog);
  const policy = new PolicyEngine(config, approvals);
  const artifacts = new ArtifactStore(process.cwd());
  const dispatcher =
    flags.stub === true
      ? undefined
      : createCoordinatorRunDispatcher({ audit, artifacts, policy, config });
  const engine = new RunEngine(process.cwd(), {
    audit,
    artifacts,
    policy,
    ...(dispatcher ? { dispatcher } : {}),
  });
  let clientId: string | undefined;
  let projectId: string | undefined;
  if (typeof flags.client === "string") {
    const c = await new ClientRegistry(process.cwd()).get(flags.client);
    if (!c) return err(`run new: client "${flags.client}" not found`);
    clientId = c.id;
  }
  if (typeof flags.project === "string") {
    const p = await new ProjectRegistry(process.cwd()).get(flags.project);
    if (!p) return err(`run new: project "${flags.project}" not found`);
    projectId = p.id;
  }
  const record = await engine.start({
    type: flags.type as never,
    triggerType: "owner_request",
    triggerSource,
    scope: flags.scope,
    ...(clientId !== undefined ? { clientId } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(sourceWorkItem ? { sourceWorkItem } : {}),
  });
  process.stdout.write(`bureau: run ${record.id} (${record.status})\n`);
  if (sourceWorkItemLabel(record) !== "(none)") {
    process.stdout.write(`bureau: source: ${sourceWorkItemLabel(record)}\n`);
  }
  if (record.artifacts.length) {
    process.stdout.write(`bureau: artifacts: ${record.artifacts.join(", ")}\n`);
  }
  return 0;
};

const handleRunList: Handler = async () => {
  const config = await loadWorkspaceConfig(process.cwd());
  const approvals = new ApprovalRegistry(process.cwd());
  const policy = new PolicyEngine(config, approvals);
  const engine = new RunEngine(process.cwd(), {
    audit: new AuditLog(workspacePaths(process.cwd()).auditLog),
    artifacts: new ArtifactStore(process.cwd()),
    policy,
  });
  const all = await engine.list();
  if (all.length === 0) {
    process.stdout.write("(no runs)\n");
    return 0;
  }
  for (const r of all) {
    process.stdout.write(
      `${r.id}  ${r.type.padEnd(12)}  ${r.status.padEnd(14)}  ${sourceWorkItemLabel(r).padEnd(32)}  ${r.scope}\n`,
    );
  }
  return 0;
};

const handleReportGenerate: Handler = async () => {
  const config = await loadWorkspaceConfig(process.cwd());
  const result = await new BusinessReportService(process.cwd(), { config }).generate();
  process.stdout.write(`bureau: generated executive report ${result.executive_report.id}\n`);
  process.stdout.write(
    `bureau: generated cross-project report ${result.cross_project_report.id}\n`,
  );
  process.stdout.write(
    `bureau: generated business operating report ${result.business_operating_report.id}\n`,
  );
  process.stdout.write(`pipeline: ${result.metrics.pipeline_value}\n`);
  process.stdout.write(`portfolio: ${result.portfolio.length} project(s)\n`);
  if (result.next_actions.length) {
    process.stdout.write(`next: ${result.next_actions.join(" | ")}\n`);
  }
  return 0;
};

const handleGrowthMemory: Handler = async (args) => {
  const subcommand = args[0] ?? "show";
  const service = new GrowthMemoryService(process.cwd());
  if (subcommand === "show") {
    const memory = await service.get();
    process.stdout.write(`growth memory: ${memory.ready ? "ready" : "incomplete"}\n`);
    for (const section of memory.sections) {
      process.stdout.write(
        `${section.id.padEnd(9)}  ${section.status.padEnd(10)}  ${section.path}  ${section.preview || "(empty)"}\n`,
      );
    }
    return 0;
  }

  if (subcommand === "set") {
    const flags = parseFlags(args.slice(1), {
      brand: { type: "string" },
      offers: { type: "string" },
      channels: { type: "string" },
    });
    if (typeof flags === "string") return err(`growth memory set: ${flags}`);
    if (
      typeof flags.brand !== "string" &&
      typeof flags.offers !== "string" &&
      typeof flags.channels !== "string"
    ) {
      return err("growth memory set: provide --brand, --offers, or --channels");
    }
    const memory = await service.update({
      ...(typeof flags.brand === "string" ? { brand: flags.brand } : {}),
      ...(typeof flags.offers === "string" ? { offers: flags.offers } : {}),
      ...(typeof flags.channels === "string" ? { channels: flags.channels } : {}),
      actor: "cli",
    });
    process.stdout.write(`growth memory: ${memory.ready ? "ready" : "incomplete"}\n`);
    if (memory.missing_sections.length > 0) {
      process.stdout.write(`missing: ${memory.missing_sections.join(", ")}\n`);
    }
    return 0;
  }

  return err(`growth memory: unknown subcommand "${subcommand}"`);
};

const handleGrowthReview: Handler = async (args) => {
  const flags = parseFlags(args, {
    "recent-days": { type: "number" },
    run: { type: "string" },
  });
  if (typeof flags === "string") return err(`growth review: ${flags}`);
  await loadWorkspaceConfig(process.cwd());
  const result = await new GrowthReviewService(process.cwd()).generate({
    ...(typeof flags["recent-days"] === "number" ? { recentDays: flags["recent-days"] } : {}),
    ...(typeof flags.run === "string" ? { runId: flags.run } : {}),
  });
  process.stdout.write(`bureau: generated growth review ${result.report.id}\n`);
  process.stdout.write(
    `pipeline: ${result.pipeline_value} | recent content: ${result.recent_content_count} | follow-ups due: ${result.follow_ups_due}\n`,
  );
  for (const recommendation of result.recommendations) {
    process.stdout.write(`next: ${recommendation}\n`);
  }
  return 0;
};

const handleGrowthContent: Handler = async (args) => {
  const flags = parseFlags(args, {
    "max-drafts": { type: "number" },
    focus: { type: "string" },
    run: { type: "string" },
  });
  if (typeof flags === "string") return err(`growth content: ${flags}`);
  if (typeof flags["max-drafts"] === "number" && !Number.isFinite(flags["max-drafts"])) {
    return err("growth content: --max-drafts must be a number");
  }
  await loadWorkspaceConfig(process.cwd());
  const result = await new GrowthContentPipelineService(process.cwd()).generate({
    ...(typeof flags["max-drafts"] === "number" ? { maxDrafts: flags["max-drafts"] } : {}),
    ...(typeof flags.focus === "string" ? { focus: flags.focus } : {}),
    ...(typeof flags.run === "string" ? { runId: flags.run } : {}),
  });
  process.stdout.write(`bureau: generated content pipeline report ${result.report.id}\n`);
  process.stdout.write(
    `memory: ${result.memory_ready ? "ready" : "incomplete"} | drafts: ${result.drafts.length} | pipeline: ${result.pipeline_value}\n`,
  );
  if (result.missing_sections.length > 0) {
    process.stdout.write(`missing: ${result.missing_sections.join(", ")}\n`);
  }
  for (const draft of result.drafts) {
    process.stdout.write(
      `draft: ${draft.kind.padEnd(8)} ${draft.artifact.id} ${draft.channel} ${draft.title}\n`,
    );
  }
  for (const action of result.next_actions) {
    process.stdout.write(`next: ${action}\n`);
  }
  return 0;
};

const handleGitHubDraftIssues: Handler = async (args) => {
  const flags = parseFlags(args, {
    project: { type: "string", alias: "p" },
  });
  if (typeof flags === "string") return err(`github draft-issues: ${flags}`);
  if (typeof flags.project !== "string") {
    return err("github draft-issues: --project <slug> is required");
  }
  await loadWorkspaceConfig(process.cwd());
  const result = await new GitHubIssueDraftService(process.cwd()).draftForProject(flags.project);

  process.stdout.write(
    `bureau: generated ${result.drafts.length} GitHub issue drafts for ${result.project.slug}\n`,
  );
  for (const [index, draft] of result.drafts.entries()) {
    const artifact = result.artifacts[index];
    process.stdout.write(`  - ${draft.title}\n`);
    process.stdout.write(`    labels: ${draft.labels.join(", ")}\n`);
    if (artifact) process.stdout.write(`    artifact: ${artifact.id}\n`);
  }
  return 0;
};

const handleGitHubCreateIssues: Handler = async (args) => {
  const flags = parseFlags(args, {
    project: { type: "string", alias: "p" },
    owner: { type: "string" },
    repo: { type: "string" },
    token: { type: "string" },
    "no-labels": { type: "boolean" },
  });
  if (typeof flags === "string") return err(`github create-issues: ${flags}`);
  if (typeof flags.project !== "string") {
    return err("github create-issues: --project <slug> is required");
  }
  if (typeof flags.owner !== "string") return err("github create-issues: --owner required");
  if (typeof flags.repo !== "string") return err("github create-issues: --repo required");

  const token = typeof flags.token === "string" ? flags.token : process.env["GITHUB_TOKEN"];
  if (!token) return err("github create-issues: provide --token or set GITHUB_TOKEN");

  const config = await loadWorkspaceConfig(process.cwd());
  const result = await new GitHubIssuePublishService(process.cwd(), {
    config,
    githubClient: new OctokitGitHubClient({ token }),
  }).publishProjectDrafts({
    projectSlug: flags.project,
    owner: flags.owner,
    repo: flags.repo,
    ensureLabels: flags["no-labels"] !== true,
  });

  if (result.status === "blocked") {
    process.stdout.write(
      `bureau: issue creation blocked by policy; approval ${result.approval?.id ?? "required"} requested\n`,
    );
    process.stdout.write(`policy: ${result.policy.reason}\n`);
    return 0;
  }

  process.stdout.write(
    `bureau: created ${result.created.length} GitHub issues on ${result.repository.owner}/${result.repository.repo}\n`,
  );
  for (const issue of result.created) {
    process.stdout.write(`  - #${issue.number} ${issue.title}: ${issue.url}\n`);
  }
  if (result.report) process.stdout.write(`report: ${result.report.id}\n`);
  return 0;
};

const handleGitHubProvisionRepo: Handler = async (args) => {
  const flags = parseFlags(args, {
    project: { type: "string", alias: "p" },
    owner: { type: "string" },
    repo: { type: "string" },
    token: { type: "string" },
    org: { type: "boolean" },
    public: { type: "boolean" },
    private: { type: "boolean" },
    description: { type: "string" },
    "auto-init": { type: "boolean" },
  });
  if (typeof flags === "string") return err(`github provision-repo: ${flags}`);
  if (typeof flags.project !== "string")
    return err("github provision-repo: --project <slug> is required");
  if (typeof flags.owner !== "string") return err("github provision-repo: --owner required");
  if (flags.public === true && flags.private === true)
    return err("github provision-repo: choose either --public or --private");

  const token = typeof flags.token === "string" ? flags.token : process.env["GITHUB_TOKEN"];
  if (!token) return err("github provision-repo: provide --token or set GITHUB_TOKEN");

  const config = await loadWorkspaceConfig(process.cwd());
  const result = await new GitHubRepositoryProvisionService(process.cwd(), {
    config,
    githubClient: new OctokitGitHubClient({ token }),
  }).provision({
    projectSlug: flags.project,
    owner: flags.owner,
    ...(typeof flags.repo === "string" ? { repo: flags.repo } : {}),
    ownerType: flags.org === true ? "org" : "user",
    private: flags.public === true ? false : true,
    ...(typeof flags.description === "string" ? { description: flags.description } : {}),
    ...(typeof flags["auto-init"] === "boolean" ? { autoInit: flags["auto-init"] } : {}),
  });

  if (result.status === "blocked") {
    process.stdout.write(
      `bureau: repository provisioning blocked by policy; approval ${result.approval?.id ?? "required"} requested\n`,
    );
    process.stdout.write(`policy: ${result.policy.reason}\n`);
    return 0;
  }

  process.stdout.write(`bureau: provisioned repository ${result.repository.url}\n`);
  if (result.report) process.stdout.write(`report: ${result.report.id}\n`);
  return 0;
};

const handleGitHubCreatePr: Handler = async (args) => {
  const flags = parseFlags(args, {
    project: { type: "string", alias: "p" },
    owner: { type: "string" },
    repo: { type: "string" },
    token: { type: "string" },
    title: { type: "string", alias: "t" },
    body: { type: "string", alias: "b" },
    head: { type: "string" },
    base: { type: "string" },
    draft: { type: "boolean" },
    issue: { type: "number" },
    test: { type: "string" },
  });
  if (typeof flags === "string") return err(`github create-pr: ${flags}`);
  if (typeof flags.project !== "string")
    return err("github create-pr: --project <slug> is required");
  if (typeof flags.owner !== "string") return err("github create-pr: --owner required");
  if (typeof flags.repo !== "string") return err("github create-pr: --repo required");
  if (typeof flags.title !== "string") return err("github create-pr: --title required");
  if (typeof flags.head !== "string") return err("github create-pr: --head required");

  const token = typeof flags.token === "string" ? flags.token : process.env["GITHUB_TOKEN"];
  if (!token) return err("github create-pr: provide --token or set GITHUB_TOKEN");

  const config = await loadWorkspaceConfig(process.cwd());
  const result = await new GitHubPullRequestPublishService(process.cwd(), {
    config,
    githubClient: new OctokitGitHubClient({ token }),
  }).publish({
    projectSlug: flags.project,
    owner: flags.owner,
    repo: flags.repo,
    title: flags.title,
    head: flags.head,
    ...(typeof flags.body === "string" ? { body: flags.body } : {}),
    ...(typeof flags.base === "string" ? { base: flags.base } : {}),
    ...(flags.draft === true ? { draft: true } : {}),
    ...(typeof flags.issue === "number" ? { linkedIssueNumbers: [flags.issue] } : {}),
    ...(typeof flags.test === "string" ? { testEvidence: [flags.test] } : {}),
  });

  if (result.status === "blocked") {
    process.stdout.write(
      `bureau: PR creation blocked by policy; approval ${result.approval?.id ?? "required"} requested\n`,
    );
    process.stdout.write(`policy: ${result.policy.reason}\n`);
    return 0;
  }

  process.stdout.write(
    `bureau: created PR #${result.pull_request?.number} ${result.pull_request?.title}: ${result.pull_request?.url}\n`,
  );
  if (result.report) process.stdout.write(`report: ${result.report.id}\n`);
  return 0;
};

const handleAuditTail: Handler = async (args) => {
  const flags = parseFlags(args, { limit: { type: "number", alias: "n" } });
  if (typeof flags === "string") return err(`audit tail: ${flags}`);
  const limit = typeof flags.limit === "number" ? flags.limit : 20;
  const path = workspacePaths(process.cwd()).auditLog;
  try {
    const content = await readFile(path, "utf8");
    const lines = content.trim().split("\n").filter(Boolean).slice(-limit);
    for (const l of lines) {
      try {
        const e = JSON.parse(l) as {
          timestamp: string;
          actor: string;
          action: string;
          target?: string;
          result: string;
        };
        process.stdout.write(
          `${e.timestamp}  ${e.actor.padEnd(18)}  ${e.action.padEnd(28)}  ${e.target ?? ""}  [${e.result}]\n`,
        );
      } catch {
        process.stdout.write(`${l}\n`);
      }
    }
    return 0;
  } catch {
    return err("audit tail: no audit log yet (run `bureau init` first)");
  }
};

const handleAutonomyRetryScan: Handler = async (args) => {
  const flags = parseFlags(args, {
    "max-attempts": { type: "number" },
  });
  if (typeof flags === "string") return err(`autonomy retry-scan: ${flags}`);
  if (typeof flags["max-attempts"] === "number" && !Number.isFinite(flags["max-attempts"])) {
    return err("autonomy retry-scan: --max-attempts must be a number");
  }

  const config = await loadWorkspaceConfig(process.cwd());
  const approvals = new ApprovalRegistry(process.cwd());
  const audit = new AuditLog(workspacePaths(process.cwd()).auditLog);
  const artifacts = new ArtifactStore(process.cwd());
  const policy = new PolicyEngine(config, approvals);
  const runs = new RunEngine(process.cwd(), { audit, artifacts, policy });
  const result = await new AutonomousRetryService(process.cwd(), {
    runs,
    audit,
    artifacts,
    policy,
    coordinator: { audit, artifacts, policy },
  }).scan({
    maxAttempts:
      typeof flags["max-attempts"] === "number"
        ? flags["max-attempts"]
        : config.limits.max_retries_per_task,
  });

  process.stdout.write(
    `bureau: retry scan started ${result.triggered.length} retry run(s), escalated ${result.escalated.length}, skipped ${result.skipped.length}\n`,
  );
  if (result.report) process.stdout.write(`report: ${result.report.id}\n`);
  for (const item of result.triggered) {
    process.stdout.write(
      `retry: ${item.originalRun.id} -> ${item.retryRun.id} attempt=${item.attempt}\n`,
    );
  }
  for (const item of result.escalated) {
    process.stdout.write(`escalated: ${item.run.id} attempts=${item.attempts}\n`);
  }
  return 0;
};

const handleAutonomyMemoryScan: Handler = async () => {
  const config = await loadWorkspaceConfig(process.cwd());
  const approvals = new ApprovalRegistry(process.cwd());
  const audit = new AuditLog(workspacePaths(process.cwd()).auditLog);
  const artifacts = new ArtifactStore(process.cwd());
  const policy = new PolicyEngine(config, approvals);
  const runs = new RunEngine(process.cwd(), { audit, artifacts, policy });
  const result = await new MemoryTriggerService(process.cwd(), {
    runs,
    audit,
    artifacts,
    policy,
    coordinator: { audit, artifacts, policy },
  }).scan();

  process.stdout.write(
    `bureau: memory scan started ${result.triggered.length} run(s), skipped ${result.skipped.length}\n`,
  );
  for (const item of result.triggered) {
    process.stdout.write(
      `memory: ${item.kind} -> ${item.run.id} artifacts=${item.artifactIds.length}\n`,
    );
  }
  for (const item of result.skipped) {
    process.stdout.write(`skipped: ${item.kind} ${item.reason}\n`);
  }
  return 0;
};

const handlePolicyExplain: Handler = async (args) => {
  const action = args[0];
  if (!action) return err("policy explain: missing <action>");
  const rest = args.slice(1);
  const flags = parseFlags(rest, {
    actor: { type: "string" },
    target: { type: "string" },
  });
  if (typeof flags === "string") return err(`policy explain: ${flags}`);
  const config = await loadWorkspaceConfig(process.cwd());
  const approvals = new ApprovalRegistry(process.cwd());
  const policy = new PolicyEngine(config, approvals);
  const decision = await policy.evaluate({
    action,
    actor: typeof flags.actor === "string" ? flags.actor : "owner",
    ...(typeof flags.target === "string" ? { target: flags.target } : {}),
  });
  process.stdout.write(`Action:   ${decision.action}\n`);
  process.stdout.write(`Actor:    ${decision.actor}\n`);
  process.stdout.write(
    `Autonomy: Level ${config.autonomy.level} (${autonomyLevelName(config.autonomy.level)})\n`,
  );
  process.stdout.write(`Outcome:  ${decision.outcome}\n`);
  process.stdout.write(`Allowed:  ${decision.allowed}\n`);
  process.stdout.write(`Reason:   ${decision.reason}\n`);
  if (decision.required_gates.length) {
    process.stdout.write(`Gates:    ${decision.required_gates.join(", ")}\n`);
  }
  return 0;
};

const handleApprovalsList: Handler = async () => {
  const registry = new ApprovalRegistry(process.cwd());
  const pending = await registry.listPending();
  if (pending.length === 0) {
    process.stdout.write("(no pending approvals)\n");
    return 0;
  }
  for (const a of pending) {
    process.stdout.write(`${a.id}  ${a.action.padEnd(24)}  ${a.target}\n`);
  }
  return 0;
};

const handleApprovalsResolve =
  (status: "approved" | "rejected"): Handler =>
  async (args) => {
    const id = args[0];
    if (!id) return err(`approvals ${status}: missing <id>`);
    const rest = args.slice(1);
    const flags = parseFlags(rest, { reason: { type: "string" } });
    if (typeof flags === "string") return err(`approvals ${status}: ${flags}`);
    const registry = new ApprovalRegistry(process.cwd());
    await registry.resolve(
      id,
      status,
      "owner",
      typeof flags.reason === "string" ? flags.reason : "",
    );
    await new AuditLog(workspacePaths(process.cwd()).auditLog).append({
      actor: "owner",
      action: `approval.${status}`,
      target: id,
      result: "ok",
    });
    process.stdout.write(`bureau: ${status} ${id}\n`);
    return 0;
  };

const handleServe: Handler = async (args) => {
  const flags = parseFlags(args, { port: { type: "number", alias: "p" } });
  if (typeof flags === "string") return err(`serve: ${flags}`);
  const config = await loadWorkspaceConfig(process.cwd());
  const githubClient = githubClientFromEnv();
  const server = await startApiServer({
    workspaceRoot: process.cwd(),
    config,
    ...(typeof flags.port === "number" ? { port: flags.port } : {}),
    ...(githubClient ? { githubClient } : {}),
    ...(process.env["GITHUB_WEBHOOK_SECRET"]
      ? { githubWebhookSecret: process.env["GITHUB_WEBHOOK_SECRET"] }
      : {}),
  });
  process.stdout.write(`bureau: API server listening at ${server.url}\n`);
  process.stdout.write(`bureau: workspace ${workspacePaths(process.cwd()).workspaceDir}\n`);
  process.stdout.write(`bureau: press Ctrl-C to stop\n`);
  await new Promise<void>(() => {});
  return 0;
};

const runDaemonForeground: Handler = async (args) => {
  const flags = parseFlags(args, { port: { type: "number", alias: "p" } });
  if (typeof flags === "string") return err(`daemon run: ${flags}`);
  const config = await loadWorkspaceConfig(process.cwd());
  const approvals = new ApprovalRegistry(process.cwd());
  const policy = new PolicyEngine(config, approvals);
  const audit = new AuditLog(workspacePaths(process.cwd()).auditLog);
  const artifacts = new ArtifactStore(process.cwd());
  const runs = new RunEngine(process.cwd(), { audit, artifacts, policy });
  const githubClient = githubClientFromEnv();
  const state = new DaemonStateStore(process.cwd());
  const scheduler = new Scheduler({
    config,
    runs,
    workspaceRoot: process.cwd(),
    coordinator: { audit, artifacts, policy },
    ...(githubClient ? { githubClient } : {}),
  });

  try {
    const lock = await state.acquireLock({
      pid: process.pid,
      message: "foreground daemon run",
    });
    if (!lock.acquired) {
      const message = lock.state
        ? `daemon already running with pid ${lock.state.pid}`
        : "daemon lock could not be acquired";
      await state.markError(message);
      return err(`daemon run: ${message}`);
    }

    scheduler.start();
    const server = await startApiServer({
      workspaceRoot: process.cwd(),
      config,
      ...(typeof flags.port === "number" ? { port: flags.port } : {}),
      ...(githubClient ? { githubClient } : {}),
      ...(process.env["GITHUB_WEBHOOK_SECRET"]
        ? { githubWebhookSecret: process.env["GITHUB_WEBHOOK_SECRET"] }
        : {}),
    });
    await state.markRunning({
      pid: process.pid,
      apiUrl: server.url,
      port: server.port,
    });
    process.stdout.write(`bureau: daemon running. API at ${server.url}\n`);
    process.stdout.write(`bureau: scheduler active. Press Ctrl-C to stop\n`);

    let stopping = false;
    const shutdown = async (signal: string): Promise<void> => {
      if (stopping) return;
      stopping = true;
      scheduler.stop();
      await server.close();
      await state.markStopped(`received ${signal}`);
      await state.releaseLock(process.pid);
      process.exit(0);
    };

    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    await new Promise<void>(() => {});
    return 0;
  } catch (error) {
    scheduler.stop();
    await state.markError((error as Error).message);
    await state.releaseLock(process.pid);
    throw error;
  }
};

const handleDaemonStart: Handler = async (args) => {
  const flags = parseFlags(args, { port: { type: "number", alias: "p" } });
  if (typeof flags === "string") return err(`daemon start: ${flags}`);
  await loadWorkspaceConfig(process.cwd());
  const supervisor = new DaemonLifecycleSupervisor({
    workspaceRoot: process.cwd(),
    scriptPath: process.argv[1],
  });
  const result = await supervisor.start({
    ...(typeof flags.port === "number" ? { port: flags.port } : {}),
  });
  if (!result.ok) return err(`daemon start: ${result.message}`);
  process.stdout.write(`bureau: ${result.message}\n`);
  process.stdout.write(`bureau: run \`bureau daemon status\` to inspect it\n`);
  return 0;
};

const handleDaemonStatus: Handler = async () => {
  await loadWorkspaceConfig(process.cwd());
  const snapshot = await new DaemonStateStore(process.cwd()).status();
  if (!snapshot.state) {
    process.stdout.write("bureau: daemon stopped\n");
    return 0;
  }
  const state = snapshot.state;
  process.stdout.write(
    `bureau: daemon ${snapshot.status}${snapshot.alive ? " (alive)" : " (not alive)"}\n`,
  );
  if (state.pid) process.stdout.write(`pid: ${state.pid}\n`);
  if (state.api_url) process.stdout.write(`api: ${state.api_url}\n`);
  process.stdout.write(`scheduler: ${snapshot.heartbeat.scheduler_status}\n`);
  if (snapshot.heartbeat.uptime_seconds !== undefined) {
    process.stdout.write(`uptime_seconds: ${snapshot.heartbeat.uptime_seconds}\n`);
  }
  if (snapshot.heartbeat.last_run) {
    const run = snapshot.heartbeat.last_run;
    process.stdout.write(
      `last_run: ${run.trigger}${run.run_id ? ` -> ${run.run_id}` : ""} at ${run.at}\n`,
    );
  }
  if (snapshot.heartbeat.last_error) {
    const error = snapshot.heartbeat.last_error;
    process.stdout.write(
      `last_error: ${error.trigger} failed ${error.failure_count} time(s): ${error.error}\n`,
    );
  }
  if (state.started_at) process.stdout.write(`started: ${state.started_at}\n`);
  if (state.updated_at) process.stdout.write(`updated: ${state.updated_at}\n`);
  if (state.message) process.stdout.write(`message: ${state.message}\n`);
  process.stdout.write(`state: ${snapshot.path}\n`);
  return 0;
};

const handleDaemonStop: Handler = async () => {
  await loadWorkspaceConfig(process.cwd());
  const result = await new DaemonLifecycleSupervisor({ workspaceRoot: process.cwd() }).stop();
  process.stdout.write(`bureau: ${result.message}\n`);
  return 0;
};

const handleDaemon: Handler = async (args) => {
  const sub = args[0];
  if (!sub || sub.startsWith("--")) return runDaemonForeground(args);
  switch (sub) {
    case "run":
    case "foreground":
      return runDaemonForeground(args.slice(1));
    case "start":
      return handleDaemonStart(args.slice(1));
    case "status":
      return handleDaemonStatus(args.slice(1));
    case "stop":
      return handleDaemonStop(args.slice(1));
    default:
      return err("daemon: expected one of start, stop, status, run");
  }
};

const handleAuthLogin: Handler = async (args) => {
  const flags = parseFlags(args, {
    provider: { type: "string", alias: "p" },
    id: { type: "string" },
    mode: { type: "string" },
    "api-key": { type: "string" },
    "access-token": { type: "string" },
    "refresh-token": { type: "string" },
    "expires-at": { type: "string" },
    "base-url": { type: "string" },
    model: { type: "string" },
  });
  if (typeof flags === "string") return err(`auth login: ${flags}`);
  const provider = parseProvider(flags.provider);
  if (!provider)
    return err(
      "auth login: --provider openai-codex|openai|anthropic|google|openrouter|local|custom is required",
    );
  try {
    const record = await providerAuthStore().upsert({
      provider,
      ...(typeof flags.id === "string" ? { id: flags.id } : {}),
      ...(typeof flags.mode === "string"
        ? { mode: flags.mode as "oauth" | "api-key" | "local" }
        : {}),
      ...(typeof flags["api-key"] === "string" ? { apiKey: flags["api-key"] } : {}),
      ...(typeof flags["access-token"] === "string" ? { accessToken: flags["access-token"] } : {}),
      ...(typeof flags["refresh-token"] === "string"
        ? { refreshToken: flags["refresh-token"] }
        : {}),
      ...(typeof flags["expires-at"] === "string" ? { expiresAt: flags["expires-at"] } : {}),
      ...(typeof flags["base-url"] === "string" ? { baseUrl: flags["base-url"] } : {}),
      ...(typeof flags.model === "string" ? { defaultModel: flags.model } : {}),
    });
    await auditProviderAuth("provider.auth.login", `${provider}:${record.id}`);
    process.stdout.write(`bureau: connected ${provider} as ${record.id}\n`);
    return 0;
  } catch (e) {
    return err(`auth login: ${(e as Error).message}`);
  }
};

const handleAuthList: Handler = async () => {
  const records = await providerAuthStore().list();
  if (records.length === 0) {
    process.stdout.write("(no provider credentials stored)\n");
    return 0;
  }
  for (const record of records) {
    const secret = record.apiKey ? maskSecret(record.apiKey) : "(no api key)";
    const oauth = record.accessToken
      ? maskSecret(record.accessToken)
      : record.refreshToken
        ? maskSecret(record.refreshToken)
        : "(no oauth token)";
    const base = record.baseUrl || "(default endpoint)";
    const model = record.defaultModel || "(model from config)";
    process.stdout.write(
      `${record.provider.padEnd(14)}  ${record.id.padEnd(24)}  ${record.mode.padEnd(7)}  ${secret.padEnd(14)}  ${oauth.padEnd(18)}  ${base}  ${model}\n`,
    );
  }
  return 0;
};

const handleAuthLogout: Handler = async (args) => {
  const flags = parseFlags(args, {
    provider: { type: "string", alias: "p" },
    id: { type: "string" },
  });
  if (typeof flags === "string") return err(`auth logout: ${flags}`);
  const provider = parseProvider(flags.provider);
  if (!provider)
    return err(
      "auth logout: --provider openai-codex|openai|anthropic|google|openrouter|local|custom is required",
    );
  const id = typeof flags.id === "string" ? flags.id : defaultProviderId(provider);
  const removed = await providerAuthStore().remove(provider, id);
  if (!removed) return err(`auth logout: no credential found for ${provider}:${id}`);
  await auditProviderAuth("provider.auth.logout", `${provider}:${id}`);
  process.stdout.write(`bureau: disconnected ${provider}:${id}\n`);
  return 0;
};

const handleProvidersList: Handler = async () => {
  const config = await loadWorkspaceConfig(process.cwd()).catch(() => defaultConfig("freelancer"));
  const { router, connections } = await buildConfiguredProviderRouter(
    process.cwd(),
    process.env,
    config,
  );
  const validations = await router.validate();
  process.stdout.write(
    `Configured for: ${config.supreme_coordinator.provider} (${config.supreme_coordinator.model})\n\n`,
  );
  for (const adapter of router.list()) {
    const v = validations.get(adapter.id);
    const status = v?.ok ? "OK" : `MISSING (${v?.reason ?? ""})`;
    const connection = connections.find((record) => record.id === adapter.id);
    const source = connection?.source ?? "env";
    process.stdout.write(
      `${adapter.type.padEnd(12)}  ${adapter.id.padEnd(22)}  ${source.padEnd(5)}  ${status}\n`,
    );
  }
  return 0;
};

const handleCapabilitiesList: Handler = async () => {
  const config = await loadWorkspaceConfig(process.cwd()).catch(() => defaultConfig("freelancer"));
  const registry = CapabilityRegistry.fromConfig(config.capabilities);
  for (const capability of registry.list()) {
    const actions = Object.entries(capability.actions)
      .filter(([, enabled]) => enabled)
      .map(([action]) => action)
      .join(", ");
    process.stdout.write(
      `${capability.id.padEnd(22)}  ${capability.type.padEnd(8)}  ${capability.status.padEnd(10)}  ${capability.risk_class.padEnd(8)}  ${capability.allowed_agents.join(",") || "-"}\n`,
    );
    process.stdout.write(`  actions: ${actions || "(none)"}\n`);
    if (capability.required_approvals.length > 0) {
      process.stdout.write(`  approvals: ${capability.required_approvals.join(", ")}\n`);
    }
  }
  return 0;
};

const handleCapabilitiesCheck: Handler = async (args) => {
  const flags = parseFlags(args, {
    agent: { type: "string" },
    capability: { type: "string" },
    action: { type: "string" },
    target: { type: "string" },
    "policy-action": { type: "string" },
    issue: { type: "number" },
    test: { type: "string" },
    approval: { type: "string" },
  });
  if (typeof flags === "string") return err(`capabilities check: ${flags}`);
  if (typeof flags.agent !== "string") return err("capabilities check: --agent required");
  if (typeof flags.capability !== "string") return err("capabilities check: --capability required");
  if (typeof flags.action !== "string") return err("capabilities check: --action required");

  const config = await loadWorkspaceConfig(process.cwd()).catch(() => defaultConfig("freelancer"));
  const result = await new CapabilityUseService(process.cwd(), { config }).check({
    agent: flags.agent,
    capabilityId: flags.capability,
    action: flags.action,
    ...(typeof flags.target === "string" ? { target: flags.target } : {}),
    ...(typeof flags["policy-action"] === "string" ? { policyAction: flags["policy-action"] } : {}),
    ...(typeof flags.issue === "number" ? { linkedIssueNumbers: [flags.issue] } : {}),
    ...(typeof flags.test === "string" ? { testEvidence: [flags.test] } : {}),
    ...(typeof flags.approval === "string" ? { approvalIds: [flags.approval] } : {}),
  });

  process.stdout.write(
    `capability: ${result.capability.capability_id}.${result.capability.action} -> ${result.status}\n`,
  );
  process.stdout.write(`policy: ${result.policy.action} (${result.policy.outcome})\n`);
  if (result.missing_gates.length > 0)
    process.stdout.write(`missing gates: ${result.missing_gates.join(", ")}\n`);
  if (result.approval) process.stdout.write(`approval: ${result.approval.id}\n`);
  process.stdout.write(`artifact: ${result.artifact.id}\n`);
  return 0;
};

// --- Command map and dispatch ---

const COMMANDS: Record<string, Handler | Record<string, Handler>> = {
  init: handleInit,
  status: handleStatus,
  intake: handleIntake,
  config: { validate: handleConfigValidate },
  memory: { search: handleMemorySearch },
  client: {
    create: handleClientCreate,
    list: handleClientList,
    intelligence: handleClientIntelligence,
    "account-plan": handleClientAccountPlan,
    "success-status": handleClientSuccessStatus,
  },
  project: {
    create: handleProjectCreate,
    dispatch: handleProjectDispatch,
    health: handleProjectHealth,
    "verify-repositories": handleProjectVerifyRepositories,
    list: handleProjectList,
  },
  opportunity: { create: handleOpportunityCreate, list: handleOpportunityList },
  revenue: { pipeline: handleRevenuePipeline },
  growth: { memory: handleGrowthMemory, content: handleGrowthContent, review: handleGrowthReview },
  run: { new: handleRunNew, list: handleRunList },
  autonomy: { "memory-scan": handleAutonomyMemoryScan, "retry-scan": handleAutonomyRetryScan },
  report: { generate: handleReportGenerate },
  audit: {
    tail: handleAuditTail,
    search: async (args: readonly string[]) => {
      const query = args.join(" ").trim().toLowerCase();
      if (!query) return err("audit search: missing query");
      const path = workspacePaths(process.cwd()).auditLog;
      try {
        const content = await readFile(path, "utf8");
        const lines = content
          .trim()
          .split("\n")
          .filter(Boolean)
          .filter((l) => l.toLowerCase().includes(query));
        if (lines.length === 0) {
          process.stdout.write("(no matches)\n");
          return 0;
        }
        for (const l of lines) {
          try {
            const e = JSON.parse(l) as {
              timestamp: string;
              actor: string;
              action: string;
              target?: string;
              result: string;
            };
            process.stdout.write(
              `${e.timestamp}  ${e.actor.padEnd(18)}  ${e.action.padEnd(28)}  ${e.target ?? ""}  [${e.result}]\n`,
            );
          } catch {
            process.stdout.write(`${l}\n`);
          }
        }
        return 0;
      } catch {
        return err("audit search: no audit log yet (run `bureau init` first)");
      }
    },
  },
  policy: { explain: handlePolicyExplain },
  decision: async (args: readonly string[]) => {
    const flags = parseFlags(args, {
      what: { type: "string" },
      why: { type: "string" },
      actor: { type: "string" },
      run: { type: "string" },
      affects: { type: "string" },
    });
    if (typeof flags === "string") return err(`decision: ${flags}`);
    if (typeof flags.what !== "string") return err("decision: --what required");
    if (typeof flags.why !== "string") return err("decision: --why required");
    const result = await recordDecision(process.cwd(), {
      actor: typeof flags.actor === "string" ? flags.actor : "owner",
      what: flags.what,
      why: flags.why,
      ...(typeof flags.run === "string" ? { runId: flags.run } : {}),
      ...(typeof flags.affects === "string"
        ? {
            affects: flags.affects
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          }
        : {}),
    });
    process.stdout.write(`bureau: decision ${result.id} recorded in DECISIONS.md\n`);
    return 0;
  },
  "follow-up": async (args: readonly string[]) => {
    const flags = parseFlags(args, {
      section: { type: "string" },
      line: { type: "string" },
    });
    if (typeof flags === "string") return err(`follow-up: ${flags}`);
    if (typeof flags.line !== "string") return err("follow-up: --line required");
    const section = parseDailyNoteSection(
      typeof flags.section === "string" ? flags.section : undefined,
    );
    if (!section) return err("follow-up: --section must be Events, Runs, Decisions, or Follow-ups");
    const path = await appendDailyNote(process.cwd(), section, flags.line);
    await new AuditLog(workspacePaths(process.cwd()).auditLog).append({
      actor: "cli",
      action: "memory.daily_note_appended",
      target: section,
      result: "ok",
    });
    process.stdout.write(`bureau: appended to ${path}\n`);
    return 0;
  },
  approvals: {
    list: handleApprovalsList,
    approve: handleApprovalsResolve("approved"),
    reject: handleApprovalsResolve("rejected"),
  },
  auth: {
    login: handleAuthLogin,
    list: handleAuthList,
    logout: handleAuthLogout,
  },
  providers: { list: handleProvidersList },
  capabilities: { list: handleCapabilitiesList, check: handleCapabilitiesCheck },
  github: {
    "provision-repo": handleGitHubProvisionRepo,
    "draft-issues": handleGitHubDraftIssues,
    "create-issues": handleGitHubCreateIssues,
    "create-pr": handleGitHubCreatePr,
    "ensure-labels": async (args: readonly string[]) => {
      const flags = parseFlags(args, {
        owner: { type: "string" },
        repo: { type: "string" },
        token: { type: "string" },
      });
      if (typeof flags === "string") return err(`github ensure-labels: ${flags}`);
      if (typeof flags.owner !== "string") return err("github ensure-labels: --owner required");
      if (typeof flags.repo !== "string") return err("github ensure-labels: --repo required");
      const token = typeof flags.token === "string" ? flags.token : process.env["GITHUB_TOKEN"];
      if (!token) return err("github ensure-labels: provide --token or set GITHUB_TOKEN");
      const gh = new OctokitGitHubClient({ token });
      await gh.ensureLabels(flags.owner, flags.repo, GITHUB_LABEL_TAXONOMY);
      process.stdout.write(
        `bureau: ensured ${GITHUB_LABEL_TAXONOMY.length} labels on ${flags.owner}/${flags.repo}\n`,
      );
      return 0;
    },
    sync: async (args: readonly string[]) => {
      const flags = parseFlags(args, {
        owner: { type: "string" },
        repo: { type: "string" },
        token: { type: "string" },
        state: { type: "string" },
        client: { type: "string" },
        project: { type: "string" },
        "stale-days": { type: "number" },
        "no-issues": { type: "boolean" },
        "no-prs": { type: "boolean" },
        "no-checks": { type: "boolean" },
      });
      if (typeof flags === "string") return err(`github sync: ${flags}`);
      if (typeof flags.owner !== "string") return err("github sync: --owner required");
      if (typeof flags.repo !== "string") return err("github sync: --repo required");
      const token = typeof flags.token === "string" ? flags.token : process.env["GITHUB_TOKEN"];
      if (!token) return err("github sync: provide --token or set GITHUB_TOKEN");
      const config = await loadWorkspaceConfig(process.cwd());
      const approvals = new ApprovalRegistry(process.cwd());
      const policy = new PolicyEngine(config, approvals);
      const audit = new AuditLog(workspacePaths(process.cwd()).auditLog);
      const artifacts = new ArtifactStore(process.cwd());
      const runs = new RunEngine(process.cwd(), { audit, artifacts, policy });

      const result = await new GitHubSignalSyncService(process.cwd(), {
        githubClient: new OctokitGitHubClient({ token }),
        audit,
        artifacts,
      }).sync({
        owner: flags.owner,
        repo: flags.repo,
        state: (typeof flags.state === "string" ? flags.state : "open") as
          | "open"
          | "closed"
          | "all",
        ...(typeof flags.client === "string" ? { clientSlug: flags.client } : {}),
        ...(typeof flags.project === "string" ? { projectSlug: flags.project } : {}),
        includeIssues: flags["no-issues"] !== true,
        includePullRequests: flags["no-prs"] !== true,
        includeChecks: flags["no-checks"] !== true,
        ...(typeof flags["stale-days"] === "number" ? { staleDays: flags["stale-days"] } : {}),
      });
      const triggers = await new GitHubSignalTriggerService({
        runs,
        audit,
        policy,
        workspaceRoot: process.cwd(),
        coordinator: { audit, artifacts, policy },
      }).trigger({
        repository: result.repository,
        report: result.report,
        failingChecks: result.failingChecks,
        staleIssues: result.staleIssues,
        stalePullRequests: result.stalePullRequests,
      });
      process.stdout.write(
        `bureau: synced ${result.repository}: ${result.issues.length} issues, ${result.pullRequests.length} PRs, ${result.checks.length} checks\n`,
      );
      if (result.project) {
        process.stdout.write(`project: ${result.project.slug}\n`);
      }
      process.stdout.write(
        `signals: ${result.failingChecks.length} failing checks, ${result.staleIssues.length + result.stalePullRequests.length} stale items, ${result.createdOpportunities.length} new opportunities\n`,
      );
      process.stdout.write(
        `triggers: ${triggers.triggered.length} runs started, ${triggers.skipped.length} skipped\n`,
      );
      process.stdout.write(`report: ${result.report.id}\n`);
      for (const i of result.issues.slice(0, 10)) {
        process.stdout.write(`  #${i.number}  ${i.state.padEnd(6)}  ${i.title}\n`);
      }
      for (const pr of result.pullRequests.slice(0, 10)) {
        const failing = result.failingChecks.filter((check) => check.headSha === pr.headSha).length;
        process.stdout.write(`  PR #${pr.number}  ${pr.state.padEnd(6)}  ${pr.title}`);
        if (failing > 0) process.stdout.write(`  failing_checks=${failing}`);
        process.stdout.write("\n");
      }
      if (result.issues.length + result.pullRequests.length > 20) {
        process.stdout.write(
          `  ...and ${result.issues.length + result.pullRequests.length - 20} more items\n`,
        );
      }
      return 0;
    },
  },
  serve: handleServe,
  daemon: handleDaemon,
};

export async function main(argv: readonly string[]): Promise<number> {
  const [, , ...args] = argv;
  const command = args[0];

  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const entry = COMMANDS[command];
  if (!entry) {
    process.stderr.write(`bureau: unknown command "${command}"\n\n${HELP}`);
    return 1;
  }
  if (typeof entry === "function") {
    return entry(args.slice(1));
  }
  const sub = args[1];
  if (!sub || !(sub in entry)) {
    const subs = Object.keys(entry).join(", ");
    process.stderr.write(`bureau ${command}: expected one of: ${subs}\n`);
    return 1;
  }
  const handler = entry[sub];
  if (!handler) {
    process.stderr.write(`bureau ${command}: unknown sub-command "${sub}"\n`);
    return 1;
  }
  return handler(args.slice(2));
}
