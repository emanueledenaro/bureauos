import { join } from "node:path";
import { ApprovalRegistry, type ApprovalRecord } from "../registries/approval.js";
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import { OpportunityRegistry } from "../registries/opportunity.js";
import { ProjectRegistry } from "../registries/project.js";

export type ClientAccountRisk = "blocked" | "follow_up_due" | "proposal" | "active" | "cold";

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
      const risk = riskForClient({
        blockedProjects: blockedProjects.length,
        followUpDue,
        proposalOpportunities: proposalOpportunities.length,
        activeProjects: activeProjects.length,
        openOpportunities: openOpportunities.length,
      });

      return {
        client,
        revenue: {
          pipeline_value: openOpportunities.reduce(
            (sum, opportunity) => sum + (opportunity.expected_value || 0),
            0,
          ),
          won_value: wonOpportunities.reduce(
            (sum, opportunity) => sum + (opportunity.expected_value || 0),
            0,
          ),
          lost_value: lostOpportunities.reduce(
            (sum, opportunity) => sum + (opportunity.expected_value || 0),
            0,
          ),
          average_expected_margin: averageMargin,
          open_opportunities: openOpportunities.length,
          won_opportunities: wonOpportunities.length,
          stalled_opportunities: clientOpportunities.filter(
            (opportunity) => opportunity.status === "stalled",
          ).length,
        },
        delivery: {
          projects_total: clientProjects.length,
          active_projects: activeProjects.length,
          blocked_projects: blockedProjects.length,
          delivered_projects: clientProjects.filter((project) => project.status === "delivered")
            .length,
          repositories_linked: clientProjects.filter((project) => Boolean(project.repository))
            .length,
          pending_approvals: pendingClientApprovals.length,
        },
        relationship: {
          last_client_message_at: client.last_client_message_at,
          last_owner_response_at: client.last_owner_response_at,
          next_follow_up_at: client.next_follow_up_at,
          follow_up_due: followUpDue,
        },
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
