import { join } from "node:path";
import { ApprovalRegistry, type ApprovalRecord } from "../registries/approval.js";
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import { OpportunityRegistry } from "../registries/opportunity.js";
import { ProjectRegistry } from "../registries/project.js";

export type ClientAccountRisk = "blocked" | "follow_up_due" | "proposal" | "active" | "cold";
export type ClientRevenueTier = "high" | "medium" | "low" | "unknown";
export type ClientStrategicValue = "high" | "medium" | "low";
export type ClientRelationshipHealth = "strong" | "neutral" | "at_risk";
export type ClientPaymentReliability = "good" | "unknown" | "risky";
export type ClientProofPermission = "yes" | "no" | "partial" | "unknown";

export interface ClientValueScore {
  score: number;
  factors: string[];
}

export interface ClientClassification {
  revenue_tier: ClientRevenueTier;
  strategic_value: ClientStrategicValue;
  relationship_health: ClientRelationshipHealth;
  payment_reliability: ClientPaymentReliability;
  upsell_potential: ClientStrategicValue;
  referral_potential: ClientStrategicValue;
  public_proof_allowed: ClientProofPermission;
}

export interface ClientProjectSnapshot {
  id: string;
  slug: string;
  name: string;
  status: string;
  repository: string;
  stack: string;
  updated?: string;
}

export interface ClientOpportunitySnapshot {
  id: string;
  title: string;
  status: string;
  expected_value: number;
  expected_margin: number;
  next_action: string;
  updated?: string;
}

export interface ClientIntelligenceItem {
  client: ClientRecord;
  revenue: {
    pipeline_value: number;
    won_value: number;
    lost_value: number;
    average_expected_margin: number;
    open_opportunities: number;
    won_opportunities: number;
    stalled_opportunities: number;
  };
  delivery: {
    projects_total: number;
    active_projects: number;
    blocked_projects: number;
    delivered_projects: number;
    repositories_linked: number;
    pending_approvals: number;
  };
  relationship: {
    last_client_message_at: string;
    last_owner_response_at: string;
    next_follow_up_at: string;
    follow_up_due: boolean;
  };
  value_score: ClientValueScore;
  classification: ClientClassification;
  risk: ClientAccountRisk;
  next_action: string;
  latest_activity_at: string;
  memory_paths: {
    profile: string;
    projects: string;
    revenue: string;
    relationship: string;
    opportunities: string;
    risks: string;
  };
  projects: ClientProjectSnapshot[];
  opportunities: ClientOpportunitySnapshot[];
}

export interface ClientIntelligenceSummary {
  generated_at: string;
  totals: {
    clients: number;
    pipeline_value: number;
    won_value: number;
    active_projects: number;
    blocked_projects: number;
    follow_ups_due: number;
  };
  clients: ClientIntelligenceItem[];
}

export interface ClientIntelligenceDeps {
  clients?: ClientRegistry;
  projects?: ProjectRegistry;
  opportunities?: OpportunityRegistry;
  approvals?: ApprovalRegistry;
}

const ACTIVE_PROJECT_STATUSES = new Set(["proposal", "approved", "in_progress"]);
const OPEN_OPPORTUNITY_STATUSES = new Set([
  "intake",
  "qualified",
  "proposal_draft",
  "proposal_sent",
  "stalled",
]);

function relativeClientPath(slug: string, file: string): string {
  return join("clients", slug, file).replace(/\\/g, "/");
}

function maxIso(values: Array<string | undefined>): string {
  return (
    values
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => right.localeCompare(left))[0] ?? ""
  );
}

function isDue(iso: string, now: Date): boolean {
  if (!iso) return false;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) && value <= now.getTime();
}

function byNewest<T extends { updated?: string; created?: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => {
    const l = left.updated || left.created || "";
    const r = right.updated || right.created || "";
    return r.localeCompare(l);
  });
}

function approvalMatchesClient(approval: ApprovalRecord, client: ClientRecord): boolean {
  const haystack = `${approval.target} ${approval.scope}`.toLowerCase();
  return haystack.includes(client.id.toLowerCase()) || haystack.includes(client.name.toLowerCase());
}

function riskForClient(args: {
  blockedProjects: number;
  followUpDue: boolean;
  proposalOpportunities: number;
  activeProjects: number;
  openOpportunities: number;
}): ClientAccountRisk {
  if (args.blockedProjects > 0) return "blocked";
  if (args.followUpDue) return "follow_up_due";
  if (args.proposalOpportunities > 0) return "proposal";
  if (args.activeProjects > 0 || args.openOpportunities > 0) return "active";
  return "cold";
}

