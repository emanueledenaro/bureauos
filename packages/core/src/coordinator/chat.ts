import type { ContextPacket } from "@bureauos/memory";
import {
  buildConfiguredProviderRouter,
  type GenerateTextResult,
  type ProviderAdapter,
} from "@bureauos/providers";
import { configureAgentProviderRouting, selectAgentModel } from "../agents/provider-routing.js";
import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import type { BureauConfig } from "../config/schema.js";
import { defaultConfig } from "../config/loader.js";
import { CoordinatorGlobalMemoryService } from "../memory/global.js";
import { workspacePaths } from "../paths.js";
import { ApprovalRegistry, type ApprovalRecord } from "../registries/approval.js";
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import { OpportunityRegistry, type OpportunityRecord } from "../registries/opportunity.js";
import { ProjectRegistry, type ProjectRecord } from "../registries/project.js";
import {
  CoordinatorIntakeService,
  isClientOnlySaveRequest,
  type CoordinatorAttachmentInput,
  type CoordinatorIntakeResult,
} from "./intake.js";
import {
  CoordinatorMessageStore,
  type CoordinatorMessageAttachment,
  type CoordinatorMessageRecord,
} from "./messages.js";
import { coordinatorIdentityAnswer, coordinatorIdleAnswer } from "./idle.js";
import { sanitizeCoordinatorVisibleText } from "./sanitize.js";
import { CoordinatorToolRuntime } from "./tool-runtime.js";
import {
  coordinatorToolPromptCatalog,
  implementedCoordinatorToolNames,
  parseCoordinatorToolPlan,
  type CoordinatorImplementedToolAction,
  type CoordinatorToolPlan,
} from "./tool-planning.js";

export interface CoordinatorChatInput {
  message: string;
  source?: string;
  attachments?: CoordinatorAttachmentInput[];
}

export interface CoordinatorChatProviderMeta {
  status: "used" | "unavailable" | "failed";
  provider?: string;
  model?: string;
  reason?: string;
}

export interface CoordinatorChatResult {
  mode: "intake" | "answer";
  ownerMessage: CoordinatorMessageRecord;
  coordinatorMessage: CoordinatorMessageRecord;
  result?: CoordinatorIntakeResult;
  provider: CoordinatorChatProviderMeta;
  memory: {
    generatedAt: string;
    hits: Array<{ path: string; snippet: string; score: number }>;
  };
}

export type CoordinatorChatStreamEvent =
  | { type: "status"; status: "started" | "provider_streaming" | "persisting" }
  | { type: "delta"; text: string }
  | { type: "final"; result: CoordinatorChatResult };

export interface CoordinatorChatDeps {
  config?: BureauConfig;
  messages?: CoordinatorMessageStore;
  intake?: CoordinatorIntakeService;
  clients?: ClientRegistry;
  projects?: ProjectRegistry;
  opportunities?: OpportunityRegistry;
  approvals?: ApprovalRegistry;
  artifacts?: ArtifactStore;
  memory?: CoordinatorGlobalMemoryService;
  audit?: AuditLog;
  tools?: CoordinatorToolRuntime;
  env?: NodeJS.ProcessEnv;
  providerSelector?: CoordinatorProviderSelector;
  providerTimeoutMs?: number;
  toolPlanningTimeoutMs?: number;
  toolPlanningDegradedTtlMs?: number;
}

export interface CoordinatorProviderSelection {
  provider: ProviderAdapter;
  model: string;
}

export type CoordinatorProviderSelector = (
  workspaceRoot: string,
  config: BureauConfig,
  env: NodeJS.ProcessEnv,
) => Promise<CoordinatorProviderSelection | undefined>;

interface CoordinatorToolPlanningResult {
  plan?: CoordinatorToolPlan;
  provider: CoordinatorChatProviderMeta;
}

interface ProjectStatusLookup {
  client?: ClientRecord;
  project?: ProjectRecord;
  opportunity?: OpportunityRecord;
  approvals: ApprovalRecord[];
  artifacts: ArtifactRecord[];
}

const DEFAULT_PROVIDER_TIMEOUT_MS = 12_000;
const DEFAULT_TOOL_PLANNING_TIMEOUT_MS = 3_000;
const DEFAULT_TOOL_PLANNING_DEGRADED_TTL_MS = 30_000;

interface ToolPlanningDegradedState {
  reason: string;
  until: number;
}

const toolPlanningDegradedProviders = new Map<string, ToolPlanningDegradedState>();

function includesAny(message: string, words: readonly string[]): boolean {
  const lower = message.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function normalizeReferenceText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const GENERIC_REFERENCE_TOKENS = new Set([
  "azienda",
  "brand",
  "business",
  "cliente",
  "client",
  "lead",
  "new",
  "nuovo",
  "nuova",
  "pizzeria",
  "project",
  "progetto",
  "ristorante",
  "sito",
  "website",
]);

function referenceTokens(input: string): string[] {
  return normalizeReferenceText(input)
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !GENERIC_REFERENCE_TOKENS.has(token));
}

function referenceScore(message: string, name: string): number {
  const normalizedMessage = ` ${normalizeReferenceText(message)} `;
  const normalizedName = normalizeReferenceText(name);
  if (!normalizedMessage.trim() || !normalizedName) return 0;
  if (normalizedMessage.includes(` ${normalizedName} `)) return 100 + normalizedName.length;
  return referenceTokens(name).reduce((score, token) => {
    if (!normalizedMessage.includes(` ${token} `)) return score;
    return score + Math.max(6, token.length);
  }, 0);
}

