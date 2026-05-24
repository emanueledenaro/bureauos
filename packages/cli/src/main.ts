import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ApprovalRegistry,
  ArtifactStore,
  AuditLog,
  ClientRegistry,
  ConfigError,
  InitError,
  OpportunityRegistry,
  PolicyEngine,
  ProjectRegistry,
  RunEngine,
  VERSION,
  defaultConfig,
  initWorkspace,
  loadConfig,
  startApiServer,
  workspacePaths,
  type BureauConfig,
  type Preset,
} from "@bureauos/core";
import { LocalMemoryStore } from "@bureauos/memory";
import {
  AnthropicAdapter,
  GoogleAdapter,
  LocalAdapter,
  OpenAIAdapter,
  OpenRouterAdapter,
  ProviderRouter,
} from "@bureauos/providers";

const HELP = `bureau ${VERSION}

Usage:
  bureau <command> [options]

Workspace:
  init [--preset p] [--name n] [--force]   Initialize a new BureauOS workspace
  status                                    Show company pulse
  config validate [path]                    Validate the local bureauos.yaml

Memory:
  memory search <query>                     Search executive and project memory

Registries:
  client create --name <n> [--status s] [--industry i]
  client list
  project create --name <n> --client <slug> [--status s] [--repo url] [--stack s]
  project list
  opportunity create --title <t> --source <s> --client <slug> [--value v] [--margin m]
  opportunity list

Runs and audit:
  run new --type <t> --scope <s> [--client slug] [--project slug]
  run list
  audit tail [-n N]

Policy:
  policy explain <action> [--actor a] [--target t]

Approvals:
  approvals list
  approvals approve <id> [--reason r]
  approvals reject <id> [--reason r]

Providers:
  providers list

Server:
  serve [--port N]                          Start the local HTTP API server

Misc:
  --version | -v       Print version
  --help | -h          This help
`;

type Handler = (args: readonly string[]) => Promise<number>;

const PRESETS: ReadonlySet<Preset> = new Set(["freelancer", "agency", "startup", "operator"]);

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
    process.stdout.write("bureau init [--preset freelancer|agency|startup|operator] [--name <n>] [--force]\n");
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
    if (e instanceof InitError) return err(`init: ${e.message}`);
    return err(`init: ${String(e)}`);
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

const handleConfigValidate: Handler = async (args) => {
  const path = args[0] ?? workspacePaths(process.cwd()).configFile;
  try {
    const config = await loadConfig(path);
    process.stdout.write(`bureau: config OK (${config.organization.name}, preset ${config.setup.preset})\n`);
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
    ...(typeof flags.status === "string" ? { status: flags.status as "lead" | "active" | "paused" | "churned" } : {}),
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

const handleProjectCreate: Handler = async (args) => {
  const flags = parseFlags(args, {
    name: { type: "string", alias: "n" },
    client: { type: "string", alias: "c" },
    status: { type: "string" },
    repo: { type: "string" },
    stack: { type: "string" },
  });
  if (typeof flags === "string") return err(`project create: ${flags}`);
  if (typeof flags.name !== "string") return err("project create: --name is required");
  if (typeof flags.client !== "string") return err("project create: --client <slug> is required");
  const clientRegistry = new ClientRegistry(process.cwd());
  const client = await clientRegistry.get(flags.client);
  if (!client) return err(`project create: client "${flags.client}" not found`);
  const registry = new ProjectRegistry(process.cwd());
  const record = await registry.create({
    name: flags.name,
    clientId: client.id,
    ...(typeof flags.status === "string" ? { status: flags.status as "intake" | "proposal" | "approved" | "in_progress" | "blocked" | "delivered" | "cancelled" } : {}),
    ...(typeof flags.repo === "string" ? { repository: flags.repo } : {}),
    ...(typeof flags.stack === "string" ? { stack: flags.stack } : {}),
  });
  await new AuditLog(workspacePaths(process.cwd()).auditLog).append({
    actor: "cli",
    action: "project.create",
    target: record.id,
    result: "ok",
  });
  process.stdout.write(`bureau: created project ${record.id} (${record.slug}) for client ${client.id}\n`);
  return 0;
};

const handleProjectList: Handler = async () => {
  const registry = new ProjectRegistry(process.cwd());
  const all = await registry.list();
  if (all.length === 0) {
    process.stdout.write("(no projects)\n");
    return 0;
  }
  for (const p of all) {
    process.stdout.write(`${p.id}  ${p.slug.padEnd(24)}  ${p.status.padEnd(12)}  ${p.name}\n`);
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
  if (typeof flags.client !== "string") return err("opportunity create: --client <slug> is required");
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

const handleRunNew: Handler = async (args) => {
  const flags = parseFlags(args, {
    type: { type: "string", alias: "t" },
    scope: { type: "string", alias: "s" },
    client: { type: "string", alias: "c" },
    project: { type: "string", alias: "p" },
    source: { type: "string" },
  });
  if (typeof flags === "string") return err(`run new: ${flags}`);
  if (typeof flags.type !== "string") return err("run new: --type is required");
  if (typeof flags.scope !== "string") return err("run new: --scope is required");
  const config = await loadWorkspaceConfig(process.cwd());
  const approvals = new ApprovalRegistry(process.cwd());
  const audit = new AuditLog(workspacePaths(process.cwd()).auditLog);
  const policy = new PolicyEngine(config, approvals);
  const artifacts = new ArtifactStore(process.cwd());
  const engine = new RunEngine(process.cwd(), { audit, artifacts, policy });
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
    triggerSource: typeof flags.source === "string" ? flags.source : "cli",
    scope: flags.scope,
    ...(clientId !== undefined ? { clientId } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
  });
  process.stdout.write(`bureau: run ${record.id} (${record.status})\n`);
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
    process.stdout.write(`${r.id}  ${r.type.padEnd(12)}  ${r.status.padEnd(14)}  ${r.scope}\n`);
  }
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
        const e = JSON.parse(l) as { timestamp: string; actor: string; action: string; target?: string; result: string };
        process.stdout.write(`${e.timestamp}  ${e.actor.padEnd(18)}  ${e.action.padEnd(28)}  ${e.target ?? ""}  [${e.result}]\n`);
      } catch {
        process.stdout.write(`${l}\n`);
      }
    }
    return 0;
  } catch {
    return err("audit tail: no audit log yet (run `bureau init` first)");
  }
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