function nextActionForClient(args: {
  risk: ClientAccountRisk;
  openOpportunities: number;
  activeProjects: number;
}): string {
  switch (args.risk) {
    case "blocked":
      return "Review blocked delivery before assigning more autonomous work.";
    case "follow_up_due":
      return "Follow up with the client and refresh relationship memory.";
    case "proposal":
      return "Finalize proposal, pricing, and owner approval before sending.";
    case "active":
      if (args.openOpportunities > 0)
        return "Qualify the strongest opportunity and prepare next proposal step.";
      if (args.activeProjects > 0) return "Keep delivery cadence and monitor project signals.";
      return "Continue account monitoring.";
    case "cold":
      return "Schedule account review or identify a new expansion opportunity.";
  }
}

function classifyRevenue(wonValue: number, pipelineValue: number): ClientRevenueTier {
  const commercialValue = Math.max(wonValue, pipelineValue);
  if (commercialValue <= 0) return "unknown";
  if (commercialValue >= 10_000) return "high";
  if (commercialValue >= 3_000) return "medium";
  return "low";
}

function valueScore(args: {
  pipelineValue: number;
  wonValue: number;
  averageMargin: number;
  activeProjects: number;
  deliveredProjects: number;
  blockedProjects: number;
  stalledOpportunities: number;
  followUpDue: boolean;
  repositoriesLinked: number;
}): ClientValueScore {
  const factors: string[] = [];
  let score = 0;

  if (args.wonValue > 0) {
    const points = Math.min(30, args.wonValue / 300);
    score += points;
    factors.push(`won revenue ${Math.round(points)}/30`);
  }
  if (args.pipelineValue > 0) {
    const points = Math.min(25, args.pipelineValue / 400);
    score += points;
    factors.push(`open pipeline ${Math.round(points)}/25`);
  }
  if (args.averageMargin > 0) {
    const points = Math.min(15, args.averageMargin * 0.15);
    score += points;
    factors.push(`expected margin ${Math.round(points)}/15`);
  }
  if (args.activeProjects > 0) {
    const points = Math.min(10, args.activeProjects * 5);
    score += points;
    factors.push(`active delivery ${Math.round(points)}/10`);
  }
  if (args.deliveredProjects > 0) {
    const points = Math.min(10, args.deliveredProjects * 5);
    score += points;
    factors.push(`delivered proof ${Math.round(points)}/10`);
  }
  if (args.repositoriesLinked > 0) {
    score += 5;
    factors.push("repository linked 5/5");
  }
  if (args.blockedProjects > 0) {
    const penalty = Math.min(20, args.blockedProjects * 10);
    score -= penalty;
    factors.push(`blocked delivery -${penalty}`);
  }
  if (args.stalledOpportunities > 0) {
    const penalty = Math.min(10, args.stalledOpportunities * 5);
    score -= penalty;
    factors.push(`stalled opportunity -${penalty}`);
  }
  if (args.followUpDue) {
    score -= 8;
    factors.push("follow-up overdue -8");
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    factors,
  };
}

function relationshipHealth(args: {
  blockedProjects: number;
  followUpDue: boolean;
  stalledOpportunities: number;
  deliveredProjects: number;
}): ClientRelationshipHealth {
  if (args.blockedProjects > 0 || args.followUpDue || args.stalledOpportunities > 0) {
    return "at_risk";
  }
  if (args.deliveredProjects > 0) return "strong";
  return "neutral";
}

function levelFromScore(score: number): ClientStrategicValue {
  if (score >= 70) return "high";
  if (score >= 35) return "medium";
  return "low";
}

