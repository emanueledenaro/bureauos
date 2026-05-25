import type { ContextPacket } from "@bureauos/memory";
import {
  buildConfiguredProviderRouter,
  type GenerateTextResult,
  type ProviderAdapter,
} from "@bureauos/providers";
import { configureAgentProviderRouting, selectAgentModel } from "../agents/provider-routing.js";
import type { BureauConfig } from "../config/schema.js";
import { defaultConfig } from "../config/loader.js";
import { CoordinatorGlobalMemoryService } from "../memory/global.js";
import {
  CoordinatorIntakeService,
  type CoordinatorAttachmentInput,
  type CoordinatorIntakeResult,
} from "./intake.js";
import {
  CoordinatorMessageStore,
  type CoordinatorMessageAttachment,
  type CoordinatorMessageRecord,
} from "./messages.js";

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

export interface CoordinatorChatDeps {
  config?: BureauConfig;
  messages?: CoordinatorMessageStore;
  intake?: CoordinatorIntakeService;
  memory?: CoordinatorGlobalMemoryService;
  env?: NodeJS.ProcessEnv;
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
    "Always-loaded ROOT memory:",
    compactRoot(packet.rootMemory || "(empty)"),
    "",
    "Focused memory hits:",
    hits,
    "",
    "Recent coordinator thread:",
    thread || "(empty)",
  ].join("\n");
}

function systemPrompt(config: BureauConfig): string {
  return [
    `You are the Supreme Coordinator of ${config.organization.name}.`,
    "You are the only owner-facing agent in BureauOS.",
    "Answer in Italian unless the owner clearly uses another language.",
    "Use the provided memory context. If memory is insufficient, say what is missing and what you can infer.",
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
    memoryPrompt(packet, recent),
    "",
    "Owner message:",
    message,
    "",
    "Respond as the Supreme Coordinator.",
  ].join("\n");
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
    "Memoria rilevante:",
    evidence,
    "",
    "Prossimo passo interno: se questa e una nuova opportunita cliente, descrivimi cliente, obiettivo, budget indicativo, deadline e asset disponibili; altrimenti posso continuare a interrogare la memoria aziendale senza creare nuovi record operativi.",
  ].join("\n");
}

async function selectCoordinatorProvider(
  workspaceRoot: string,
  config: BureauConfig,
  env: NodeJS.ProcessEnv,
): Promise<
  | {
      provider: ProviderAdapter;
      model: string;
    }
  | undefined
> {
  const { router } = await buildConfiguredProviderRouter(workspaceRoot, env, config);
  configureAgentProviderRouting(router, config, ["supreme_coordinator"]);
  const selection = await selectAgentModel(router, config, "supreme_coordinator");
  if (!selection) return undefined;
  return {
    provider: selection.provider,
    model: selection.model,
  };
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
  private readonly memory: CoordinatorGlobalMemoryService;
  private readonly env: NodeJS.ProcessEnv;

  constructor(
    private readonly workspaceRoot: string,
    deps: CoordinatorChatDeps = {},
  ) {
    this.config = deps.config ?? defaultConfig("freelancer");
    this.messages = deps.messages ?? new CoordinatorMessageStore(workspaceRoot);
    this.intake =
      deps.intake ?? new CoordinatorIntakeService(workspaceRoot, { config: this.config });
    this.memory = deps.memory ?? new CoordinatorGlobalMemoryService(workspaceRoot);
    this.env = deps.env ?? process.env;
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

    if (hasIntakeIntent(message, attachments)) {
      const result = await this.intake.process({
        message,
        source: input.source ?? "coordinator_chat",
        attachments,
      });
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
            meta: { mode: "intake", memory },
          },
        ]),
      );
      return {
        mode: "intake",
        ownerMessage,
        coordinatorMessage,
        result,
        provider: providerMeta("unavailable", undefined, undefined, "intake_route"),
        memory,
      };
    }

    let answer = "";
    let provider = providerMeta("unavailable", undefined, undefined, "no_valid_provider_route");
    const selection = await selectCoordinatorProvider(this.workspaceRoot, this.config, this.env);
    if (selection) {
      try {
        const generated = await selection.provider.generateText({
          model: selection.model,
          system: systemPrompt(this.config),
          prompt: userPrompt(message, packet, recent),
          temperature: 0.2,
          maxTokens: 1800,
        });
        answer = generated.text;
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
