export type CoordinatorToolAction =
  | "save_client"
  | "create_intake"
  | "list_clients"
  | "delete_client"
  | "create_project"
  | "create_approval"
  | "draft_message"
  | "answer";

export type CoordinatorImplementedToolAction =
  | "save_client"
  | "create_intake"
  | "list_clients"
  | "delete_client"
  | "answer";

export type CoordinatorToolRouteClass = "agentic_tool_path" | "safety_fallback" | "legacy";

export interface CoordinatorToolDefinition {
  name: CoordinatorToolAction;
  status: "implemented" | "planned";
  mutates: boolean;
  description: string;
}

export interface CoordinatorToolPlan {
  action: CoordinatorImplementedToolAction;
  clientName?: string;
  /** Explicit slug for a target client, when the owner/provider gives one. */
  clientSlug?: string;
  industry?: string;
  answer?: string;
  /**
   * Owner confirmation flag for destructive actions (e.g. delete_client). The
   * runtime refuses to delete unless this is explicitly `true`, honoring the
   * "deleting data requires approval" policy.
   */
  confirmed?: boolean;
  /**
   * Build-intent flag for the async owner-triggered build path. Set `true` ONLY
   * when the owner wants software BUILT/DEVELOPED now for themselves/internally
   * (e.g. "creami/costruisci/sviluppa un sito/app/gioco"). It is left unset for
   * client-scoping intakes ("il cliente X vuole un sito" -> propose/scope first)
   * and for non-build messages. Like {@link confirmed}, only a literal boolean
   * `true` (or the string "true") sets it; everything else leaves it unset so the
   * build path stays off by default (it is also gated on provider codegen mode
   * before any build is fired).
   */
  dispatch_build?: boolean;
  confidence?: number;
}

export interface CoordinatorMutationPathInventoryItem {
  id: string;
  entrypoint: string;
  classification: CoordinatorToolRouteClass;
  tool?: CoordinatorToolAction;
  rationale: string;
}

export const COORDINATOR_TOOL_DEFINITIONS: readonly CoordinatorToolDefinition[] = [
  {
    name: "save_client",
    status: "implemented",
    mutates: true,
    description: "Persist only a client identity record without creating project scope.",
  },
  {
    name: "create_intake",
    status: "implemented",
    mutates: true,
    description: "Create the client, project, opportunity, and internal artifacts.",
  },
  {
    name: "list_clients",
    status: "implemented",
    mutates: false,
    description: "Read the local client registry and answer with concise registry state.",
  },
  {
    name: "delete_client",
    status: "implemented",
    mutates: true,
    description:
      "Permanently delete a client and cascade-delete its projects and opportunities. Destructive: requires explicit owner confirmation before it removes anything.",
  },
  {
    name: "create_project",
    status: "planned",
    mutates: true,
    description: "Create a project for an existing client without full opportunity intake.",
  },
  {
    name: "create_approval",
    status: "planned",
    mutates: true,
    description: "Create a bounded approval request for a risky external commitment.",
  },
  {
    name: "draft_message",
    status: "planned",
    mutates: true,
    description: "Draft an owner-reviewed message without sending it externally.",
  },
  {
    name: "answer",
    status: "implemented",
    mutates: false,
    description: "Respond without mutating memory or external systems.",
  },
];