const handleApprovalsResolve = (status: "approved" | "rejected"): Handler => async (args) => {
  const id = args[0];
  if (!id) return err(`approvals ${status}: missing <id>`);
  const rest = args.slice(1);
  const flags = parseFlags(rest, { reason: { type: "string" } });
  if (typeof flags === "string") return err(`approvals ${status}: ${flags}`);
  const registry = new ApprovalRegistry(process.cwd());
  await registry.resolve(id, status, "owner", typeof flags.reason === "string" ? flags.reason : "");
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
  const server = await startApiServer({
    workspaceRoot: process.cwd(),
    config,
    ...(typeof flags.port === "number" ? { port: flags.port } : {}),
  });
  process.stdout.write(`bureau: API server listening at ${server.url}\n`);
  process.stdout.write(`bureau: workspace ${workspacePaths(process.cwd()).workspaceDir}\n`);
  process.stdout.write(`bureau: press Ctrl-C to stop\n`);
  await new Promise<void>(() => {});
  return 0;
};

const handleProvidersList: Handler = async () => {
  const config = await loadWorkspaceConfig(process.cwd()).catch(() => defaultConfig("freelancer"));
  const router = new ProviderRouter();
  router.register(new OpenAIAdapter("openai-default", { apiKey: process.env["OPENAI_API_KEY"] }));
  router.register(new AnthropicAdapter("anthropic-default", { apiKey: process.env["ANTHROPIC_API_KEY"] }));
  router.register(new GoogleAdapter("google-default", { apiKey: process.env["GOOGLE_API_KEY"] }));
  router.register(new OpenRouterAdapter("openrouter-default", { apiKey: process.env["OPENROUTER_API_KEY"] }));
  router.register(new LocalAdapter("local-default", { baseUrl: process.env["LOCAL_MODEL_URL"] }));
  const validations = await router.validate();
  process.stdout.write(`Configured for: ${config.supreme_coordinator.provider} (${config.supreme_coordinator.model})\n\n`);
  for (const adapter of router.list()) {
    const v = validations.get(adapter.id);
    const status = v?.ok ? "OK" : `MISSING (${v?.reason ?? ""})`;
    process.stdout.write(`${adapter.type.padEnd(12)}  ${adapter.id.padEnd(22)}  ${status}\n`);
  }
  return 0;
};

// --- Command map and dispatch ---

const COMMANDS: Record<string, Handler | Record<string, Handler>> = {
  init: handleInit,
  status: handleStatus,
  config: { validate: handleConfigValidate },
  memory: { search: handleMemorySearch },
  client: { create: handleClientCreate, list: handleClientList },
  project: { create: handleProjectCreate, list: handleProjectList },
  opportunity: { create: handleOpportunityCreate, list: handleOpportunityList },
  run: { new: handleRunNew, list: handleRunList },
  audit: { tail: handleAuditTail },
  policy: { explain: handlePolicyExplain },
  approvals: {
    list: handleApprovalsList,
    approve: handleApprovalsResolve("approved"),
    reject: handleApprovalsResolve("rejected"),
  },
  providers: { list: handleProvidersList },
  serve: handleServe,
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
