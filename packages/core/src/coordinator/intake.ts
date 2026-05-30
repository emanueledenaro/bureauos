import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import type { BureauConfig } from "../config/schema.js";
import { defaultConfig } from "../config/loader.js";
import { newId, slugify } from "../ids.js";
import { appendDailyNote } from "../memory/daily.js";
import { appendDecision } from "../memory/decisions.js";
import { workspacePaths } from "../paths.js";
import { PolicyEngine } from "../policy/engine.js";
import { ApprovalRegistry, type ApprovalRecord } from "../registries/approval.js";
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import { OpportunityRegistry, type OpportunityRecord } from "../registries/opportunity.js";
import { ProjectRegistry, type ProjectRecord } from "../registries/project.js";
import { ensureDir } from "../registries/base.js";
import { RunEngine, type RunRecord } from "../runs/engine.js";

export interface CoordinatorAttachmentInput {
  name: string;
  type?: string;
  size?: number;
  text?: string;
  dataUrl?: string;
}

export interface CoordinatorIntakeInput {
  message: string;
  source?: string;
  clientName?: string;
  industry?: string;
  projectName?: string;
  expectedValue?: number;
  expectedMargin?: number;
  attachments?: CoordinatorAttachmentInput[];
}

export interface IntakeClassification {
  client_name: string;
  industry: string;
  project_kind: string;
  project_name: string;
  stack: string;
  opportunity_title: string;
  risk_level: "low" | "medium" | "high";
  requested_growth: boolean;
}

export interface CoordinatorIntakeResult {
  summary: string;
  next_actions: string[];
  classification: IntakeClassification;
  client: ClientRecord;
  project: ProjectRecord;
  opportunity: OpportunityRecord;
  run: RunRecord;
  artifacts: ArtifactRecord[];
  approvals: ApprovalRecord[];
}

export interface CoordinatorClientSaveResult {
  summary: string;
  next_actions: string[];
  client: ClientRecord;
  created: boolean;
}

export interface CoordinatorIntakeDeps {
  config?: BureauConfig;
  clients?: ClientRegistry;
  projects?: ProjectRegistry;
  opportunities?: OpportunityRegistry;
  approvals?: ApprovalRegistry;
  artifacts?: ArtifactStore;
  audit?: AuditLog;
  policy?: PolicyEngine;
  runs?: RunEngine;
}

const DEFAULT_MARGIN = 35;

function includesAny(message: string, words: readonly string[]): boolean {
  const lower = message.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function titleCase(input: string): string {
  return input
    .trim()
    .split(/\s+/)
    .map((part) => {
      if (/[0-9]/.test(part) || (part === part.toUpperCase() && /[A-ZÀ-Ý]/.test(part))) {
        return part;
      }
      const [first = "", ...rest] = part;
      return `${first.toUpperCase()}${rest.join("").toLowerCase()}`;
    })
    .join(" ");
}

function cleanBusinessName(input: string): string {
  let cleaned = input
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/[,.!?;:]+$/g, "")
    .trim();

  const stopPatterns = [
    /\s+(?:lo|la|li|le)\s+(?:puoi|potresti|riesci)\b[\s\S]*$/i,
    /\s+(?:puoi|potresti|riesci)\b[\s\S]*$/i,
    /\s+(?:salvalo|salvala|salvali|salvale|salvare|registralo|registrala|registrare|memorizzalo|memorizzala|memorizzare|aggiungilo|aggiungila|aggiungere)\b[\s\S]*$/i,
    /\s+(?:come|da)\s+(?:cliente|client|lead)\b[\s\S]*$/i,
    /\s+(?:vuole|vorrebbe|vogliono|vorrebbero|serve|servono|ha|hanno|chiede|chiedono|richiede|richiedono|mi\s+ha|mi\s+hanno)\b[\s\S]*$/i,
    /\s+(?:che|e)\s+(?:vuole|vorrebbe|vogliono|vorrebbero|serve|servono|ha|hanno|chiede|chiedono|richiede|richiedono|mi\s+ha|mi\s+hanno)\b[\s\S]*$/i,
  ];
  for (const pattern of stopPatterns) {
    cleaned = cleaned.replace(pattern, "").trim();
  }

  return cleaned.replace(/[,.!?;:]+$/g, "").trim();
}

