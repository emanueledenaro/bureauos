import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import type { BureauConfig } from "../config/schema.js";
import { defaultConfig } from "../config/loader.js";
import { slugify } from "../ids.js";
import { appendDailyNote } from "../memory/daily.js";
import { appendDecision } from "../memory/decisions.js";
import { workspacePaths } from "../paths.js";
import { PolicyEngine } from "../policy/engine.js";
import { ApprovalRegistry, type ApprovalRecord } from "../registries/approval.js";
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import { OpportunityRegistry, type OpportunityRecord } from "../registries/opportunity.js";
import { ProjectRegistry, type ProjectRecord } from "../registries/project.js";
import { RunEngine, type RunRecord } from "../runs/engine.js";

export interface CoordinatorIntakeInput {
  message: string;
  source?: string;
  clientName?: string;
  industry?: string;
  projectName?: string;
  expectedValue?: number;
  expectedMargin?: number;
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
      const [first = "", ...rest] = part;
      return `${first.toUpperCase()}${rest.join("").toLowerCase()}`;
    })
    .join(" ");
}

function extractNamedBusiness(message: string): string | undefined {
  const patterns = [
    /\b(?:cliente|client|azienda|business|brand|ristorante|pizzeria|salone|studio)\s+(?:si chiama|chiamata|chiamato|called|named)\s+["']?([A-Za-z0-9À-ÿ&'. -]{2,60})["']?/i,
    /\b(?:cliente|client|azienda|business|brand|ristorante|pizzeria|salone|studio)\s+["']([A-Za-z0-9À-ÿ&'. -]{2,60})["']/i,
    /\b(?:per|for)\s+["']([A-Za-z0-9À-ÿ&'. -]{2,60})["']/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(message);
    const raw = match?.[1]?.replace(/[,.!?;:]+$/g, "").trim();
    if (raw) return titleCase(raw);
  }
  return undefined;
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

function approvalRequests(args: {
  classification: IntakeClassification;
  project: ProjectRecord;
  opportunity: OpportunityRecord;
}): Array<{ action: string; target: string; scope: string; body: string }> {
  const { classification, project, opportunity } = args;
  return [
    {
      action: "send_final_proposals",
      target: opportunity.id,
      scope: `Send final proposal for ${opportunity.title}`,
      body: "The coordinator can draft the proposal, but final send requires owner approval.",
    },
    {
      action: "accept_projects",
      target: project.id,
      scope: `Accept client scope for ${project.name}`,
      body: "Project acceptance commits delivery capacity and must be approved by the owner.",
    },
    {
      action: "publish_public_content",
      target: project.id,
      scope: `Publish public content about ${project.name}`,
      body: "Publishing public proof requires client permission and owner approval.",
    },
    ...(classification.requested_growth
      ? [
          {
            action: "launch_ad_campaigns",
            target: project.id,
            scope: `Launch ads for ${project.name}`,
            body: "Paid advertising requires owner approval for campaign, claims, and budget.",
          },
        ]
      : []),
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
      });
  }

  async process(input: CoordinatorIntakeInput): Promise<CoordinatorIntakeResult> {
    const message = input.message.trim();
    if (!message) throw new Error("coordinator intake requires a message");

    const classification = classify({ ...input, message });
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
    for (const item of artifactBodies({
      input: { ...input, message },
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
    for (const request of approvalRequests({ classification, project, opportunity })) {
      approvals.push(
        await this.approvals.request({
          action: request.action,
          actor: "supreme_coordinator",
          target: request.target,
          scope: request.scope,
          oneOff: true,
          body: request.body,
        }),
      );
    }

    const paths = workspacePaths(this.workspaceRoot);
    const now = new Date().toISOString();
    await appendMemory(
      join(paths.clientsDir, client.slug, "COMMUNICATION.md"),
      `Owner intake ${now}`,
      message,
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

    await appendDailyNote(
      this.workspaceRoot,
      "Events",
      `Coordinator intake created ${client.name}, ${project.name}, and ${opportunity.title}.`,
    );
    await appendDecision(this.workspaceRoot, {
      actor: "supreme_coordinator",
      what: `Created project team for ${project.name}`,
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
      summary: `Created client ${client.name}, project ${project.name}, opportunity ${opportunity.title}, ${artifacts.length} artifacts, and ${approvals.length} approval gates.`,
      next_actions: [
        "Review pending approvals before any external commitment.",
        "Use generated proposal and pricing briefs as draft-only assets.",
        "Provision the repository only after owner approval or project policy.",
        "Continue delivery through project manager and specialist agents.",
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
}