function classifyClient(args: {
  pipelineValue: number;
  wonValue: number;
  lostValue: number;
  score: number;
  activeProjects: number;
  deliveredProjects: number;
  blockedProjects: number;
  openOpportunities: number;
  stalledOpportunities: number;
  followUpDue: boolean;
}): ClientClassification {
  const relationship = relationshipHealth({
    blockedProjects: args.blockedProjects,
    followUpDue: args.followUpDue,
    stalledOpportunities: args.stalledOpportunities,
    deliveredProjects: args.deliveredProjects,
  });
  const revenueTier = classifyRevenue(args.wonValue, args.pipelineValue);
  const commercialValue = args.wonValue + args.pipelineValue;
  const strategicValue =
    commercialValue >= 10_000 || args.score >= 70
      ? "high"
      : commercialValue >= 3_000 || args.activeProjects > 0 || args.openOpportunities > 0
        ? "medium"
        : "low";
  const paymentReliability =
    args.wonValue > 0 && args.lostValue === 0
      ? "good"
      : args.stalledOpportunities > 0 && args.wonValue === 0
        ? "risky"
        : "unknown";

  return {
    revenue_tier: revenueTier,
    strategic_value: strategicValue,
    relationship_health: relationship,
    payment_reliability: paymentReliability,
    upsell_potential:
      args.openOpportunities > 0 && args.deliveredProjects > 0
        ? "high"
        : args.openOpportunities > 0 || args.activeProjects > 0
          ? "medium"
          : levelFromScore(args.score),
    referral_potential:
      args.deliveredProjects > 0 && relationship !== "at_risk"
        ? "high"
        : args.wonValue > 0
          ? "medium"
          : "low",
    public_proof_allowed: "unknown",
  };
}

export class ClientIntelligenceService {
  private readonly clients: ClientRegistry;
  private readonly projects: ProjectRegistry;
  private readonly opportunities: OpportunityRegistry;
  private readonly approvals: ApprovalRegistry;

  constructor(
    public readonly workspaceRoot: string,
    deps: ClientIntelligenceDeps = {},
  ) {
    this.clients = deps.clients ?? new ClientRegistry(workspaceRoot);
    this.projects = deps.projects ?? new ProjectRegistry(workspaceRoot);
    this.opportunities = deps.opportunities ?? new OpportunityRegistry(workspaceRoot);
    this.approvals = deps.approvals ?? new ApprovalRegistry(workspaceRoot);
  }