export const COORDINATOR_MUTATION_PATH_INVENTORY: readonly CoordinatorMutationPathInventoryItem[] =
  [
    {
      id: "coordinator.chat.provider.save_client",
      entrypoint: "CoordinatorChatService.process",
      classification: "agentic_tool_path",
      tool: "save_client",
      rationale:
        "Provider chooses the typed save_client tool; runtime validates arguments before execution.",
    },
    {
      id: "coordinator.chat.provider.create_intake",
      entrypoint: "CoordinatorChatService.process",
      classification: "agentic_tool_path",
      tool: "create_intake",
      rationale:
        "Provider chooses the typed create_intake tool; runtime executes the existing intake service.",
    },
    {
      id: "coordinator.chat.provider.list_clients",
      entrypoint: "CoordinatorChatService.process",
      classification: "agentic_tool_path",
      tool: "list_clients",
      rationale:
        "Provider chooses the typed read tool; runtime reads the client registry directly.",
    },
    {
      id: "coordinator.chat.fallback.save_client",
      entrypoint: "CoordinatorChatService.process",
      classification: "safety_fallback",
      tool: "save_client",
      rationale:
        "Local deterministic classifier preserves the client-only safety behavior when no provider route is available.",
    },
    {
      id: "coordinator.chat.fallback.create_intake",
      entrypoint: "CoordinatorChatService.process",
      classification: "safety_fallback",
      tool: "create_intake",
      rationale:
        "Local deterministic classifier handles explicit project-scope intake when no provider route is available.",
    },
    {
      id: "coordinator.chat.fallback.list_clients",
      entrypoint: "CoordinatorChatService.process",
      classification: "safety_fallback",
      tool: "list_clients",
      rationale:
        "Local deterministic classifier answers obvious registry questions when no provider route is available.",
    },
    {
      id: "api.post_coordinator_intake",
      entrypoint: "POST /coordinator/intake",
      classification: "agentic_tool_path",
      tool: "create_intake",
      rationale:
        "Compatibility endpoint builds an explicit create_intake tool execution and runs it through the shared Coordinator tool runtime.",
    },
    {
      id: "cli.bureau_intake",
      entrypoint: "bureau intake",
      classification: "agentic_tool_path",
      tool: "create_intake",
      rationale:
        "CLI command builds an explicit create_intake tool execution and runs it through the shared Coordinator tool runtime.",
    },
    {
      id: "coordinator.runtime.delete_client",
      entrypoint: "CoordinatorToolRuntime.executeDeleteClient",
      classification: "agentic_tool_path",
      tool: "delete_client",
      rationale:
        "Executive destructive tool: resolves the target client by slug or name and cascade-deletes it only after explicit owner confirmation (confirmed: true), honoring the delete-requires-approval policy.",
    },
  ];

const IMPLEMENTED_ACTIONS = new Set<CoordinatorImplementedToolAction>([
  "save_client",
  "create_intake",
  "list_clients",
  "delete_client",
  "answer",
]);

export function listCoordinatorMutationPathInventory(): CoordinatorMutationPathInventoryItem[] {
  return COORDINATOR_MUTATION_PATH_INVENTORY.map((item) => ({ ...item }));
}

export function implementedCoordinatorToolNames(): CoordinatorImplementedToolAction[] {
  return COORDINATOR_TOOL_DEFINITIONS.filter(
    (tool): tool is CoordinatorToolDefinition & { name: CoordinatorImplementedToolAction } =>
      tool.status === "implemented" &&
      IMPLEMENTED_ACTIONS.has(tool.name as CoordinatorImplementedToolAction),
  ).map((tool) => tool.name);
}

export function coordinatorToolPromptCatalog(): string {
  return COORDINATOR_TOOL_DEFINITIONS.map((tool) => {
    const suffix = tool.status === "implemented" ? "" : " (planned, do not choose yet)";
    return `- ${tool.name}: ${tool.description}${suffix}`;
  }).join("\n");
}