function projectKindScore(message: string, project: ProjectRecord): number {
  const normalizedMessage = normalizeReferenceText(message);
  const normalizedProject = normalizeReferenceText(`${project.name} ${project.stack}`);
  let score = 0;
  if (/\b(sito|website|html|css)\b/.test(normalizedMessage)) {
    if (/\b(sito|website|frontend|html|css)\b/.test(normalizedProject)) score += 10;
  }
  if (/\b(app|mobile)\b/.test(normalizedMessage)) {
    if (/\b(app|mobile|ios|android)\b/.test(normalizedProject)) score += 10;
  }
  if (/\b(prenot|booking)\b/.test(normalizedMessage)) {
    if (/\b(prenot|booking)\b/.test(normalizedProject)) score += 8;
  }
  return score;
}

function messageAttachments(
  attachments: readonly CoordinatorAttachmentInput[],
): CoordinatorMessageAttachment[] {
  return attachments.map((attachment) => ({
    name: attachment.name,
    type: attachment.type ?? "application/octet-stream",
    size: attachment.size ?? 0,
  }));
}

function hasIntakeIntent(
  message: string,
  attachments: readonly CoordinatorAttachmentInput[],
): boolean {
  const lower = message.toLowerCase();
  const dryRunSignals = [
    "senza creare",
    "non creare",
    "non aprire",
    "non generare",
    "solo dimmi",
    "solo spiegami",
    "solo analisi",
    "solo un consiglio",
    "dry run",
    "do not create",
    "don't create",
    "without creating",
    "analysis only",
  ];
  if (dryRunSignals.some((signal) => lower.includes(signal))) return false;
  const intakeSignals = [
    "ho parlato",
    "mi hanno chiesto",
    "mi ha chiesto",
    "cliente vuole",
    "cliente ha",
    "nuovo cliente",
    "lead",
    "opportunit",
    "preventivo",
    "proposta",
    "vuole un",
    "vogliono un",
    "wants a",
    "asked for",
    "booking",
    "prenot",
    "app mobile",
    "sito",
    "website",
    "pizzeria",
    "ristorante",
  ];
  if (intakeSignals.some((signal) => lower.includes(signal))) return true;
  if (attachments.length === 0) return false;
  return ["logo", "brief", "cliente", "progetto", "brand"].some((signal) => lower.includes(signal));
}

function hasCoordinatorToolIntent(
  message: string,
  attachments: readonly CoordinatorAttachmentInput[],
): boolean {
  if (hasIntakeIntent(message, attachments)) return true;
  if (attachments.length > 0) return true;
  return includesToolGatewaySignal(message);
}

function includesToolGatewaySignal(message: string): boolean {
  return includesAny(message, [
    "aggiungi",
    "client",
    "cliente",
    "contatto",
    "lead",
    "memorizza",
    "registra",
    "salva",
  ]);
}

function isClientRegistryQuestion(
  message: string,
  attachments: readonly CoordinatorAttachmentInput[],
): boolean {
  if (attachments.length > 0) return false;
  const lower = message.toLowerCase();
  if (!includesAny(lower, ["client", "cliente", "clienti", "lead"])) return false;
  return (
    includesAny(lower, ["elenca", "elenco", "lista", "quali", "quanti"]) ||
    /\b(clienti|lead)\s+(?:registrati|salvati|abbiamo)\b/i.test(lower)
  );
}