  async summarize(now = new Date()): Promise<ClientIntelligenceSummary> {
    const [clients, projects, opportunities, pendingApprovals] = await Promise.all([
      this.clients.list(),
      this.projects.list(),
      this.opportunities.list(),
      this.approvals.listPending(),
    ]);

    const items = clients.map((client) => {
      const clientProjects = projects.filter((project) => project.client_id === client.id);
      const clientOpportunities = opportunities.filter(
        (opportunity) => opportunity.client_id === client.id,
      );
      const openOpportunities = clientOpportunities.filter((opportunity) =>
        OPEN_OPPORTUNITY_STATUSES.has(opportunity.status),
      );
      const wonOpportunities = clientOpportunities.filter(
        (opportunity) => opportunity.status === "won",
      );
      const lostOpportunities = clientOpportunities.filter(
        (opportunity) => opportunity.status === "lost",
      );
      const proposalOpportunities = clientOpportunities.filter((opportunity) =>
        ["proposal_draft", "proposal_sent"].includes(opportunity.status),
      );
      const activeProjects = clientProjects.filter((project) =>
        ACTIVE_PROJECT_STATUSES.has(project.status),
      );
      const blockedProjects = clientProjects.filter((project) => project.status === "blocked");
      const deliveredProjects = clientProjects.filter((project) => project.status === "delivered");
      const pendingClientApprovals = pendingApprovals.filter((approval) =>
        approvalMatchesClient(approval, client),
      );
      const averageMargin =
        clientOpportunities.length === 0
          ? 0
          : clientOpportunities.reduce(
              (sum, opportunity) => sum + (opportunity.expected_margin || 0),
              0,
            ) / clientOpportunities.length;
      const followUpDue = isDue(client.next_follow_up_at, now);
      const pipelineValue = openOpportunities.reduce(
        (sum, opportunity) => sum + (opportunity.expected_value || 0),
        0,
      );
      const wonValue = wonOpportunities.reduce(
        (sum, opportunity) => sum + (opportunity.expected_value || 0),
        0,
      );
      const lostValue = lostOpportunities.reduce(
        (sum, opportunity) => sum + (opportunity.expected_value || 0),
        0,
      );
      const stalledOpportunities = clientOpportunities.filter(
        (opportunity) => opportunity.status === "stalled",
      ).length;
      const repositoriesLinked = clientProjects.filter((project) => Boolean(project.repository))
        .length;
      const risk = riskForClient({
        blockedProjects: blockedProjects.length,
        followUpDue,
        proposalOpportunities: proposalOpportunities.length,
        activeProjects: activeProjects.length,
        openOpportunities: openOpportunities.length,
      });
      const score = valueScore({
        pipelineValue,
        wonValue,
        averageMargin,
        activeProjects: activeProjects.length,
        deliveredProjects: deliveredProjects.length,
        blockedProjects: blockedProjects.length,
        stalledOpportunities,
        followUpDue,
        repositoriesLinked,
      });
      const classification = classifyClient({
        pipelineValue,
        wonValue,
        lostValue,
        score: score.score,
        activeProjects: activeProjects.length,
        deliveredProjects: deliveredProjects.length,
        blockedProjects: blockedProjects.length,
        openOpportunities: openOpportunities.length,
        stalledOpportunities,
        followUpDue,
      });

      return {
        client,
        revenue: {
          pipeline_value: pipelineValue,
          won_value: wonValue,
          lost_value: lostValue,
          average_expected_margin: averageMargin,
          open_opportunities: openOpportunities.length,
          won_opportunities: wonOpportunities.length,
          stalled_opportunities: stalledOpportunities,
        },
        delivery: {
          projects_total: clientProjects.length,
          active_projects: activeProjects.length,
          blocked_projects: blockedProjects.length,
          delivered_projects: deliveredProjects.length,
          repositories_linked: repositoriesLinked,
          pending_approvals: pendingClientApprovals.length,
        },
        relationship: {
          last_client_message_at: client.last_client_message_at,
          last_owner_response_at: client.last_owner_response_at,
          next_follow_up_at: client.next_follow_up_at,
          follow_up_due: followUpDue,
        },
        value_score: score,
        classification,
        risk,
        next_action: nextActionForClient({
          risk,
          openOpportunities: openOpportunities.length,
          activeProjects: activeProjects.length,
        }),
        latest_activity_at: maxIso([
          client.updated,
          ...clientProjects.map((project) => project.updated),
          ...clientOpportunities.map((opportunity) => opportunity.updated),
        ]),
        memory_paths: {
          profile: relativeClientPath(client.slug, "CLIENT.md"),
          projects: relativeClientPath(client.slug, "PROJECTS.md"),
          revenue: relativeClientPath(client.slug, "REVENUE.md"),
          relationship: relativeClientPath(client.slug, "RELATIONSHIP.md"),
          opportunities: relativeClientPath(client.slug, "OPPORTUNITIES.md"),
          risks: relativeClientPath(client.slug, "RISKS.md"),
        },
        projects: byNewest(clientProjects).map(
          (project): ClientProjectSnapshot => ({
            id: project.id,
            slug: project.slug,
            name: project.name,
            status: project.status,
            repository: project.repository,
            stack: project.stack,
            ...(project.updated ? { updated: project.updated } : {}),
          }),
        ),
        opportunities: byNewest(clientOpportunities).map(
          (opportunity): ClientOpportunitySnapshot => ({
            id: opportunity.id,
            title: opportunity.title,
            status: opportunity.status,
            expected_value: opportunity.expected_value,
            expected_margin: opportunity.expected_margin,
            next_action: opportunity.next_action,
            ...(opportunity.updated ? { updated: opportunity.updated } : {}),
          }),
        ),
      } satisfies ClientIntelligenceItem;
    });

    const riskPriority: Record<ClientAccountRisk, number> = {
      blocked: 0,
      follow_up_due: 1,
      proposal: 2,
      active: 3,
      cold: 4,
    };
    const sorted = items.sort((left, right) => {
      return (
        riskPriority[left.risk] - riskPriority[right.risk] ||
        right.revenue.pipeline_value - left.revenue.pipeline_value ||
        right.latest_activity_at.localeCompare(left.latest_activity_at) ||
        left.client.name.localeCompare(right.client.name)
      );
    });

    return {
      generated_at: now.toISOString(),
      totals: {
        clients: sorted.length,
        pipeline_value: sorted.reduce((sum, item) => sum + item.revenue.pipeline_value, 0),
        won_value: sorted.reduce((sum, item) => sum + item.revenue.won_value, 0),
        active_projects: sorted.reduce((sum, item) => sum + item.delivery.active_projects, 0),
        blocked_projects: sorted.reduce((sum, item) => sum + item.delivery.blocked_projects, 0),
        follow_ups_due: sorted.filter((item) => item.relationship.follow_up_due).length,
      },
      clients: sorted,
    };
  }
}