function normalizeLookupText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

async function findExistingClientMention(
  registry: ClientRegistry,
  message: string,
): Promise<ClientRecord | undefined> {
  const normalizedMessage = ` ${normalizeLookupText(message)} `;
  if (!normalizedMessage.trim()) return undefined;
  const clients = await registry.list();
  return clients
    .map((client) => ({ client, normalizedName: normalizeLookupText(client.name) }))
    .filter(({ normalizedName }) => normalizedName.length >= 3)
    .filter(({ normalizedName }) => normalizedMessage.includes(` ${normalizedName} `))
    .sort((a, b) => b.normalizedName.length - a.normalizedName.length)[0]?.client;
}

function sanitizeAttachmentName(input: string): string {
  const cleaned = input
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return cleaned || "attachment";
}

function parseDataUrl(value: string): { mimeType: string; buffer: Buffer } | undefined {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(value);
  if (!match) return undefined;
  const mimeType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? "";
  const buffer = isBase64
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  return { mimeType, buffer };
}

function attachmentSummary(attachments: readonly CoordinatorAttachmentInput[]): string {
  if (attachments.length === 0) return "- None";
  return attachments
    .map((item) => {
      const name = sanitizeAttachmentName(item.name);
      const type = item.type || "application/octet-stream";
      const size = typeof item.size === "number" ? `${item.size} bytes` : "unknown size";
      return `- ${name} (${type}, ${size})`;
    })
    .join("\n");
}