export function parseCoordinatorToolPlan(raw: string): CoordinatorToolPlan | undefined {
  const json = extractFirstJsonObject(raw);
  if (!json) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const value = parsed as Record<string, unknown>;
  const args =
    value["args"] && typeof value["args"] === "object"
      ? (value["args"] as Record<string, unknown>)
      : value;
  const action = parseAction(value);
  if (!action) return undefined;

  const clientName = cleanCoordinatorToolClientName(
    stringArg(args, "clientName") ?? stringArg(args, "client_name") ?? "",
  );
  const clientSlug = stringArg(args, "clientSlug") ?? stringArg(args, "client_slug");
  const industry = stringArg(args, "industry");
  const answer = stringArg(args, "answer");
  // Only a literal boolean `true` confirms a destructive action. A missing
  // flag, a string, or `false` all leave `confirmed` unset so the runtime
  // refuses to delete without an explicit owner go-ahead.
  const confirmed = parseConfirmedFlag(args);
  // Build-intent flag. Same fail-closed parsing as `confirmed`: only a literal
  // boolean `true` (or the string "true") opts the message into the async build
  // path; anything else leaves it unset so the build never fires by default.
  const dispatchBuild = parseBooleanFlag(args, ["dispatch_build", "dispatchBuild", "build"]);
  const confidence =
    typeof value["confidence"] === "number" && Number.isFinite(value["confidence"])
      ? Math.max(0, Math.min(1, value["confidence"]))
      : undefined;

  return {
    action,
    ...(clientName ? { clientName } : {}),
    ...(clientSlug ? { clientSlug } : {}),
    ...(industry ? { industry } : {}),
    ...(answer ? { answer } : {}),
    ...(confirmed ? { confirmed } : {}),
    ...(dispatchBuild ? { dispatch_build: dispatchBuild } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

/**
 * Parse an optional boolean flag from any of the given keys, failing closed.
 * Only a literal boolean `true` (or the explicit string "true") counts as set;
 * everything else — missing, `false`, "yes", 1, etc. — returns `false`. Used by
 * the build-intent flag so the async build path stays off unless the planner
 * explicitly opts in.
 */
function parseBooleanFlag(source: Record<string, unknown>, keys: readonly string[]): boolean {
  for (const key of keys) {
    const value = source[key];
    if (value === true) return true;
    if (typeof value === "string" && value.trim().toLowerCase() === "true") return true;
  }
  return false;
}

/**
 * Parse a destructive-action confirmation flag. Only a literal boolean `true`
 * (or the explicit string "true") counts as confirmation; everything else —
 * missing, "false", "yes", 1, etc. — is treated as NOT confirmed, so the
 * delete gate fails closed.
 */
function parseConfirmedFlag(source: Record<string, unknown>): boolean {
  const value = source["confirmed"] ?? source["confirm"];
  if (value === true) return true;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
}

function parseAction(value: Record<string, unknown>): CoordinatorImplementedToolAction | undefined {
  const rawAction = String(value["action"] ?? value["tool"] ?? "").toLowerCase();
  const action =
    rawAction === "save_client" || rawAction === "client.save"
      ? "save_client"
      : rawAction === "create_intake" || rawAction === "intake.create"
        ? "create_intake"
        : rawAction === "list_clients" || rawAction === "clients.list"
          ? "list_clients"
          : rawAction === "delete_client" || rawAction === "client.delete"
            ? "delete_client"
            : rawAction === "answer" || rawAction === "clarify"
              ? "answer"
              : undefined;
  return action && IMPLEMENTED_ACTIONS.has(action) ? action : undefined;
}

function cleanCoordinatorToolClientName(input: string): string | undefined {
  let cleaned = input
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/[,.!?;:]+$/g, "")
    .trim();
  if (!cleaned) return undefined;

  const stopPatterns = [
    /\s+(?:lo|la|li|le)\s+(?:puoi|potresti|riesci)\b[\s\S]*$/i,
    /\s+(?:puoi|potresti|riesci)\b[\s\S]*$/i,
    /\s+(?:salvalo|salvala|salvali|salvale|salvare|registralo|registrala|registrare|memorizzalo|memorizzala|memorizzare|aggiungilo|aggiungila|aggiungere)\b[\s\S]*$/i,
    /\s+(?:come|da)\s+(?:cliente|client|lead)\b[\s\S]*$/i,
    /\s+(?:vuole|vogliono|ha|hanno|chiede|chiedono|mi\s+ha|mi\s+hanno)\b[\s\S]*$/i,
    /\s+(?:che|e)\s+(?:vuole|vogliono|ha|hanno|chiede|chiedono|mi\s+ha|mi\s+hanno)\b[\s\S]*$/i,
  ];
  for (const pattern of stopPatterns) {
    cleaned = cleaned.replace(pattern, "").trim();
  }

  cleaned = cleaned
    .replace(/[,.!?;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return undefined;
  return cleaned
    .split(/\s+/)
    .map((part) => {
      const [first = "", ...rest] = part;
      return `${first.toUpperCase()}${rest.join("").toLowerCase()}`;
    })
    .join(" ");
}

function extractFirstJsonObject(raw: string): string | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(raw);
  const text = fenced?.[1] ?? raw;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  return text.slice(start, end + 1);
}

function stringArg(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