function wordsIn(message: string): string[] {
  return message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function hasCurrentWorkReference(
  message: string,
  attachments: readonly CoordinatorAttachmentInput[],
): boolean {
  if (attachments.length > 0) return true;
  const lower = message.toLowerCase();
  const signals = [
    "agent",
    "api",
    "app",
    "approval",
    "auth",
    "backend",
    "bos",
    "budget",
    "bureauos",
    "campaign",
    "cliente",
    "client",
    "codex",
    "coordinatore",
    "customer",
    "deadline",
    "delivery",
    "electron",
    "feature",
    "frontend",
    "github",
    "growth",
    "lead",
    "marketing",
    "memory",
    "modello",
    "oauth",
    "openai",
    "opportunit",
    "prenot",
    "project",
    "progetto",
    "provider",
    "repository",
    "revenue",
    "risk",
    "sito",
    "team",
    "website",
  ];
  return signals.some((signal) => lower.includes(signal));
}

function hasStatusIntent(message: string): boolean {
  const lower = message.toLowerCase();
  return [
    "come siamo messi",
    "dove siamo",
    "stato",
    "status",
    "cosa manca",
    "a che punto",
    "funziona",
    "che succede",
    "che fine ha fatto",
    "novita",
    "novità",
    "aggiornament",
  ].some((signal) => lower.includes(signal));
}

function isProjectStatusQuestion(
  message: string,
  attachments: readonly CoordinatorAttachmentInput[],
): boolean {
  if (attachments.length > 0) return false;
  const lower = message.toLowerCase();
  const hasWorkNoun = includesAny(lower, [
    "app",
    "lavoro",
    "opportunit",
    "project",
    "progetto",
    "richiesta",
    "sito",
    "website",
  ]);
  if (hasStatusIntent(lower) && (hasWorkNoun || lower.includes("?"))) return true;
  if (/\b(?:che\s+(?:ti\s+)?ho\s+(?:richiesto|chiesto)|che\s+avevo\s+chiesto)\b/i.test(lower)) {
    return hasWorkNoun;
  }
  const creationSignals = [
    "apri",
    "avvia",
    "crea",
    "creare",
    "fai",
    "fare",
    "mi ha chiesto",
    "mi hanno chiesto",
    "serve un",
    "vogliono un",
    "vorrebbe",
    "vuole un",
    "wants a",
  ];
  const looksLikeQuestion = lower.trim().endsWith("?") || lower.includes(" che ");
  return (
    looksLikeQuestion &&
    hasWorkNoun &&
    /\b(?:di|per|for)\b/.test(lower) &&
    !creationSignals.some((signal) => lower.includes(signal))
  );
}

function isLowContextMessage(
  message: string,
  attachments: readonly CoordinatorAttachmentInput[],
): boolean {
  if (attachments.length > 0) return false;
  if (isLowContextIdentityMessage(message, attachments)) return true;
  if (hasCurrentWorkReference(message, attachments) || hasStatusIntent(message)) return false;
  const words = wordsIn(message);
  if (words.length === 0) return true;
  const lowContextWords = new Set([
    "ciao",
    "hello",
    "hi",
    "hey",
    "salve",
    "buongiorno",
    "buonasera",
    "come",
    "stai",
    "va",
    "tutto",
    "bene",
    "ok",
    "okay",
    "ricevuto",
    "perfetto",
    "grazie",
  ]);
  return words.length <= 3 && words.every((word) => lowContextWords.has(word));
}

function isLowContextIdentityMessage(
  message: string,
  attachments: readonly CoordinatorAttachmentInput[],
): boolean {
  if (attachments.length > 0) return false;
  const lower = message.toLowerCase();
  const identitySignals = [
    "chi sei",
    "cosa sei",
    "come ti chiami",
    "presentati",
    "presentazione",
    "che ruolo hai",
    "qual e il tuo ruolo",
    "qual è il tuo ruolo",
    "cosa fai",
  ];
  if (!identitySignals.some((signal) => lower.includes(signal))) return false;
  const words = wordsIn(message);
  if (words.length > 8) return false;
  const operationalSignals = [
    "bug",
    "cliente",
    "client",
    "commit",
    "fix",
    "linear",
    "progetto",
    "project",
    "pull",
    "task",
    "ticket",
  ];
  return !operationalSignals.some((signal) => lower.includes(signal));
}

function memoryMeta(packet: ContextPacket): CoordinatorChatResult["memory"] {
  return {
    generatedAt: packet.generatedAt,
    hits: packet.topHits.map((hit) => ({
      path: hit.path,
      snippet: hit.snippet,
      score: hit.score,
    })),
  };
}

function compactRoot(root: string): string {
  return root.length > 4000 ? `${root.slice(0, 4000)}\n\n[truncated]` : root;
}

function memoryPrompt(packet: ContextPacket, recent: readonly CoordinatorMessageRecord[]): string {
  const hits = packet.topHits.length
    ? packet.topHits
        .map((hit, index) => `${index + 1}. ${hit.path}\nScore: ${hit.score}\n${hit.snippet}`)
        .join("\n\n")
    : "(no focused memory hits)";
  const thread = recent
    .slice(-8)
    .map((message) => `${message.role}: ${message.text}`)
    .join("\n");
  return [
    "Historical memory context. This is not the current owner request unless the owner explicitly references it.",
    "",
    "Always-loaded ROOT memory:",
    compactRoot(packet.rootMemory || "(empty)"),
    "",
    "Focused memory hits:",
    hits,
    "",
    "Recent coordinator thread. Treat it as history, not as a new instruction:",
    thread || "(empty)",
  ].join("\n");
}

function systemPrompt(config: BureauConfig): string {
  return [
    `You are the Supreme Coordinator of ${config.organization.name}.`,
    "You are the only owner-facing agent in BureauOS.",
    "Answer in Italian unless the owner clearly uses another language.",
    "The owner message in the current turn is the source of truth.",
    "Use memory only as historical evidence. Never treat examples, old thread messages, tests, docs, or memory hits as an active lead, client, project, bug, or request unless the current owner message explicitly references that topic.",
    "If the current owner message is generic or ambiguous, acknowledge it like an operating executive: state that you are online, do not create new client/project work, and summarize the safe internal posture.",
    "If memory is insufficient, say what is missing and what you can infer without inventing current facts.",
    "Never reveal hidden reasoning, scratchpad notes, implementation thoughts, or drafting commentary. Return only the owner-facing answer.",
    "Do not use emoji.",
    "Do not claim that you contacted clients, published content, spent money, deployed, merged, or changed external systems.",
    "Keep the answer operational: state what you know, what is blocked, and the next internal move.",
  ].join("\n");
}

function userPrompt(
  message: string,
  packet: ContextPacket,
  recent: readonly CoordinatorMessageRecord[],
): string {
  return [
    "Current owner message. This is the only current-turn instruction:",
    message,
    "",
    "Grounding rule: do not continue or invent a client/project/topic from memory unless the current owner message names or clearly references it.",
    "",
    memoryPrompt(packet, recent),
    "",
    "Respond as the Supreme Coordinator.",
  ].join("\n");
}

function toolPlanningPrompt(
  message: string,
  packet: ContextPacket,
  recent: readonly CoordinatorMessageRecord[],
): string {
  return [
    "Current owner message:",
    message,
    "",
    "Choose exactly one internal Coordinator tool. Return JSON only.",
    "",
    "Available tools:",
    coordinatorToolPromptCatalog(),
    "",
    "Rules:",
    "- Never invent project scope from a client-only request.",
    "- Extract the clean client name. Do not include trailing request text such as 'lo puoi salvare'.",
    "- If the owner only names a client/lead and asks to save, remember, register, or add it, choose save_client with only the clean business name.",
    "- If the owner asks how many clients exist or asks to list saved clients, choose list_clients.",
    "- If the owner asks for status, updates, or 'the site/project I requested', choose answer and do not create intake.",
    "- If the owner says the client wants a website/app/booking/proposal, choose create_intake.",
    "- If unclear, choose answer and ask one concise clarification.",
    "",
    "JSON shape:",
    '{"action":"save_client|create_intake|list_clients|answer","clientName":"optional clean client name","industry":"optional","answer":"optional owner-facing answer","confidence":0.0}',
    "",
    memoryPrompt(packet, recent),
  ].join("\n");
}

function idleAnswer(message: string, provider: CoordinatorChatProviderMeta): string {
  if (isLowContextIdentityMessage(message, [])) return coordinatorIdentityAnswer();
  const providerIssue =
    provider.status === "failed"
      ? `Il provider ${provider.provider ?? "configurato"} non ha risposto.`
      : "";
  return coordinatorIdleAnswer(providerIssue);
}

function sanitizeCoordinatorAnswer(answer: string): string {
  return sanitizeCoordinatorVisibleText(answer);
}

function deterministicAnswer(
  message: string,
  packet: ContextPacket,
  provider: CoordinatorChatProviderMeta,
): string {
  const hits = packet.topHits.slice(0, 3);
  const evidence = hits.length
    ? hits.map((hit) => `- ${hit.snippet}`).join("\n")
    : "- Non ho trovato memoria specifica oltre al ROOT e agli indici locali.";
  const providerLine =
    provider.status === "failed"
      ? `Il provider ${provider.provider ?? "configurato"} non ha risposto, quindi uso memoria locale verificabile.`
      : "Nessun provider modello e collegato per il Supreme Coordinator, quindi uso memoria locale verificabile.";
  return [
    providerLine,
    "",
    `Richiesta: ${message}`,
    "",
    "Memoria correlata, non confermata come richiesta corrente:",
    evidence,
    "",
    "Prossimo passo interno: lavoro solo sul tema indicato nel messaggio corrente. Se vuoi creare una nuova opportunita cliente, indicami cliente, obiettivo, budget indicativo, deadline e asset disponibili.",
  ].join("\n");
}

function clientRegistryAnswer(clients: readonly ClientRecord[]): string {
  if (clients.length === 0) {
    return "Non ci sono clienti salvati nel registry locale.";
  }
  const sorted = [...clients].sort((a, b) => a.name.localeCompare(b.name, "it"));
  const names = sorted.map((client) => client.name);
  const visibleNames = names.slice(0, 8).join(", ");
  const remaining = names.length > 8 ? `, più altri ${names.length - 8}` : "";
  const noun = clients.length === 1 ? "cliente salvato" : "clienti salvati";
  return `Abbiamo ${clients.length} ${noun}: ${visibleNames}${remaining}.`;
}

async function selectCoordinatorProvider(
  workspaceRoot: string,
  config: BureauConfig,
  env: NodeJS.ProcessEnv,
): Promise<CoordinatorProviderSelection | undefined> {
  const { router } = await buildConfiguredProviderRouter(workspaceRoot, env, config);
  configureAgentProviderRouting(router, config, ["supreme_coordinator"]);
  const selection = await selectAgentModel(router, config, "supreme_coordinator");
  if (!selection) return undefined;
  return {
    provider: selection.provider,
    model: selection.model,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (timeoutMs <= 0) return promise;
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(label)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function collectStreamText(
  stream: AsyncIterable<string>,
  timeoutMs: number,
  label: string,
): Promise<string> {
  const iterator = stream[Symbol.asyncIterator]();
  let text = "";
  try {
    while (true) {
      const next = await withTimeout(iterator.next(), timeoutMs, label);
      if (next.done) break;
      text += next.value;
    }
    return text;
  } catch (error) {
    await iterator.return?.();
    throw error;
  }
}

function visibleDeltas(text: string): string[] {
  const words = text.match(/\S+\s*/g);
  if (!words) return text ? [text] : [];
  const deltas: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && current.length + word.length > 80) {
      deltas.push(current);
      current = word;
    } else {
      current += word;
    }
  }
  if (current) deltas.push(current);
  return deltas;
}

function providerMeta(
  status: CoordinatorChatProviderMeta["status"],
  selection?: { provider: ProviderAdapter; model: string },
  result?: GenerateTextResult,
  reason?: string,
): CoordinatorChatProviderMeta {
  return {
    status,
    ...(selection ? { provider: selection.provider.id } : {}),
    ...(selection ? { model: result?.model || selection.model } : {}),
    ...(reason ? { reason } : {}),
  };
}

function toolPlanningHealthKey(
  workspaceRoot: string,
  selection: CoordinatorProviderSelection,
): string {
  return `${workspaceRoot}:${selection.provider.id}:${selection.model}`;
}

function requireMessagePair(records: readonly CoordinatorMessageRecord[]): {
  ownerMessage: CoordinatorMessageRecord;
  coordinatorMessage: CoordinatorMessageRecord;
} {
  const ownerMessage = records[0];
  const coordinatorMessage = records[1];
  if (!ownerMessage || !coordinatorMessage) {
    throw new Error("coordinator chat persistence failed");
  }
  return { ownerMessage, coordinatorMessage };
}

export class CoordinatorChatService {
  private readonly config: BureauConfig;
  private readonly messages: CoordinatorMessageStore;
  private readonly intake: CoordinatorIntakeService;
  private readonly clients: ClientRegistry;
  private readonly projects: ProjectRegistry;
  private readonly opportunities: OpportunityRegistry;
  private readonly approvals: ApprovalRegistry;
  private readonly artifacts: ArtifactStore;
  private readonly memory: CoordinatorGlobalMemoryService;
  private readonly audit: AuditLog;
  private readonly tools: CoordinatorToolRuntime;
  private readonly env: NodeJS.ProcessEnv;
  private readonly providerSelector: CoordinatorProviderSelector;
  private readonly providerTimeoutMs: number;
  private readonly toolPlanningTimeoutMs: number;
  private readonly toolPlanningDegradedTtlMs: number;

  constructor(
    private readonly workspaceRoot: string,
    deps: CoordinatorChatDeps = {},
  ) {
    this.config = deps.config ?? defaultConfig("freelancer");
    this.messages = deps.messages ?? new CoordinatorMessageStore(workspaceRoot);
    this.intake =
      deps.intake ?? new CoordinatorIntakeService(workspaceRoot, { config: this.config });
    this.clients = deps.clients ?? new ClientRegistry(workspaceRoot);
    this.projects = deps.projects ?? new ProjectRegistry(workspaceRoot);
    this.opportunities = deps.opportunities ?? new OpportunityRegistry(workspaceRoot);
    this.approvals = deps.approvals ?? new ApprovalRegistry(workspaceRoot);
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.memory = deps.memory ?? new CoordinatorGlobalMemoryService(workspaceRoot);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
    this.tools =
      deps.tools ??
      new CoordinatorToolRuntime(workspaceRoot, {
        config: this.config,
        audit: this.audit,
        intake: this.intake,
      });
    this.env = deps.env ?? process.env;
    this.providerSelector = deps.providerSelector ?? selectCoordinatorProvider;
    this.providerTimeoutMs = deps.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    this.toolPlanningTimeoutMs =
      deps.toolPlanningTimeoutMs ??
      Math.min(this.providerTimeoutMs, DEFAULT_TOOL_PLANNING_TIMEOUT_MS);
    this.toolPlanningDegradedTtlMs =
      deps.toolPlanningDegradedTtlMs ?? DEFAULT_TOOL_PLANNING_DEGRADED_TTL_MS;
  }

  private async planToolAction(
    message: string,
    packet: ContextPacket,
    recent: readonly CoordinatorMessageRecord[],
  ): Promise<CoordinatorToolPlanningResult> {
    const selection = await this.providerSelector(this.workspaceRoot, this.config, this.env);
    if (!selection) {
      return {
        provider: providerMeta("unavailable", undefined, undefined, "no_valid_provider_route"),
      };
    }

    const healthKey = toolPlanningHealthKey(this.workspaceRoot, selection);
    const degraded = toolPlanningDegradedProviders.get(healthKey);
    const now = Date.now();
    if (degraded && degraded.until > now) {
      return {
        provider: providerMeta(
          "failed",
          selection,
          undefined,
          `provider tool planning skipped while degraded: ${degraded.reason}`,
        ),
      };
    }
    if (degraded) toolPlanningDegradedProviders.delete(healthKey);

    try {
      const generated = await withTimeout(
        selection.provider.generateText({
          model: selection.model,
          system: [
            `You are the Supreme Coordinator of ${this.config.organization.name}.`,
            "You choose safe internal tools for BureauOS.",
            "Return JSON only. Do not include prose or hidden reasoning.",
          ].join("\n"),
          prompt: toolPlanningPrompt(message, packet, recent),
          temperature: 0,
          maxTokens: 500,
        }),
        this.toolPlanningTimeoutMs,
        `provider tool planning timed out after ${this.toolPlanningTimeoutMs}ms`,
      );
      toolPlanningDegradedProviders.delete(healthKey);
      return {
        plan: parseCoordinatorToolPlan(generated.text),
        provider: providerMeta("used", selection, generated, "coordinator_tool_plan"),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "provider tool planning failed";
      if (this.toolPlanningDegradedTtlMs > 0) {
        toolPlanningDegradedProviders.set(healthKey, {
          reason,
          until: Date.now() + this.toolPlanningDegradedTtlMs,
        });
      }
      return {
        provider: providerMeta("failed", selection, undefined, reason),
      };
    }
  }

  private async recordToolExecution(input: {
    tool: CoordinatorImplementedToolAction;
    target?: string;
  }): Promise<void> {
    await this.tools.recordToolExecution(input);
  }

  private async recordRejectedToolPlan(reason: string): Promise<void> {
    await this.tools.recordRejectedToolPlan(reason);
  }

  private async projectStatusLookup(message: string): Promise<ProjectStatusLookup> {
    const [clients, projects, opportunities, approvals] = await Promise.all([
      this.clients.list(),
      this.projects.list(),
      this.opportunities.list(),
      this.approvals.listPending(),
    ]);
    const client = clients
      .map((candidate) => ({ candidate, score: referenceScore(message, candidate.name) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)[0]?.candidate;

    const projectCandidates = projects
      .map((candidate) => {
        const clientBoost = client && candidate.client_id === client.id ? 25 : 0;
        const activeBoost = candidate.status === "cancelled" ? -20 : 5;
        return {
          candidate,
          score:
            referenceScore(message, candidate.name) +
            projectKindScore(message, candidate) +
            clientBoost +
            activeBoost,
        };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);
    const project = projectCandidates[0]?.candidate;
    const resolvedClient =
      client ?? clients.find((candidate) => candidate.id === project?.client_id);
    const clientOpportunities = opportunities
      .filter((opportunity) => opportunity.client_id === resolvedClient?.id)
      .sort((a, b) => {
        const scoreA = referenceScore(message, a.title);
        const scoreB = referenceScore(message, b.title);
        if (scoreA !== scoreB) return scoreB - scoreA;
        return b.updated.localeCompare(a.updated);
      });
    const opportunity = clientOpportunities[0];
    const targets = new Set([project?.id, opportunity?.id].filter(Boolean));
    const pendingApprovals = approvals.filter((approval) => targets.has(approval.target));
    const projectArtifacts = project
      ? await this.artifacts.list({ project_id: project.id })
      : resolvedClient
        ? await this.artifacts.list({ client_id: resolvedClient.id })
        : [];
    return {
      client: resolvedClient,
      project,
      opportunity,
      approvals: pendingApprovals,
      artifacts: projectArtifacts,
    };
  }

  private projectStatusAnswer(message: string, lookup: ProjectStatusLookup): string {
    if (!lookup.client && !lookup.project) {
      return [
        "Non trovo un lavoro salvato che corrisponda a questa richiesta.",
        "Indicami il nome esatto del cliente o del progetto e ti do lo stato operativo.",
      ].join("\n");
    }
    if (lookup.client && !lookup.project) {
      return [
        `Ho trovato il cliente ${lookup.client.name}, ma non trovo un progetto collegato che combaci con "${message}".`,
        "Dimmi quale progetto intendi e ti do stato, blocchi e prossima mossa.",
      ].join("\n");
    }

    const project = lookup.project;
    const clientName = lookup.client?.name ?? "cliente collegato";
    const opportunityLine = lookup.opportunity
      ? `Opportunità: ${lookup.opportunity.title} (${lookup.opportunity.status}).`
      : "Opportunità: non trovo ancora una scheda opportunità collegata.";
    const artifactLine =
      lookup.artifacts.length > 0
        ? `Materiali interni: ${lookup.artifacts.length} artifact/bozze salvati.`
        : "Materiali interni: non vedo ancora artifact collegati al progetto.";
    const approvalLine =
      lookup.approvals.length > 0
        ? `Blocco attuale: ${lookup.approvals.length} approvazioni pending prima di impegni esterni.`
        : "Blocco attuale: nessuna approvazione pending trovata per questo lavoro.";
    const nextMove =
      lookup.approvals.length > 0
        ? "Prossima mossa: rivedo le approvazioni e preparo scope/prezzo/client-send solo quando mi dai via libera."
        : "Prossima mossa: porto avanti il prossimo step operativo e tengo separati delivery, proposta e comunicazione cliente.";

    return [
      `Sì: per ${clientName} ho aperto ${project?.name}.`,
      `Stato progetto: ${project?.status}. ${opportunityLine}`,
      `${artifactLine} ${approvalLine}`,
      nextMove,
    ].join("\n");
  }

  private async answerProjectStatusQuestion(input: {
    message: string;
    attachments: readonly CoordinatorAttachmentInput[];
    memory: CoordinatorChatResult["memory"];
    toolPlanningProvider?: CoordinatorChatProviderMeta;
  }): Promise<CoordinatorChatResult> {
    const lookup = await this.projectStatusLookup(input.message);
    const provider = providerMeta(
      "unavailable",
      undefined,
      undefined,
      lookup.project ? "project_status_lookup" : "project_status_lookup_no_match",
    );
    const answer = this.projectStatusAnswer(input.message, lookup);
    await this.audit.append({
      actor: "supreme_coordinator",
      action: "coordinator.status_lookup",
      target: lookup.project?.id ?? lookup.client?.id ?? "unmatched_status_question",
      capability: "coordinator.memory_read",
      result: "ok",
    });
    const { ownerMessage, coordinatorMessage } = requireMessagePair(
      await this.messages.appendMany([
        {
          role: "owner",
          text: input.message,
          attachments: messageAttachments(input.attachments),
          meta: { mode: "answer" },
        },
        {
          role: "coordinator",
          text: answer,
          meta: {
            mode: "answer",
            provider,
            memory: input.memory,
            ...(input.toolPlanningProvider ? { planningProvider: input.toolPlanningProvider } : {}),
            statusLookup: {
              clientId: lookup.client?.id,
              projectId: lookup.project?.id,
              opportunityId: lookup.opportunity?.id,
              pendingApprovals: lookup.approvals.length,
              artifacts: lookup.artifacts.length,
            },
          },
        },
      ]),
    );
    return {
      mode: "answer",
      ownerMessage,
      coordinatorMessage,
      provider,
      memory: input.memory,
    };
  }

  async *stream(input: CoordinatorChatInput): AsyncGenerator<CoordinatorChatStreamEvent> {
    yield { type: "status", status: "started" };
    const message = input.message.trim();
    if (!message) throw new Error("coordinator chat requires a message");
    const attachments = input.attachments ?? [];

    if (
      isProjectStatusQuestion(message, attachments) ||
      hasCoordinatorToolIntent(message, attachments) ||
      isLowContextMessage(message, attachments)
    ) {
      const result = await this.process(input);
      for (const text of visibleDeltas(result.coordinatorMessage.text)) {
        yield { type: "delta", text };
      }
      yield { type: "final", result };
      return;
    }

    const packet = await this.memory.assemble({
      query: message,
      limit: 6,
      source: "coordinator_chat",
    });
    const recent = await this.messages.list(12);
    const memory = memoryMeta(packet);

    let answer = "";
    let provider = providerMeta("unavailable", undefined, undefined, "no_valid_provider_route");
    const selection = await this.providerSelector(this.workspaceRoot, this.config, this.env);
    if (selection) {
      try {
        yield { type: "status", status: "provider_streaming" };
        const streamed = await collectStreamText(
          selection.provider.stream({
            model: selection.model,
            system: systemPrompt(this.config),
            prompt: userPrompt(message, packet, recent),
            temperature: 0.2,
            maxTokens: 1800,
          }),
          this.providerTimeoutMs,
          `provider stream timed out after ${this.providerTimeoutMs}ms`,
        );
        const generated: GenerateTextResult = {
          text: streamed,
          model: selection.model,
        };
        answer = sanitizeCoordinatorAnswer(generated.text);
        provider = providerMeta("used", selection, generated);
      } catch (error) {
        provider = providerMeta(
          "failed",
          selection,
          undefined,
          error instanceof Error ? error.message : "provider stream failed",
        );
      }
    }
    if (!answer) answer = deterministicAnswer(message, packet, provider);

    yield { type: "status", status: "persisting" };
    const { ownerMessage, coordinatorMessage } = requireMessagePair(
      await this.messages.appendMany([
        {
          role: "owner",
          text: message,
          attachments: messageAttachments(attachments),
          meta: { mode: "answer" },
        },
        {
          role: "coordinator",
          text: answer,
          meta: { mode: "answer", provider, memory, streamed: true },
        },
      ]),
    );

    const result: CoordinatorChatResult = {
      mode: "answer",
      ownerMessage,
      coordinatorMessage,
      provider,
      memory,
    };
    for (const text of visibleDeltas(coordinatorMessage.text)) {
      yield { type: "delta", text };
    }
    yield { type: "final", result };
  }

  async process(input: CoordinatorChatInput): Promise<CoordinatorChatResult> {
    const message = input.message.trim();
    if (!message) throw new Error("coordinator chat requires a message");
    const attachments = input.attachments ?? [];

    const packet = await this.memory.assemble({
      query: message,
      limit: 6,
      source: "coordinator_chat",
    });
    const recent = await this.messages.list(12);
    const memory = memoryMeta(packet);

    let plannedIntakeProvider: CoordinatorChatProviderMeta | undefined;
    let plannedIntakePlan: CoordinatorToolPlan | undefined;
    let toolPlanningProvider: CoordinatorChatProviderMeta | undefined;
    if (isProjectStatusQuestion(message, attachments)) {
      return this.answerProjectStatusQuestion({ message, attachments, memory });
    }

    if (
      hasCoordinatorToolIntent(message, attachments) &&
      !isLowContextMessage(message, attachments)
    ) {
      const planned = await this.planToolAction(message, packet, recent);
      toolPlanningProvider = planned.provider;
      if (planned.plan?.action === "save_client" && planned.plan.clientName) {
        const result = await this.intake.saveClientOnly({
          message,
          source: input.source ?? "coordinator_chat",
          clientName: planned.plan.clientName,
          ...(planned.plan.industry ? { industry: planned.plan.industry } : {}),
          attachments,
        });
        await this.recordToolExecution({ tool: "save_client", target: result.client.id });
        const { ownerMessage, coordinatorMessage } = requireMessagePair(
          await this.messages.appendMany([
            {
              role: "owner",
              text: message,
              attachments: messageAttachments(attachments),
              meta: { mode: "client_save" },
            },
            {
              role: "coordinator",
              text: result.summary,
              meta: {
                mode: "client_save",
                provider: planned.provider,
                memory,
                tool: {
                  name: "save_client",
                  source: "provider_plan",
                  confidence: planned.plan.confidence,
                },
                client: {
                  id: result.client.id,
                  slug: result.client.slug,
                  name: result.client.name,
                  created: result.created,
                },
              },
            },
          ]),
        );
        return {
          mode: "answer",
          ownerMessage,
          coordinatorMessage,
          provider: planned.provider,
          memory,
        };
      }

      if (planned.plan?.action === "list_clients") {
        const clients = await this.clients.list();
        const answer = clientRegistryAnswer(clients);
        await this.recordToolExecution({ tool: "list_clients", target: "client_registry" });
        const { ownerMessage, coordinatorMessage } = requireMessagePair(
          await this.messages.appendMany([
            {
              role: "owner",
              text: message,
              attachments: messageAttachments(attachments),
              meta: { mode: "answer" },
            },
            {
              role: "coordinator",
              text: answer,
              meta: {
                mode: "answer",
                provider: planned.provider,
                memory,
                tool: {
                  name: "list_clients",
                  source: "provider_plan",
                  confidence: planned.plan.confidence,
                },
                clients: {
                  count: clients.length,
                  names: clients.map((client) => client.name),
                },
              },
            },
          ]),
        );
        return {
          mode: "answer",
          ownerMessage,
          coordinatorMessage,
          provider: planned.provider,
          memory,
        };
      }

      if (planned.plan?.action === "answer" && planned.plan.answer) {
        const answer = sanitizeCoordinatorAnswer(planned.plan.answer);
        const { ownerMessage, coordinatorMessage } = requireMessagePair(
          await this.messages.appendMany([
            {
              role: "owner",
              text: message,
              attachments: messageAttachments(attachments),
              meta: { mode: "answer" },
            },
            {
              role: "coordinator",
              text: answer,
              meta: { mode: "answer", provider: planned.provider, memory },
            },
          ]),
        );
        return {
          mode: "answer",
          ownerMessage,
          coordinatorMessage,
          provider: planned.provider,
          memory,
        };
      }

      if (planned.plan?.action === "create_intake") {
        plannedIntakeProvider = planned.provider;
        plannedIntakePlan = planned.plan;
      } else if (planned.provider.status === "used") {
        const answer =
          "Non ho eseguito azioni: il piano tool del Coordinator non era valido o non supportato. Posso usare solo strumenti tipizzati come save_client, create_intake e list_clients quando la richiesta e chiara.";
        await this.recordRejectedToolPlan("invalid_or_unsupported_provider_tool_plan");
        const { ownerMessage, coordinatorMessage } = requireMessagePair(
          await this.messages.appendMany([
            {
              role: "owner",
              text: message,
              attachments: messageAttachments(attachments),
              meta: { mode: "answer" },
            },
            {
              role: "coordinator",
              text: answer,
              meta: {
                mode: "answer",
                provider: planned.provider,
                memory,
                tool: {
                  status: "rejected",
                  allowed: implementedCoordinatorToolNames(),
                },
              },
            },
          ]),
        );
        return {
          mode: "answer",
          ownerMessage,
          coordinatorMessage,
          provider: planned.provider,
          memory,
        };
      }
    }

    if (isClientRegistryQuestion(message, attachments)) {
      const clients = await this.clients.list();
      const answer = clientRegistryAnswer(clients);
      const provider = providerMeta(
        "unavailable",
        undefined,
        undefined,
        "client_registry_fallback",
      );
      await this.recordToolExecution({ tool: "list_clients", target: "client_registry" });
      const { ownerMessage, coordinatorMessage } = requireMessagePair(
        await this.messages.appendMany([
          {
            role: "owner",
            text: message,
            attachments: messageAttachments(attachments),
            meta: { mode: "answer" },
          },
          {
            role: "coordinator",
            text: answer,
            meta: {
              mode: "answer",
              provider,
              memory,
              ...(toolPlanningProvider ? { planningProvider: toolPlanningProvider } : {}),
              tool: {
                name: "list_clients",
                source: "safety_fallback",
              },
              clients: {
                count: clients.length,
                names: clients.map((client) => client.name),
              },
            },
          },
        ]),
      );
      return {
        mode: "answer",
        ownerMessage,
        coordinatorMessage,
        provider,
        memory,
      };
    }

    if (isClientOnlySaveRequest({ message, attachments })) {
      const result = await this.intake.saveClientOnly({
        message,
        source: input.source ?? "coordinator_chat",
        attachments,
      });
      const provider = providerMeta(
        "unavailable",
        undefined,
        undefined,
        "client_only_save_fallback",
      );
      await this.recordToolExecution({ tool: "save_client", target: result.client.id });
      const { ownerMessage, coordinatorMessage } = requireMessagePair(
        await this.messages.appendMany([
          {
            role: "owner",
            text: message,
            attachments: messageAttachments(attachments),
            meta: { mode: "client_save" },
          },
          {
            role: "coordinator",
            text: result.summary,
            meta: {
              mode: "client_save",
              provider,
              memory,
              ...(toolPlanningProvider ? { planningProvider: toolPlanningProvider } : {}),
              tool: {
                name: "save_client",
                source: "safety_fallback",
              },
              client: {
                id: result.client.id,
                slug: result.client.slug,
                name: result.client.name,
                created: result.created,
              },
            },
          },
        ]),
      );
      return {
        mode: "answer",
        ownerMessage,
        coordinatorMessage,
        provider,
        memory,
      };
    }

    if (hasIntakeIntent(message, attachments)) {
      const provider =
        plannedIntakeProvider ?? providerMeta("unavailable", undefined, undefined, "intake_route");
      const execution = await this.tools.executeCreateIntake({
        message,
        source: input.source ?? "coordinator_chat",
        plan: plannedIntakePlan,
        toolSource: plannedIntakeProvider ? "provider_plan" : "safety_fallback",
        attachments,
      });
      const result = execution.result;
      const { ownerMessage, coordinatorMessage } = requireMessagePair(
        await this.messages.appendMany([
          {
            role: "owner",
            text: message,
            attachments: messageAttachments(attachments),
            meta: { mode: "intake" },
          },
          {
            role: "coordinator",
            text: result.summary,
            result,
            meta: {
              mode: "intake",
              memory,
              provider,
              tool: execution.tool,
            },
          },
        ]),
      );
      return {
        mode: "intake",
        ownerMessage,
        coordinatorMessage,
        result,
        provider,
        memory,
      };
    }

    let answer = "";
    let provider = providerMeta("unavailable", undefined, undefined, "no_valid_provider_route");
    if (isLowContextMessage(message, attachments)) {
      const provider = providerMeta(
        "unavailable",
        undefined,
        undefined,
        "low_context_current_message",
      );
      const answer = idleAnswer(message, provider);
      const { ownerMessage, coordinatorMessage } = requireMessagePair(
        await this.messages.appendMany([
          {
            role: "owner",
            text: message,
            attachments: messageAttachments(attachments),
            meta: { mode: "answer" },
          },
          {
            role: "coordinator",
            text: answer,
            meta: { mode: "answer", provider, memory, grounding: "low_context_current_message" },
          },
        ]),
      );
      return {
        mode: "answer",
        ownerMessage,
        coordinatorMessage,
        provider,
        memory,
      };
    }

    const selection = await this.providerSelector(this.workspaceRoot, this.config, this.env);
    if (selection) {
      try {
        const generated = await withTimeout(
          selection.provider.generateText({
            model: selection.model,
            system: systemPrompt(this.config),
            prompt: userPrompt(message, packet, recent),
            temperature: 0.2,
            maxTokens: 1800,
          }),
          this.providerTimeoutMs,
          `provider generation timed out after ${this.providerTimeoutMs}ms`,
        );
        answer = sanitizeCoordinatorAnswer(generated.text);
        provider = providerMeta("used", selection, generated);
      } catch (error) {
        provider = providerMeta(
          "failed",
          selection,
          undefined,
          error instanceof Error ? error.message : "provider generation failed",
        );
      }
    }
    if (!answer) answer = deterministicAnswer(message, packet, provider);

    const { ownerMessage, coordinatorMessage } = requireMessagePair(
      await this.messages.appendMany([
        {
          role: "owner",
          text: message,
          attachments: messageAttachments(attachments),
          meta: { mode: "answer" },
        },
        {
          role: "coordinator",
          text: answer,
          meta: { mode: "answer", provider, memory },
        },
      ]),
    );

    return {
      mode: "answer",
      ownerMessage,
      coordinatorMessage,
      provider,
      memory,
    };
  }
}