function extractNamedBusiness(message: string): string | undefined {
  const patterns = [
    /\b(?:salva|salvare|salvami|registra|registrare|aggiungi|aggiungere|memorizza|memorizzare)\s+(?:il\s+|la\s+|lo\s+|un\s+|una\s+)?(?:cliente|client|azienda|business|brand)?\s*["']?([A-Za-z0-9À-ÿ&'. -]{2,60})["']?/i,
    /\b(?:ho parlato con|parlato con|cliente incontrato)\s+(?:la\s+|il\s+|lo\s+|l')?([A-ZÀ-Ý][A-Za-z0-9À-ÿ&'. -]{2,60}?)(?=[:;,]|\s+(?:vuole|vogliono|mi|ha|hanno|chiede|chiedono)\b|$)/,
    /\b(?:cliente|client|azienda|business|brand|ristorante|pizzeria|salone|studio)\s+(?:si chiama|chiamata|chiamato|called|named)\s+["']?([A-Za-z0-9À-ÿ&'. -]{2,60})["']?/i,
    /\b(?:[Cc]liente|[Cc]lient|[Aa]zienda|[Bb]usiness|[Bb]rand)\s+(?!(?:vuole|vorrebbe|vogliono|vorrebbero|serve|servono|ha|hanno|chiede|chiedono|richiede|richiedono)\b)([A-ZÀ-Ý][A-Za-z0-9À-ÿ&'. -]{1,60}?)(?=[:;,]|\s+(?:vuole|vorrebbe|vogliono|vorrebbero|mi|ha|hanno|chiede|chiedono|richiede|richiedono|serve|servono)\b|$)/,
    /\b((?:pizzeria|ristorante|salone|studio)\s+(?!(?:vuole|vorrebbe|vogliono|vorrebbero|serve|servono|ha|hanno|chiede|chiedono|richiede|richiedono)\b)[A-Za-z0-9À-ÿ&'. -]{2,60}?)(?=[:;,]|\s+(?:vuole|vorrebbe|vogliono|vorrebbero|mi|ha|hanno|chiede|chiedono|richiede|richiedono|serve|servono)\b|$)/i,
    /\b(?:cliente|client|azienda|business|brand|ristorante|pizzeria|salone|studio)\s+["']([A-Za-z0-9À-ÿ&'. -]{2,60})["']/i,
    /\b(?:per|for)\s+["']([A-Za-z0-9À-ÿ&'. -]{2,60})["']/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(message);
    const raw = cleanBusinessName(match?.[1] ?? "");
    if (raw) return titleCase(raw);
  }
  return undefined;
}

function hasProjectScopeIntent(message: string): boolean {
  return includesAny(message, [
    "app",
    "automazione",
    "automation",
    "budget",
    "booking",
    "campagna",
    "crm",
    "deadline",
    "ecommerce",
    "e-commerce",
    "gestionale",
    "landing",
    "marketing",
    "opportunit",
    "prenot",
    "preventivo",
    "progetto",
    "proposal",
    "proposta",
    "pubblicit",
    "pubblicità",
    "scope",
    "shopify",
    "sito",
    "social",
    "software",
    "svilupp",
    "website",
  ]);
}

export function isClientOnlySaveRequest(input: {
  message: string;
  attachments?: readonly CoordinatorAttachmentInput[];
  clientName?: string;
}): boolean {
  if (input.attachments?.length) return false;
  const lower = input.message.toLowerCase();
  const clientName = input.clientName ?? extractNamedBusiness(input.message);
  if (!clientName) return false;
  if (hasProjectScopeIntent(lower)) return false;

  return includesAny(lower, [
    "abbiamo un cliente",
    "aggiungi cliente",
    "aggiungere cliente",
    "cliente si chiama",
    "crea cliente",
    "creare cliente",
    "ho un cliente",
    "memorizza cliente",
    "memorizzare cliente",
    "nuovo cliente",
    "salva ",
    "registra cliente",
    "registrare cliente",
    "salva cliente",
    "salvare cliente",
    "salvami ",
    "lo puoi salvare",
    "la puoi salvare",
  ]);
}

function classify(input: CoordinatorIntakeInput): IntakeClassification {
  const message = input.message;
  const lower = message.toLowerCase();
  const isRestaurant = includesAny(lower, ["pizzeria", "ristorante", "restaurant", "booking"]);
  const isSalon = includesAny(lower, ["parrucchiere", "parrucchieri", "salone", "beauty"]);
  const isMobile = includesAny(lower, ["app mobile", "mobile app", "ios", "android"]);
  const isEcommerce = includesAny(lower, ["ecommerce", "e-commerce", "shopify", "negozio online"]);
  const isAutomation = includesAny(lower, ["automazione", "automation", "crm", "gestionale"]);
  const requestedGrowth = includesAny(lower, [
    "ads",
    "advertising",
    "pubblicita",
    "pubblicità",
    "marketing",
    "x ",
    "linkedin",
    "social",
    "post",
  ]);

  const industry =
    input.industry ??
    (isRestaurant
      ? "food_and_beverage"
      : isSalon
        ? "beauty"
        : isEcommerce
          ? "ecommerce"
          : isAutomation
            ? "business_operations"
            : "unspecified");

  const clientName =
    input.clientName ??
    extractNamedBusiness(message) ??
    (isRestaurant
      ? "Restaurant Lead"
      : isSalon
        ? "Salon Lead"
        : isMobile
          ? "Mobile App Lead"
          : "New Client Lead");

  const projectKind = isMobile
    ? "mobile_app"
    : isEcommerce
      ? "ecommerce"
      : isAutomation
        ? "business_automation"
        : isRestaurant && includesAny(lower, ["prenot", "booking", "reservation"])
          ? "booking_website"
          : includesAny(lower, ["sito", "website", "landing"])
            ? "website"
            : "software_project";

  const projectLabel =
    projectKind === "mobile_app"
      ? "Mobile App"
      : projectKind === "booking_website"
        ? "Booking Website"
        : projectKind === "ecommerce"
          ? "E-commerce"
          : projectKind === "business_automation"
            ? "Business Automation"
            : projectKind === "website"
              ? "Website"
              : "Software Project";

  const projectName = input.projectName ?? `${clientName} ${projectLabel}`;
  const stack =
    projectKind === "mobile_app"
      ? "mobile, api, analytics"
      : projectKind === "booking_website"
        ? "web, reservations, local seo, analytics"
        : projectKind === "ecommerce"
          ? "commerce, payments, analytics"
          : projectKind === "business_automation"
            ? "workflow automation, integrations, dashboard"
            : "web, api, analytics";

  const opportunityTitle = `${projectLabel} for ${clientName}`;
  const riskLevel = includesAny(lower, ["pagamento", "payment", "privacy", "dati", "legal"])
    ? "high"
    : requestedGrowth
      ? "medium"
      : "low";

  return {
    client_name: clientName,
    industry,
    project_kind: projectKind,
    project_name: projectName,
    stack,
    opportunity_title: opportunityTitle,
    risk_level: riskLevel,
    requested_growth: requestedGrowth,
  };
}

async function appendMemory(path: string, heading: string, content: string): Promise<void> {
  await appendFile(path, `\n\n## ${heading}\n\n${content.trim()}\n`, "utf8");
}

async function getOrCreateClient(
  registry: ClientRegistry,
  input: CoordinatorIntakeInput,
  classification: IntakeClassification,
): Promise<ClientRecord> {
  const slug = slugify(classification.client_name);
  const existing = await registry.get(slug);
  if (existing) {
    return registry.update(slug, {
      status: existing.status === "churned" ? "lead" : existing.status,
      industry: existing.industry === "unspecified" ? classification.industry : existing.industry,
    });
  }
  return registry.create({
    name: classification.client_name,
    industry: classification.industry,
    status: "lead",
    notes: `Initial owner intake:\n\n${input.message}`,
  });
}

async function getOrCreateProject(
  registry: ProjectRegistry,
  client: ClientRecord,
  input: CoordinatorIntakeInput,
  classification: IntakeClassification,
): Promise<ProjectRecord> {
  const slug = slugify(classification.project_name);
  const existing = await registry.get(slug);
  if (existing) return existing;
  return registry.create({
    name: classification.project_name,
    clientId: client.id,
    status: "intake",
    stack: classification.stack,
    notes: `Created by Supreme Coordinator intake.\n\nOwner message:\n\n${input.message}`,
  });
}

function artifactBodies(args: {
  input: CoordinatorIntakeInput;
  classification: IntakeClassification;
  client: ClientRecord;
  project: ProjectRecord;
  opportunity: OpportunityRecord;
}): Array<{ type: ArtifactRecord["type"]; body: string }> {
  const { input, classification, client, project, opportunity } = args;
  return [
    {
      type: "client-project-intake",
      body: `# Client Project Intake

## Owner Message

${input.message}

## Owner Attachments

${attachmentSummary(input.attachments ?? [])}

## Classification

- Client: ${client.name}
- Industry: ${classification.industry}
- Project kind: ${classification.project_kind}
- Risk level: ${classification.risk_level}
- Opportunity: ${opportunity.id}
- Project: ${project.id}

## Coordinator Decision

Create a dedicated project workspace, keep all client memory scoped, and prepare proposal assets in draft mode.
`,
    },
    {
      type: "project-brief",
      body: `# Project Brief

## Objective

Deliver ${classification.project_name} for ${client.name}.

## Initial Scope

- Convert the owner's raw client conversation into a scoped software project.
- Define product requirements and acceptance criteria.
- Prepare repository provisioning and delivery plan.
- Keep public, pricing, legal, and client commitments approval-gated.

## Recommended Team

- Project Manager
- Product Agent
- UX/UI Agent
- Development Agent
- QA Agent
- Security Agent
- Reviewer Agent
- Release Agent
`,
    },
    {
      type: "proposal-brief",
      body: `# Proposal Brief

## Offer

${classification.project_name}

## Client Outcome

The client should receive a clear solution, delivery plan, acceptance criteria, and launch path.

## Draft Positioning

This proposal is not approved for client delivery yet. It must pass owner approval for final scope, final price, and client send.

## Open Questions

- Confirm decision maker.
- Confirm budget range.
- Confirm required launch date.
- Confirm assets, integrations, privacy constraints, and brand permissions.
`,
    },
    {
      type: "pricing-brief",
      body: `# Pricing Brief

## Status

Draft only. The coordinator must not commit to final price.

## Inputs

- Expected value: ${opportunity.expected_value || "unknown"}
- Expected margin: ${opportunity.expected_margin || DEFAULT_MARGIN}%
- Risk level: ${classification.risk_level}

## Approval Gate

Final price requires owner approval before any client-facing message.
`,
    },
    {
      type: "repository-provisioning-plan",
      body: `# Repository Provisioning Plan

## Repository

No repository has been created yet.

## Recommended Steps

1. Confirm project name and technical stack.
2. Create GitHub repository.
3. Add BureauOS issue labels.
4. Create initial feature issues from the product brief.
5. Connect the project memory path to the repository.

## Approval Boundary

Repository creation is allowed only when the owner or project policy enables it.
`,
    },
    {
      type: "compliance-review",
      body: `# Compliance Review

## Risk Level

${classification.risk_level}

## Approval Required Before

- Sending proposal to client
- Committing final scope
- Committing final price
- Publishing public content about the client
- Using client logo, screenshots, testimonial, or case study
- Launching ads or changing ad budget

## Safe Autonomous Work

Drafting, internal planning, project memory updates, issue preparation, proposal drafts, and content drafts are allowed.
`,
    },
    {
      type: "client-account-plan",
      body: `# Client Account Plan

## Client

${client.name}

## Current Value

Initial opportunity: ${opportunity.title}

## Relationship Strategy

- Keep all follow-ups approval-gated until a communication policy exists.
- Track revenue, margin, risk, relationship health, and upsell potential.
- Ask for case-study permission only after delivery success.

## Next Follow-Up

Prepare discovery questions and proposal draft for owner review.
`,
    },
    {
      type: "social-post-brief",
      body: `# Social Post Brief

## Status

Draft only. Do not publish.

## Angle

Build-in-public update about turning real client conversations into structured delivery systems, without naming the client or exposing private details.

## Compliance Boundary

No client name, logo, screenshots, revenue claim, or result claim may be published without explicit permission.
`,
    },
    {
      type: "ad-campaign-brief",
      body: `# Ad Campaign Brief

## Status

Draft only. Do not launch.

## Campaign Objective

Generate similar qualified leads for software projects once the owner approves offer, budget, and channel.

## Approval Gates

- Owner approval for campaign launch
- Owner approval for budget
- Compliance approval for public claims
`,
    },
  ];
}

export class CoordinatorIntakeService {
  private readonly config: BureauConfig;
  private readonly clients: ClientRegistry;
  private readonly projects: ProjectRegistry;
  private readonly opportunities: OpportunityRegistry;
  private readonly approvals: ApprovalRegistry;
  private readonly artifacts: ArtifactStore;
  private readonly audit: AuditLog;
  private readonly policy: PolicyEngine;
  private readonly runs: RunEngine;

  constructor(
    private readonly workspaceRoot: string,
    deps: CoordinatorIntakeDeps = {},
  ) {
    this.config = deps.config ?? defaultConfig("freelancer");
    this.clients = deps.clients ?? new ClientRegistry(workspaceRoot);
    this.projects = deps.projects ?? new ProjectRegistry(workspaceRoot);
    this.opportunities = deps.opportunities ?? new OpportunityRegistry(workspaceRoot);
    this.approvals = deps.approvals ?? new ApprovalRegistry(workspaceRoot);
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
    this.policy = deps.policy ?? new PolicyEngine(this.config, this.approvals);
    this.runs =
      deps.runs ??
      new RunEngine(workspaceRoot, {
        audit: this.audit,
        artifacts: this.artifacts,
        policy: this.policy,
        recordDecisions: this.config.memory.write_decision_records,
      });
  }

  async process(input: CoordinatorIntakeInput): Promise<CoordinatorIntakeResult> {
    const message = input.message.trim();
    if (!message) throw new Error("coordinator intake requires a message");
    const attachments = input.attachments ?? [];

    const existingClient = await findExistingClientMention(this.clients, message);
    const classification = classify({
      ...input,
      message,
      ...(existingClient ? { clientName: existingClient.name } : {}),
    });
    const clientBeforeIntake =
      existingClient ?? (await this.clients.get(slugify(classification.client_name)));
    const client = await getOrCreateClient(this.clients, { ...input, message }, classification);
    const project = await getOrCreateProject(
      this.projects,
      client,
      { ...input, message },
      classification,
    );
    const opportunity = await this.opportunities.create({
      title: classification.opportunity_title,
      source: input.source ?? "owner_intake",
      clientId: client.id,
      expectedValue: input.expectedValue,
      expectedMargin: input.expectedMargin ?? DEFAULT_MARGIN,
      notes: message,
    });

    const run = await this.runs.start({
      type: "intake",
      triggerType: "owner_request",
      triggerSource: input.source ?? "supreme_coordinator",
      scope: message,
      clientId: client.id,
      projectId: project.id,
      createdBy: "supreme_coordinator",
    });

    const artifacts: ArtifactRecord[] = [];
    for (const attachment of attachments) {
      artifacts.push(
        await this.persistAttachment(attachment, {
          runId: run.id,
          clientId: client.id,
          projectId: project.id,
        }),
      );
    }
    for (const item of artifactBodies({
      input: { ...input, message, attachments },
      classification,
      client,
      project,
      opportunity,
    })) {
      artifacts.push(
        await this.artifacts.write({
          type: item.type,
          createdBy: "supreme_coordinator",
          runId: run.id,
          clientId: client.id,
          projectId: project.id,
          body: item.body,
        }),
      );
    }

    const updatedRun = await this.runs.attachArtifacts(
      run.id,
      artifacts.map((artifact) => artifact.id),
    );

    const approvals: ApprovalRecord[] = [];

    const paths = workspacePaths(this.workspaceRoot);
    const now = new Date().toISOString();
    await appendMemory(
      join(paths.clientsDir, client.slug, "COMMUNICATION.md"),
      `Owner intake ${now}`,
      `${message}\n\nAttachments:\n${attachmentSummary(attachments)}`,
    );
    await appendMemory(
      join(paths.clientsDir, client.slug, "OPPORTUNITIES.md"),
      `Opportunity ${opportunity.id}`,
      `${opportunity.title}\n\nProject: ${project.id}\nRun: ${run.id}`,
    );
    await appendMemory(
      join(paths.projectsDir, project.slug, "BACKLOG.md"),
      `Initial backlog from ${run.id}`,
      [
        "- Confirm discovery questions.",
        "- Draft product requirements.",
        "- Draft UX flow.",
        "- Prepare repository provisioning.",
        "- Prepare proposal and pricing for owner approval.",
      ].join("\n"),
    );
    if (attachments.length) {
      await appendMemory(
        join(paths.projectsDir, project.slug, "ASSETS.md"),
        `Owner attachments from ${run.id}`,
        attachmentSummary(attachments),
      );
    }

    await appendDailyNote(
      this.workspaceRoot,
      "Events",
      `Coordinator intake opened ${project.name} for ${client.name} and ${opportunity.title}.`,
    );
    await appendDecision(this.workspaceRoot, {
      actor: "supreme_coordinator",
      what: `Opened project team for ${project.name}`,
      why: "Owner intake described a client opportunity that should move into structured delivery.",
      runId: run.id,
      affects: [client.id, project.id, opportunity.id],
    });

    await this.audit.append({
      actor: "supreme_coordinator",
      action: "coordinator.intake.completed",
      target: opportunity.id,
      result: "ok",
    });

    return {
      summary: `${
        clientBeforeIntake ? "Ho preso in carico" : "Ho aperto il lavoro per"
      } ${client.name}: progetto ${project.name}, opportunità ${opportunity.title}, ${artifacts.length} artifact interni pronti.`,
      next_actions: [
        "Avvio la delivery interna con project manager e agenti specialisti.",
        "Uso proposta, pricing e contenuti come bozze operative finché non serve un invio esterno.",
        "Ti porto in approvazione solo soldi, cancellazioni, legale, produzione, segreti o impegni finali verso cliente/pubblico.",
        "Tengo stato, artifact e decisioni tracciati nel kernel.",
      ],
      classification,
      client,
      project,
      opportunity,
      run: updatedRun,
      artifacts,
      approvals,
    };
  }

  async saveClientOnly(input: CoordinatorIntakeInput): Promise<CoordinatorClientSaveResult> {
    const message = input.message.trim();
    if (!message) throw new Error("coordinator client save requires a message");
    const clientName = input.clientName ?? extractNamedBusiness(message);
    if (!clientName) throw new Error("client-only save requires a client name");

    const classification = classify({ ...input, message, clientName });
    const existed = Boolean(await this.clients.get(slugify(classification.client_name)));
    const client = await getOrCreateClient(this.clients, { ...input, message }, classification);

    const paths = workspacePaths(this.workspaceRoot);
    const now = new Date().toISOString();
    await appendMemory(
      join(paths.clientsDir, client.slug, "COMMUNICATION.md"),
      `Client saved ${now}`,
      `${message}\n\nCoordinator action: saved client identity only. No project, opportunity, artifact, or approval was created from this request.`,
    );
    await appendDailyNote(
      this.workspaceRoot,
      "Events",
      `Coordinator saved client ${client.name} without creating project scope.`,
    );
    await this.audit.append({
      actor: "supreme_coordinator",
      action: existed ? "coordinator.client_updated" : "coordinator.client_saved",
      target: client.id,
      result: "ok",
    });

    const summary = existed
      ? `Cliente ${client.name} già presente. Anagrafica aggiornata.`
      : `Ho salvato il cliente ${client.name}.`;

    return {
      summary,
      next_actions: [
        "Quando mi dai uno scope operativo, apro progetto/opportunità e preparo i materiali interni.",
        "Tengo l'anagrafica separata dalla delivery finché non c'è una richiesta concreta.",
      ],
      client,
      created: !existed,
    };
  }

  private async persistAttachment(
    attachment: CoordinatorAttachmentInput,
    context: { runId: string; clientId: string; projectId: string },
  ): Promise<ArtifactRecord> {
    const safeName = sanitizeAttachmentName(attachment.name);
    const attachmentId = newId("att");
    const paths = workspacePaths(this.workspaceRoot);
    const storageDir = join(paths.artifactsDir, "attachments", context.runId);
    const storagePath = join(storageDir, `${attachmentId}-${safeName}`);
    const relativeStoragePath = `.bureauos/memory/artifacts/attachments/${context.runId}/${attachmentId}-${safeName}`;
    const type = attachment.type || "application/octet-stream";

    await ensureDir(storageDir);

    let bytes = 0;
    let source = "metadata_only";
    if (typeof attachment.text === "string") {
      const buffer = Buffer.from(attachment.text, "utf8");
      bytes = buffer.byteLength;
      source = "text";
      await writeFile(storagePath, buffer);
    } else if (attachment.dataUrl) {
      const parsed = parseDataUrl(attachment.dataUrl);
      if (parsed) {
        bytes = parsed.buffer.byteLength;
        source = "data_url";
        await writeFile(storagePath, parsed.buffer);
      }
    }

    const declaredBytes = typeof attachment.size === "number" ? attachment.size : bytes;
    const body = `# Owner Attachment

## File

- Name: ${safeName}
- Type: ${type}
- Declared size: ${declaredBytes} bytes
- Stored bytes: ${bytes}
- Storage path: ${relativeStoragePath}
- Source: ${source}

## Coordinator Usage

Treat this file as owner-provided client/project context. It can inform product scope, design direction, compliance review, pricing, proposal drafts, and delivery planning. External use still requires owner approval when policy classifies the action as serious risk.
`;

    return this.artifacts.write({
      type: "owner-attachment",
      createdBy: "owner",
      runId: context.runId,
      clientId: context.clientId,
      projectId: context.projectId,
      status: "submitted",
      metadata: {
        attachment_name: safeName,
        attachment_type: type,
        attachment_size: declaredBytes,
        storage_path: relativeStoragePath,
      },
      body,
    });
  }
}
