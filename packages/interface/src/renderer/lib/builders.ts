import {
  agentAbbr,
  clientRiskTone,
  displayLaneLabel,
  isInternalClient,
  opportunityProgress,
  opportunityTone,
  progressTone,
  projectProgress,
  projectTone,
  runTone,
} from "./tone";
import { formatLabel, formatMoney, ratioPercent, timeAgo } from "./format";
import type {
  AdaptiveMode,
  CapacitySegment,
  DashboardState,
  GoalItem,
  PortfolioLane,
  TodayAction,
  Workstream,
  WorkstreamDeliverySignal,
  WorkstreamPullRequestLink,
} from "./types";
import type { ArtifactRecord, ClientRecord, ProjectRecord } from "./api";

export function clientName(clients: ClientRecord[], clientId: string): string {
  return clients.find((client) => client.id === clientId)?.name ?? "No client";
}

export function sortNewest<T extends { created?: string; updated?: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) => {
    const left = Date.parse(a.updated || a.created || "");
    const right = Date.parse(b.updated || b.created || "");
    return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
  });
}

export function enabledCount(values: Record<string, boolean | number>): number {
  return Object.values(values).filter((value) => value === true).length;
}

export function normalizeRepositoryReference(repository?: string): string {
  const raw = (repository ?? "").trim();
  if (!raw) return "";

  const sshMatch = raw.match(/^git@github\.com:(?<path>[^#?]+?)(?:\.git)?$/i);
  if (sshMatch?.groups?.path) {
    return sshMatch.groups.path.replace(/\.git$/i, "").toLowerCase();
  }

  const withoutProtocol = raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const withoutHost = withoutProtocol.replace(/^github\.com[:/]/i, "");
  const path = withoutHost.split(/[?#]/)[0]?.replace(/\.git$/i, "") ?? "";
  const [owner, repo] = path.split("/").filter(Boolean);

  if (!owner || !repo) return raw.replace(/\.git$/i, "").toLowerCase();
  return `${owner}/${repo}`.toLowerCase();
}

function latestGitHubSignalForProject(
  project: ProjectRecord,
  artifacts: ArtifactRecord[],
): ArtifactRecord | undefined {
  const repository = normalizeRepositoryReference(project.repository);
  if (!repository) return undefined;

  return sortNewest(
    artifacts.filter(
      (artifact) =>
        artifact.type === "github-signal-report" &&
        normalizeRepositoryReference(artifact.repository) === repository,
    ),
  )[0];
}

function projectPullRequestLinks(signal?: ArtifactRecord): WorkstreamPullRequestLink[] {
  if (!signal?.pull_request_refs?.length && !signal?.pull_request_urls?.length) return [];

  const refs = signal.pull_request_refs ?? [];
  const urls = signal.pull_request_urls ?? [];
  const count = Math.max(refs.length, urls.length);

  return Array.from({ length: count }, (_, index) => {
    const ref = refs[index] ?? `PR ${index + 1}`;
    const shortLabel = ref.match(/#\d+/)?.[0] ?? `PR ${index + 1}`;
    return {
      label: shortLabel,
      title: ref,
      ...(urls[index] ? { url: urls[index] } : {}),
    };
  }).slice(0, 3);
}

export function buildProjectDeliverySignal(
  project: ProjectRecord,
  artifacts: ArtifactRecord[],
): WorkstreamDeliverySignal {
  const repository = normalizeRepositoryReference(project.repository);
  if (!repository) {
    return {
      repository: "No repository linked",
      label: "No repo",
      detail: "Project memory only",
      tone: "warning",
      pullRequests: [],
    };
  }

  const signal = latestGitHubSignalForProject(project, artifacts);
  if (!signal) {
    return {
      repository,
      label: "Repo linked",
      detail: "GitHub sync not run",
      tone: "neutral",
      pullRequests: [],
    };
  }

  const pullRequests = signal.pull_requests_count ?? 0;
  const checks = signal.checks_count ?? 0;
  const failing = signal.failing_checks_count ?? 0;
  const stale = (signal.stale_issues_count ?? 0) + (signal.stale_pull_requests_count ?? 0);
  const links = projectPullRequestLinks(signal);
  const label =
    failing > 0
      ? `${failing} failing`
      : stale > 0
        ? `${stale} stale`
        : links[0]?.label || (pullRequests > 0 ? `${pullRequests} PR` : "No PR");

  return {
    repository,
    label,
    detail: `PR ${pullRequests} · CI ${checks} · stale ${stale}`,
    tone: failing > 0 ? "danger" : stale > 0 ? "warning" : checks > 0 ? "success" : "info",
    pullRequests: links,
  };
}

export function buildPortfolioLanes(state: DashboardState): PortfolioLane[] {
  const clientsById = new Map(state.clients.map((client) => [client.id, client]));
  const ownershipByProjectId = new Map(
    state.projectOwnership.map((ownership) => [ownership.project_id, ownership]),
  );
  const laneMap = new Map<string, { client?: ClientRecord; streams: Workstream[] }>();

  for (const client of state.clients) {
    laneMap.set(client.id, { client, streams: [] });
  }

  for (const project of state.projects) {
    const key = project.client_id || "unassigned";
    if (!laneMap.has(key)) laneMap.set(key, { streams: [] });
    const ownership = ownershipByProjectId.get(project.id);
    const manager = ownership?.manager_agent_id ?? "project_manager";
    const specialistBadges = (ownership?.assigned_agents ?? ["development", "qa"])
      .filter((agent) => agent !== manager)
      .map(agentAbbr)
      .filter(Boolean)
      .slice(0, 3);
    laneMap.get(key)?.streams.push({
      id: project.id,
      title: project.name,
      status: formatLabel(project.status),
      tone: projectTone(project.status),
      progress: projectProgress(project.status),
      meta: `${formatLabel(manager)} · ${project.stack || "Project memory"}`,
      delivery: buildProjectDeliverySignal(project, state.artifacts),
      badges: [agentAbbr(manager) || "PM", ...specialistBadges],
    });
  }

  for (const opportunity of state.opportunities) {
    const key = opportunity.client_id || "unassigned";
    if (!laneMap.has(key)) laneMap.set(key, { streams: [] });
    laneMap.get(key)?.streams.push({
      id: opportunity.id,
      title: opportunity.title,
      status: formatLabel(opportunity.status),
      tone: opportunityTone(opportunity.status),
      progress: opportunityProgress(opportunity.status),
      meta:
        opportunity.next_action ||
        (opportunity.expected_value ? formatMoney(opportunity.expected_value) : "Opportunity"),
      badges: ["SALES", "PM", "PRICE"],
    });
  }

  const lanes = [...laneMap.entries()].filter(([, lane]) => lane.streams.length > 0);
  const totalStreams = lanes.reduce((sum, [, lane]) => sum + lane.streams.length, 0);

  return lanes
    .sort((left, right) => {
      const leftInternal = isInternalClient(left[1].client ?? clientsById.get(left[0]));
      const rightInternal = isInternalClient(right[1].client ?? clientsById.get(right[0]));
      if (leftInternal !== rightInternal) return leftInternal ? -1 : 1;
      return right[1].streams.length - left[1].streams.length;
    })
    .slice(0, 4)
    .map(([key, lane]) => {
      const client = lane.client ?? clientsById.get(key);
      const display = displayLaneLabel(client);
      const percent = totalStreams ? Math.round((lane.streams.length / totalStreams) * 100) : 0;
      return {
        key,
        label: display.label,
        subtitle: display.subtitle,
        capacity: `${percent}% Workload`,
        capacityPercent: percent,
        streams: lane.streams.slice(0, 3),
      };
    });
}

export function buildCapacitySegments(state: DashboardState): CapacitySegment[] {
  const clientsById = new Map(state.clients.map((client) => [client.id, client]));
  const internalProjects = state.projects.filter((project) =>
    isInternalClient(clientsById.get(project.client_id)),
  ).length;
  const clientProjects = Math.max(0, state.projects.length - internalProjects);
  const riskItems = state.approvals.length;
  const weights = {
    clientDelivery: clientProjects,
    product: internalProjects,
    growth: state.opportunities.length,
    risk: riskItems,
  };
  const totalWeight = Object.values(weights).reduce((sum, item) => sum + item, 0);
  const width = (weight: number): number =>
    totalWeight > 0 ? Math.round((weight / totalWeight) * 100) : 0;

  return [
    {
      label: "Client Delivery",
      value: `${clientProjects} projects`,
      width: width(weights.clientDelivery),
      toneClass: "bg-success",
    },
    {
      label: "BureauOS Product",
      value: `${internalProjects} projects`,
      width: width(weights.product),
      toneClass: "bg-info",
    },
    {
      label: "Growth",
      value: `${state.opportunities.length} opportunities`,
      width: width(weights.growth),
      toneClass: "bg-warning",
    },
    {
      label: "Risk / Admin",
      value: `${riskItems} approvals`,
      width: width(weights.risk),
      toneClass: "bg-muted-foreground/60",
    },
  ];
}

export function buildGoalItems(state: DashboardState): GoalItem[] {
  const activeClients = state.clients.filter((client) => client.status === "active").length;
  const clientTarget = Math.max(activeClients, state.clients.length, 1);
  const openOpportunities = state.opportunities.filter(
    (opportunity) => opportunity.status !== "won" && opportunity.status !== "lost",
  );
  const clientsWithPipeline = new Set(openOpportunities.map((opportunity) => opportunity.client_id))
    .size;
  const pipelineValue = openOpportunities.reduce(
    (sum, opportunity) => sum + (opportunity.expected_value || 0),
    0,
  );

  const totalProjects = state.projects.length;
  const blockedProjects = state.projects.filter((project) => project.status === "blocked").length;
  const activeProjects = state.projects.filter((project) =>
    ["approved", "in_progress", "proposal"].includes(project.status),
  ).length;
  const repositoryCoverage = totalProjects
    ? state.projects.filter((project) => project.repository).length
    : 0;

  const followUpsDue =
    state.clientIntelligence?.clients.filter((client) => client.relationship.follow_up_due)
      .length ?? 0;
  const clientsWithAnyMemory = state.clientIntelligence?.clients.length ?? state.clients.length;

  const growthSections = state.growthMemory?.sections ?? [];
  const configuredGrowthSections = growthSections.filter(
    (section) => section.status === "configured",
  ).length;
  const growthArtifacts = state.artifacts.filter((artifact) =>
    ["social-post-brief", "ad-campaign-brief", "creative-brief", "campaign-brief"].includes(
      artifact.type,
    ),
  ).length;

  const providerReady = state.providers.some((provider) => provider.status === "ok");
  const autonomyChecks = [
    !state.error,
    state.agents.length > 0,
    state.capabilities.length > 0,
    providerReady,
    state.growthMemory?.ready === true,
  ];
  const autonomyReady = autonomyChecks.filter(Boolean).length;

  const completedRuns = state.runs.filter((run) => run.status === "completed").length;
  const runIssues = state.runs.filter((run) =>
    ["needs_human", "blocked", "failed"].includes(run.status),
  ).length;
  const healthyRuns = Math.max(0, completedRuns - runIssues);

  const goals: GoalItem[] = [
    {
      id: "revenue-engine",
      title: "Revenue Engine",
      description: "Maintain active commercial pipeline across client accounts.",
      progress: ratioPercent(clientsWithPipeline, clientTarget),
      tone: progressTone(ratioPercent(clientsWithPipeline, clientTarget)),
      current: `${clientsWithPipeline}/${clientTarget} accounts`,
      target: "Every active client has an open opportunity",
      nextAction:
        pipelineValue > 0
          ? "Prioritize the highest-value opportunity and move it to proposal."
          : "Create or import the first qualified opportunity.",
      route: "revenue",
      signals: [
        `${formatMoney(pipelineValue)} open pipeline`,
        `${openOpportunities.length} open opportunities`,
      ],
    },
    {
      id: "delivery-health",
      title: "Delivery Health",
      description: "Keep client and internal projects unblocked and repository-backed.",
      progress:
        totalProjects === 0 ? 0 : ratioPercent(totalProjects - blockedProjects, totalProjects),
      tone: blockedProjects > 0 ? "danger" : progressTone(totalProjects === 0 ? 0 : 100),
      current: `${blockedProjects} blocked`,
      target: "0 blocked projects",
      nextAction:
        blockedProjects > 0
          ? "Open the blocked project queue and assign a recovery action."
          : "Dispatch the next project-manager run for active work.",
      route: "delivery",
      signals: [
        `${activeProjects} active projects`,
        `${repositoryCoverage}/${Math.max(totalProjects, 1)} repositories linked`,
      ],
    },
    {
      id: "client-success",
      title: "Client Success",
      description: "Protect relationships with follow-up discipline and account visibility.",
      progress:
        clientsWithAnyMemory === 0
          ? 0
          : ratioPercent(clientsWithAnyMemory - followUpsDue, clientsWithAnyMemory),
      tone: followUpsDue > 0 ? "warning" : progressTone(clientsWithAnyMemory === 0 ? 0 : 100),
      current: `${followUpsDue} due`,
      target: "No overdue client follow-ups",
      nextAction:
        followUpsDue > 0
          ? "Review clients due for follow-up and prepare safe response drafts."
          : "Create the next account plan for the most valuable client.",
      route: "clients",
      signals: [`${state.clients.length} client profiles`, `${clientsWithAnyMemory} account views`],
    },
    {
      id: "growth-foundation",
      title: "Growth Foundation",
      description: "Keep brand, offers, channels, and draft assets ready for visibility work.",
      progress: ratioPercent(configuredGrowthSections + Math.min(growthArtifacts, 1), 4),
      tone: progressTone(ratioPercent(configuredGrowthSections + Math.min(growthArtifacts, 1), 4)),
      current: `${configuredGrowthSections}/3 memory sections`,
      target: "Brand, offers, channels, and one draft asset ready",
      nextAction:
        state.growthMemory?.ready === true
          ? "Generate the next draft-only growth asset from current positioning."
          : "Complete missing growth memory before campaign work.",
      route: "growth",
      signals: [`${growthArtifacts} growth artifacts`, `${state.approvals.length} owner decisions`],
    },
    {
      id: "autonomy-readiness",
      title: "Autonomy Readiness",
      description: "Make the operating system capable of running without owner babysitting.",
      progress: ratioPercent(autonomyReady, autonomyChecks.length),
      tone: progressTone(ratioPercent(autonomyReady, autonomyChecks.length)),
      current: `${autonomyReady}/${autonomyChecks.length} checks`,
      target: "API, agents, capabilities, provider, and growth memory ready",
      nextAction: providerReady
        ? "Review remaining autonomy checks and keep policy gates tight."
        : "Connect a provider or fix missing provider credentials.",
      route: providerReady ? "agents" : "settings",
      signals: [`${state.agents.length} agents`, `${state.capabilities.length} capabilities`],
    },
    {
      id: "execution-cadence",
      title: "Execution Cadence",
      description: "Track whether autonomous runs are completing instead of piling up.",
      progress: state.runs.length === 0 ? 0 : ratioPercent(healthyRuns, state.runs.length),
      tone: runIssues > 0 ? "warning" : progressTone(state.runs.length === 0 ? 0 : 100),
      current: `${completedRuns}/${state.runs.length} completed`,
      target: "Runs complete without human-blocked drift",
      nextAction:
        runIssues > 0
          ? "Resolve runs needing human input before starting more work."
          : "Start the next useful run from Today or project dispatch.",
      route: runIssues > 0 ? "risk" : "today",
      signals: [`${runIssues} issue runs`, `${state.audit.length} recent audit events`],
    },
  ];

  return goals.sort(
    (left, right) => left.progress - right.progress || left.title.localeCompare(right.title),
  );
}

export function buildTodayActions(state: DashboardState): TodayAction[] {
  const actions: TodayAction[] = [];
  const clientById = new Map(state.clients.map((client) => [client.id, client]));

  for (const approval of state.approvals) {
    actions.push({
      id: `approval:${approval.id}`,
      priority: 10,
      tone: "warning",
      source: "Approval",
      title: formatLabel(approval.action),
      detail: approval.scope || approval.target || "Owner decision required",
      meta: approval.created ? timeAgo(approval.created) : approval.actor,
      route: "approvals",
      created: approval.created ?? approval.updated,
    });
  }

  for (const project of state.projects.filter((item) => item.status === "blocked")) {
    const client = clientById.get(project.client_id);
    actions.push({
      id: `project:${project.id}`,
      priority: 20,
      tone: "danger",
      source: "Delivery",
      title: project.name,
      detail: client ? `${client.name} · project blocked` : "Project blocked",
      meta: project.updated ? timeAgo(project.updated) : project.stack || "blocked",
      route: "delivery",
      created: project.updated ?? project.created,
    });
  }

  for (const run of state.runs.filter((item) =>
    ["needs_human", "blocked", "failed"].includes(item.status),
  )) {
    actions.push({
      id: `run:${run.id}`,
      priority: run.status === "needs_human" ? 30 : 25,
      tone: runTone(run.status),
      source: "Run",
      title: formatLabel(run.type),
      detail: run.scope,
      meta: run.created ? timeAgo(run.created) : formatLabel(run.status),
      route: "risk",
      created: run.created,
    });
  }

  for (const item of state.clientIntelligence?.clients ?? []) {
    if (!["follow_up_due", "blocked", "proposal"].includes(item.risk)) continue;
    actions.push({
      id: `client:${item.client.id}:${item.risk}`,
      priority: item.risk === "blocked" ? 22 : item.risk === "follow_up_due" ? 35 : 45,
      tone: clientRiskTone(item.risk),
      source: "Client",
      title: item.client.name,
      detail: item.next_action,
      meta:
        item.relationship.next_follow_up_at && item.relationship.follow_up_due
          ? `Due ${timeAgo(item.relationship.next_follow_up_at)}`
          : formatLabel(item.risk),
      route: "clients",
      created: item.latest_activity_at,
    });
  }

  for (const opportunity of state.opportunities.filter((item) =>
    ["stalled", "proposal_draft", "proposal_sent"].includes(item.status),
  )) {
    actions.push({
      id: `opportunity:${opportunity.id}`,
      priority: opportunity.status === "stalled" ? 40 : 50,
      tone: opportunityTone(opportunity.status),
      source: "Revenue",
      title: opportunity.title,
      detail:
        opportunity.next_action ||
        `${formatMoney(opportunity.expected_value || 0)} pipeline · ${formatLabel(opportunity.status)}`,
      meta: opportunity.updated ? timeAgo(opportunity.updated) : "opportunity",
      route: "revenue",
      created: opportunity.updated ?? opportunity.created,
    });
  }

  for (const provider of state.providers.filter((item) => item.status === "missing")) {
    actions.push({
      id: `provider:${provider.provider}:${provider.id}`,
      priority: 60,
      tone: "warning",
      source: "Provider",
      title: provider.provider_name || provider.provider,
      detail: provider.reason || "Provider credentials need attention",
      meta: provider.auth_mode,
      route: "settings",
    });
  }

  if (state.growthMemory && !state.growthMemory.ready) {
    actions.push({
      id: "growth-memory:incomplete",
      priority: 70,
      tone: "neutral",
      source: "Growth",
      title: "Growth memory incomplete",
      detail: `Missing ${state.growthMemory.missing_sections.map(formatLabel).join(", ")}`,
      meta: `${state.growthMemory.sections.filter((section) => section.status === "configured").length}/3 configured`,
      route: "growth",
      created: state.growthMemory.generated_at,
    });
  }

  return actions.sort((left, right) => {
    return (
      left.priority - right.priority ||
      (right.created ?? "").localeCompare(left.created ?? "") ||
      left.title.localeCompare(right.title)
    );
  });
}

export function adaptiveDefaultMode(state: DashboardState): AdaptiveMode {
  if (state.loading) return "portfolio";
  return buildTodayActions(state).length > 0 ? "today" : "portfolio";
}
