import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Api,
  type AgentDefinition,
  type ApprovalRecord,
  type ArtifactRecord,
  type AuditEvent,
  type BusinessReportResult,
  type CapabilityDefinition,
  type CoordinatorAttachmentInput,
  type ClientRecord,
  type CompanyPulse,
  type CoordinatorChatResult,
  type CoordinatorMessageRecord,
  type OpportunityRecord,
  type ProviderAuthAuthorization,
  type ProviderConnection,
  type ProviderConnector,
  type ProviderModelList,
  type ProjectOwnershipRecord,
  type ProjectRecord,
  type RunRecord,
  type SettingsSummary,
} from "./lib/api";

function classes(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function formatMoney(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

function formatLabel(value: string): string {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function formatTime(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function timeAgo(iso: string): string {
  if (!iso) return "now";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatBytes(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1_000) return `${Math.round(value / 1_000)} KB`;
  return `${value} B`;
}

interface DashboardState {
  pulse?: CompanyPulse;
  clients: ClientRecord[];
  projects: ProjectRecord[];
  projectOwnership: ProjectOwnershipRecord[];
  opportunities: OpportunityRecord[];
  approvals: ApprovalRecord[];
  resolvedApprovals: ApprovalRecord[];
  runs: RunRecord[];
  agents: AgentDefinition[];
  capabilities: CapabilityDefinition[];
  providers: ProviderConnection[];
  providerConnectors: ProviderConnector[];
  settings?: SettingsSummary;
  artifacts: ArtifactRecord[];
  audit: AuditEvent[];
  error?: string;
  loading: boolean;
}

interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  file: File;
  previewUrl?: string;
}

type ChatMessage = CoordinatorMessageRecord;

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function isTextAttachment(file: File): boolean {
  return (
    file.type.startsWith("text/") ||
    ["application/json", "application/xml", "application/javascript"].includes(file.type) ||
    /\.(csv|json|md|txt|log|xml|yaml|yml)$/i.test(file.name)
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read attachment"));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read attachment"));
    reader.readAsText(file);
  });
}

async function toCoordinatorAttachment(file: File): Promise<CoordinatorAttachmentInput> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is larger than 10 MB`);
  }

  const base = {
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
  };

  if (isTextAttachment(file)) {
    return { ...base, text: await readFileAsText(file) };
  }
  return { ...base, dataUrl: await readFileAsDataUrl(file) };
}

const emptyState: DashboardState = {
  clients: [],
  projects: [],
  projectOwnership: [],
  opportunities: [],
  approvals: [],
  resolvedApprovals: [],
  runs: [],
  agents: [],
  capabilities: [],
  providers: [],
  providerConnectors: [],
  artifacts: [],
  audit: [],
  loading: true,
};

function useDashboard(): { state: DashboardState; refresh: () => Promise<void> } {
  const [state, setState] = useState<DashboardState>(emptyState);

  const refresh = async (): Promise<void> => {
    try {
      const [
        pulse,
        clients,
        projects,
        projectOwnership,
        opportunities,
        approvals,
        resolvedApprovals,
        runs,
        agents,
        capabilities,
        artifacts,
        providers,
        settings,
        providerConnectors,
        audit,
      ] = await Promise.all([
        Api.pulse(),
        Api.clients(),
        Api.projects(),
        Api.projectOwnership(),
        Api.opportunities(),
        Api.approvals(),
        Api.approvalsResolved(),
        Api.runs(),
        Api.agents(),
        Api.capabilities(),
        Api.artifacts(),
        Api.providers(),
        Api.settings(),
        Api.providerConnectors(),
        Api.audit(30),
      ]);
      setState({
        pulse,
        clients,
        projects,
        projectOwnership,
        opportunities,
        approvals,
        resolvedApprovals,
        runs,
        agents,
        capabilities,
        artifacts,
        providers,
        settings,
        providerConnectors,
        audit,
        loading: false,
      });
    } catch (e) {
      setState((current) => ({ ...current, loading: false, error: (e as Error).message }));
    }
  };

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);

    let stream: EventSource | undefined;
    let cancelled = false;
    (async () => {
      try {
        const base = await (window.bureau
          ? window.bureau.apiUrl()
          : Promise.resolve("http://127.0.0.1:3737"));
        if (cancelled || !base) return;
        stream = new EventSource(`${base}/events`);
        stream.addEventListener("audit", (event) => {
          try {
            const item = JSON.parse((event as MessageEvent).data) as AuditEvent;
            setState((current) => ({
              ...current,
              audit: [...current.audit, item].slice(-60),
            }));
          } catch {
            // polling covers malformed events
          }
        });
      } catch {
        // polling keeps the dashboard alive
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(timer);
      stream?.close();
    };
  }, []);

  return { state, refresh };
}

type AdaptiveMode =
  | "portfolio"
  | "today"
  | "goals"
  | "revenue"
  | "delivery"
  | "growth"
  | "clients"
  | "risk"
  | "approvals"
  | "memory"
  | "agents"
  | "reports"
  | "settings";
type Tone = "green" | "amber" | "red" | "black" | "muted";

interface Workstream {
  title: string;
  status: string;
  tone: Tone;
  progress: number;
  meta: string;
  github?: string;
  badges: string[];
}

interface PortfolioLane {
  label: string;
  subtitle: string;
  capacity: string;
  streams: Workstream[];
}

interface CapacitySegment {
  label: string;
  value: string;
  width: number;
  className: string;
}

function projectTone(status: string): Tone {
  if (status === "blocked" || status === "cancelled") return "red";
  if (status === "proposal" || status === "approved" || status === "intake") return "amber";
  if (status === "delivered" || status === "in_progress") return "green";
  return "muted";
}

function projectProgress(status: string): number {
  switch (status) {
    case "intake":
      return 15;
    case "proposal":
      return 30;
    case "approved":
      return 45;
    case "in_progress":
      return 65;
    case "blocked":
      return 35;
    case "delivered":
      return 100;
    case "cancelled":
      return 0;
    default:
      return 20;
  }
}

function opportunityTone(status: string): Tone {
  if (status === "lost") return "red";
  if (status === "stalled" || status === "proposal_draft" || status === "proposal_sent") {
    return "amber";
  }
  if (status === "won" || status === "qualified") return "green";
  return "muted";
}

function opportunityProgress(status: string): number {
  switch (status) {
    case "intake":
      return 15;
    case "qualified":
      return 35;
    case "proposal_draft":
      return 50;
    case "proposal_sent":
      return 70;
    case "won":
      return 100;
    case "lost":
      return 0;
    case "stalled":
      return 30;
    default:
      return 20;
  }
}

function agentAbbr(role: string): string {
  return role
    .split(/[_\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 3);
}

function isInternalClient(client?: ClientRecord): boolean {
  if (!client) return false;
  const value = `${client.name} ${client.industry}`.toLowerCase();
  return value.includes("bureauos") || value.includes("internal");
}

function displayLaneLabel(client?: ClientRecord): { label: string; subtitle: string } {
  if (!client) return { label: "Unassigned", subtitle: "No client memory" };
  if (isInternalClient(client)) {
    return { label: "Internal Product", subtitle: client.name };
  }
  return {
    label: client.name,
    subtitle: `${formatLabel(client.status)} - ${client.industry}`,
  };
}

function buildPortfolioLanes(state: DashboardState): PortfolioLane[] {
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
      .slice(0, 2);
    laneMap.get(key)?.streams.push({
      title: project.name,
      status: formatLabel(project.status),
      tone: projectTone(project.status),
      progress: projectProgress(project.status),
      meta: `${formatLabel(manager)} - ${project.stack || project.repository || "Project memory"}`,
      github: project.repository ? "Repo linked" : "Repo pending",
      badges: [agentAbbr(manager) || "PM", ...specialistBadges, project.repository ? "GH" : "MEM"],
    });
  }

  for (const opportunity of state.opportunities) {
    const key = opportunity.client_id || "unassigned";
    if (!laneMap.has(key)) laneMap.set(key, { streams: [] });
    laneMap.get(key)?.streams.push({
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

  const totalStreams = [...laneMap.values()].reduce((sum, lane) => sum + lane.streams.length, 0);
  return [...laneMap.entries()]
    .filter(([, lane]) => lane.streams.length > 0)
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
      const capacity = totalStreams
        ? `${Math.round((lane.streams.length / totalStreams) * 100)}% Workload`
        : "0% Workload";
      return {
        label: display.label,
        subtitle: display.subtitle,
        capacity,
        streams: lane.streams.slice(0, 3),
      };
    });
}

function buildCapacitySegments(state: DashboardState): CapacitySegment[] {
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
      className: "bg-emerald-600",
    },
    {
      label: "BureauOS Product",
      value: `${internalProjects} projects`,
      width: width(weights.product),
      className: "bg-teal-700",
    },
    {
      label: "Growth",
      value: `${state.opportunities.length} opportunities`,
      width: width(weights.growth),
      className: "bg-neutral-700",
    },
    {
      label: "Risk / Admin",
      value: `${riskItems} approvals`,
      width: width(weights.risk),
      className: "bg-neutral-800",
    },
  ];
}

function completedRunCoverage(runs: RunRecord[]): number {
  if (!runs.length) return 0;
  const completed = runs.filter((run) => run.status === "completed").length;
  return Math.round((completed / runs.length) * 100);
}

function enabledCount(values: Record<string, boolean>): number {
  return Object.values(values).filter(Boolean).length;
}

function toneDot(tone: Tone): string {
  switch (tone) {
    case "green":
      return "bg-emerald-600";
    case "amber":
      return "bg-amber-500";
    case "red":
      return "bg-rose-600";
    case "black":
      return "bg-neutral-950";
    case "muted":
      return "bg-neutral-600";
  }
}

function toneText(tone: Tone): string {
  switch (tone) {
    case "green":
      return "text-emerald-400";
    case "amber":
      return "text-amber-400";
    case "red":
      return "text-rose-400";
    case "black":
      return "text-neutral-50";
    case "muted":
      return "text-neutral-500";
  }
}

function Header({
  state,
  mode,
  onModeChange,
}: {
  state: DashboardState;
  mode: AdaptiveMode;
  onModeChange: (mode: AdaptiveMode) => void;
}) {
  const modes: AdaptiveMode[] = ["portfolio", "today", "goals"];
  const now = new Date();
  const blockedProjects = state.projects.filter((project) => project.status === "blocked").length;
  const riskTone: Tone =
    blockedProjects > 0 ? "red" : state.approvals.length > 0 ? "amber" : "green";
  const riskValue =
    blockedProjects > 0
      ? `${blockedProjects} blocked`
      : state.approvals.length > 0
        ? `${state.approvals.length} approvals`
        : "Clear";
  const pipeline = state.pulse?.revenue.pipeline_value ?? 0;
  return (
    <header className="h-16 border-b border-neutral-800 bg-neutral-950">
      <div className="flex h-full items-center justify-between px-6">
        <div>
          <div className="flex items-baseline gap-3">
            <h1 className="text-[15px] font-semibold text-neutral-50">Company Pulse</h1>
            <span className="text-[11px] text-neutral-500">Adaptive:</span>
            <div className="flex items-center gap-1 text-[11px]">
              {modes.map((item, index) => (
                <button
                  key={item}
                  onClick={() => onModeChange(item)}
                  className={classes(
                    mode === item ? "font-medium text-emerald-400" : "text-neutral-500",
                  )}
                >
                  {item[0]?.toUpperCase()}
                  {item.slice(1)}
                  {index < modes.length - 1 ? " /" : ""}
                </button>
              ))}
              <button
                onClick={() => onModeChange("settings")}
                className={classes(
                  "ml-1",
                  mode === "settings" ? "font-medium text-neutral-50" : "text-neutral-500",
                )}
              >
                Settings
              </button>
            </div>
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">
            {state.pulse?.organization ?? "BureauOS"} - Operating Room
          </div>
        </div>

        <div className="flex items-center gap-3">
          <TopMetric
            tone={state.error ? "red" : state.loading ? "amber" : "green"}
            label="Autonomous Mode"
            value={state.error ? "Offline" : state.loading ? "Loading" : "Active"}
          />
          <TopMetric tone={riskTone} label="Risk Level" value={riskValue} />
          <TopMetric
            tone={pipeline > 0 ? "green" : "amber"}
            label="Revenue Health"
            value={pipeline > 0 ? formatMoney(pipeline) : "No pipeline"}
          />
          <button className="grid h-8 w-8 place-items-center rounded-md border border-neutral-800 text-neutral-500">
            *
          </button>
          <div className="text-right text-[11px] leading-tight text-neutral-500">
            <div>{formatDate(now)}</div>
            <div>{formatTime(now)}</div>
          </div>
          <div className="grid h-9 w-9 place-items-center rounded-full border border-neutral-800 bg-neutral-800 text-xs font-semibold text-neutral-300">
            ED
          </div>
        </div>
      </div>
    </header>
  );
}

function TopMetric({ tone, label, value }: { tone: Tone; label: string; value: string }) {
  return (
    <div className="min-w-32 rounded-md border border-neutral-800 bg-neutral-950 px-4 py-2">
      <div className="flex items-center gap-2 text-[11px] font-medium text-neutral-300">
        <span className={classes("h-1.5 w-1.5 rounded-full", toneDot(tone))} />
        {label}
      </div>
      <div className={classes("pl-3.5 text-[10px]", toneText(tone))}>{value}</div>
    </div>
  );
}

function SidebarItem({
  icon,
  label,
  badge,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  badge?: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classes(
        "flex h-10 w-full items-center justify-between rounded-md px-3 text-left text-[13px]",
        active ? "bg-neutral-800 text-neutral-50" : "text-neutral-500 hover:bg-neutral-900",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="grid h-4 w-4 place-items-center text-[11px] text-neutral-500">{icon}</span>
        <span>{label}</span>
      </div>
      {badge !== undefined && badge > 0 ? (
        <span className="grid min-w-5 place-items-center rounded-full bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-500">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function Sidebar({
  state,
  mode,
  onModeChange,
}: {
  state: DashboardState;
  mode: AdaptiveMode;
  onModeChange: (mode: AdaptiveMode) => void;
}) {
  return (
    <aside className="hidden w-[184px] flex-col border-r border-neutral-800 bg-neutral-950 lg:flex">
      <div className="flex h-16 items-center gap-3 border-b border-neutral-800 px-5">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-neutral-950 text-sm font-semibold text-white">
          B
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold text-neutral-50">BureauOS</div>
          <div className="text-[11px] text-neutral-500">Operating Room</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        <SidebarItem
          icon="H"
          label="Home"
          active={mode === "portfolio"}
          onClick={() => onModeChange("portfolio")}
        />
        <SidebarItem
          icon="$"
          label="Revenue"
          active={mode === "revenue"}
          onClick={() => onModeChange("revenue")}
        />
        <SidebarItem
          icon="D"
          label="Delivery"
          active={mode === "delivery"}
          onClick={() => onModeChange("delivery")}
          badge={state.projects.length}
        />
        <SidebarItem
          icon="G"
          label="Growth"
          active={mode === "growth"}
          onClick={() => onModeChange("growth")}
          badge={state.opportunities.length}
        />
        <SidebarItem
          icon="C"
          label="Clients"
          active={mode === "clients"}
          onClick={() => onModeChange("clients")}
          badge={state.clients.length}
        />
        <SidebarItem
          icon="R"
          label="Risk"
          active={mode === "risk"}
          onClick={() => onModeChange("risk")}
          badge={
            state.approvals.length +
            state.projects.filter((project) => project.status === "blocked").length
          }
        />
        <SidebarItem
          icon="M"
          label="Memory"
          active={mode === "memory"}
          onClick={() => onModeChange("memory")}
          badge={state.artifacts.length}
        />
        <SidebarItem
          icon="A"
          label="Agents"
          active={mode === "agents"}
          onClick={() => onModeChange("agents")}
          badge={state.agents.length}
        />
        <div className="my-4 border-t border-neutral-800" />
        <SidebarItem icon="I" label="Inbox" badge={state.runs.length} />
        <SidebarItem
          icon="V"
          label="Approvals"
          active={mode === "approvals"}
          badge={state.approvals.length}
          onClick={() => onModeChange("approvals")}
        />
        <SidebarItem
          icon="P"
          label="Reports"
          active={mode === "reports"}
          onClick={() => onModeChange("reports")}
        />
        <SidebarItem
          icon="S"
          label="Settings"
          active={mode === "settings"}
          onClick={() => onModeChange("settings")}
        />
      </nav>
      <div className="m-4 rounded-md border border-neutral-800 p-3">
        <div className="text-[11px] font-semibold text-neutral-100">System Status</div>
        <div className="mt-2 flex items-center gap-2 text-[10px] text-neutral-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
          {state.error ? "API Offline" : state.loading ? "Loading API" : "All Systems Online"}
        </div>
        <div className="mt-2 text-[10px] text-neutral-500">{state.agents.length} agents active</div>
        <button className="mt-3 text-[10px] font-medium text-neutral-500">View status</button>
      </div>
    </aside>
  );
}

function WorkstreamCard({ item, laneIndex }: { item: Workstream; laneIndex: number }) {
  return (
    <div className="workstream-card">
      {laneIndex > 0 ? (
        <span className="connector-node connector-node--left" aria-hidden="true" />
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-medium text-neutral-50">{item.title}</div>
          <div className={classes("mt-1 flex items-center gap-2 text-[10px]", toneText(item.tone))}>
            <span className={classes("h-1.5 w-1.5 rounded-full", toneDot(item.tone))} />
            {item.status}
          </div>
          <div className="mt-1 max-w-[220px] truncate text-[10px] text-neutral-500">
            {item.meta}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="h-1.5 flex-1 rounded-full bg-neutral-800">
          <div
            className={classes(
              "h-1.5 rounded-full",
              item.tone === "red" ? "bg-rose-600" : "bg-emerald-600",
            )}
            style={{ width: `${item.progress}%` }}
          />
        </div>
        <div className="w-8 text-right text-[10px] text-neutral-500">{item.progress}%</div>
        {item.github ? (
          <div className="text-[10px] font-medium text-neutral-300">{item.github}</div>
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-48 place-items-center rounded-md border border-dashed border-neutral-800 bg-neutral-900 px-6 py-8 text-center">
      <div>
        <div className="text-[13px] font-semibold text-neutral-50">{title}</div>
        <p className="mt-2 max-w-md text-[11px] leading-relaxed text-neutral-500">{description}</p>
      </div>
    </div>
  );
}

function SectionShell({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="dashboard-panel min-h-[520px] overflow-hidden">
      <div className="flex items-start justify-between border-b border-neutral-800 px-5 py-4">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-50">{title}</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">{description}</p>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function MetricTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950 p-4">
      <div className="text-[10px] font-medium uppercase text-neutral-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-neutral-50">{value}</div>
      <div className="mt-2 text-[11px] text-neutral-500">{detail}</div>
    </div>
  );
}

function StatusPill({ value, tone }: { value: string; tone: Tone }) {
  return (
    <span
      className={classes(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        tone === "green"
          ? "border-emerald-900 bg-emerald-950 text-emerald-400"
          : tone === "amber"
            ? "border-amber-900 bg-amber-950 text-amber-400"
            : tone === "red"
              ? "border-rose-900 bg-rose-950 text-rose-400"
              : "border-neutral-800 bg-neutral-900 text-neutral-500",
      )}
    >
      <span className={classes("h-1.5 w-1.5 rounded-full", toneDot(tone))} />
      {value}
    </span>
  );
}

function clientName(clients: ClientRecord[], clientId: string): string {
  return clients.find((client) => client.id === clientId)?.name ?? "No client";
}

function sortNewest<T extends { created?: string; updated?: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const left = Date.parse(a.updated || a.created || "");
    const right = Date.parse(b.updated || b.created || "");
    return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
  });
}

function PortfolioOperatingRoom({ state }: { state: DashboardState }) {
  const lanes = useMemo(() => buildPortfolioLanes(state), [state]);
  const capacitySegments = useMemo(() => buildCapacitySegments(state), [state]);
  return (
    <section className="dashboard-panel portfolio-room">
      <div className="flex items-start justify-between border-b border-neutral-800 px-5 py-2.5">
        <div>
          <h2 className="text-[14px] font-semibold text-neutral-50">Portfolio Operating Room</h2>
          <p className="mt-0.5 text-[10px] text-neutral-500">
            Live portfolio view of workstreams, projects, and autonomous execution.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded-md border border-neutral-800 px-3 py-1.5 text-[11px] text-neutral-500">
            Filter
          </button>
          <button className="grid h-8 w-8 place-items-center rounded-md border border-neutral-800 text-neutral-500">
            ...
          </button>
        </div>
      </div>

      <div className="border-b border-neutral-800 px-5">
        <div className="flex h-8 items-center gap-7 text-[11px]">
          {["Portfolio Map", "Workload", "Gantt", "Kanban"].map((tab, index) => (
            <button
              key={tab}
              className={classes(
                "h-full border-b-2",
                index === 0
                  ? "border-neutral-50 font-medium text-neutral-50"
                  : "border-transparent text-neutral-500",
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 py-3">
        {lanes.length > 0 ? (
          <div className="operating-map">
            {lanes.map((lane, laneIndex) => (
              <div
                key={lane.label}
                className={classes(
                  "portfolio-column",
                  laneIndex > 0 && "portfolio-column--connected",
                )}
              >
                <div className="portfolio-column-heading">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-neutral-50">
                      {lane.label}
                    </div>
                    <div className="truncate text-[10px] text-neutral-500">{lane.subtitle}</div>
                  </div>
                  <div className="shrink-0 text-[10px] text-neutral-500">{lane.capacity}</div>
                </div>
                <div className="portfolio-stream-stack">
                  {lane.streams.map((item, index) => (
                    <WorkstreamCard
                      key={`${item.title}-${index}`}
                      item={item}
                      laneIndex={laneIndex}
                    />
                  ))}
                </div>
                <div className="mt-2 flex min-h-6 flex-wrap items-center gap-1.5">
                  {lane.streams[0]?.badges.map((badge) => (
                    <span
                      key={badge}
                      className="rounded-full border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-[10px] text-neutral-500"
                    >
                      {badge}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title={state.loading ? "Loading company memory" : "No active workstreams"}
            description={
              state.loading
                ? "The Operating Room is reading local BureauOS state."
                : "Send an intake message to create the first client, project, opportunity, and approval trail."
            }
          />
        )}

        <div className="mt-2 flex items-center gap-3 border-t border-neutral-800 pt-2">
          <div className="w-36 text-[11px]">
            <div className="font-semibold text-neutral-50">Capacity Allocation</div>
            <div className="text-neutral-500">Live distribution of team capacity.</div>
          </div>
          <div className="flex-1">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-neutral-800">
              {capacitySegments.map((segment) => (
                <div
                  key={segment.label}
                  className={segment.className}
                  style={{ width: `${segment.width}%` }}
                />
              ))}
            </div>
            <div className="mt-2 grid grid-cols-4 text-[10px] text-neutral-500">
              {capacitySegments.map((segment) => (
                <span key={segment.label}>
                  <span className="text-neutral-300">{segment.label}</span> {segment.value}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CoordinatorPanel({
  onMessage,
}: {
  onMessage: (
    message: string,
    attachments?: CoordinatorAttachmentInput[],
  ) => Promise<CoordinatorChatResult>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef<ChatAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    let cancelled = false;
    Api.coordinatorMessages(50)
      .then((history) => {
        if (cancelled) return;
        setMessages((current) => (current.length > 0 ? current : history));
      })
      .catch(() => {
        // The dashboard-level API error banner covers unavailable servers.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      attachmentsRef.current.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    },
    [],
  );

  const addFiles = (files: FileList | null): void => {
    if (!files) return;
    const added = Array.from(files).map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      file,
      ...(file.type.startsWith("image/") ? { previewUrl: URL.createObjectURL(file) } : {}),
    }));
    setAttachments((current) => [...current, ...added]);
    if (fileInput.current) fileInput.current.value = "";
  };

  const removeAttachment = (id: string): void => {
    setAttachments((current) => {
      const item = current.find((entry) => entry.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return current.filter((entry) => entry.id !== id);
    });
  };

  const submit = async (): Promise<void> => {
    if (busy || (!draft.trim() && attachments.length === 0)) return;
    setBusy(true);
    setError(undefined);
    const submittedAt = new Date().toISOString();
    const messageText = draft.trim();
    const attachmentMeta = attachments.map((item) => ({
      name: item.name,
      size: item.size,
      type: item.type,
    }));
    const optimisticId = `${submittedAt}-owner`;
    setMessages((current) => [
      ...current,
      {
        id: optimisticId,
        role: "owner",
        text: messageText || "Attached files",
        created: submittedAt,
        attachments: attachmentMeta,
      },
    ]);
    try {
      const payload = await Promise.all(
        attachments.map((attachment) => toCoordinatorAttachment(attachment.file)),
      );
      const result = await onMessage(messageText || "Attached files", payload);
      setMessages((current) => [
        ...current.filter((message) => message.id !== optimisticId),
        result.ownerMessage,
        result.coordinatorMessage,
      ]);
      setDraft("");
      setAttachments((current) => {
        current.forEach((item) => {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        });
        return [];
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dashboard-panel">
      <div className="flex items-start justify-between border-b border-neutral-800 px-5 py-4">
        <div>
          <h2 className="text-[13px] font-semibold text-neutral-50">Supreme Coordinator</h2>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-neutral-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
            Online
          </div>
        </div>
        <button className="text-neutral-500">...</button>
      </div>
      <div className="coordinator-chat px-5 py-4">
        <div className="coordinator-thread">
          {messages.length === 0 ? (
            <EmptyState
              title="No coordinator thread yet"
              description="The first owner message will create durable client, project, opportunity, artifact, and approval records."
            />
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={classes(
                  "flex gap-3",
                  message.role === "owner" ? "justify-end" : "justify-start",
                )}
              >
                {message.role === "coordinator" ? (
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-neutral-950 text-[10px] font-semibold text-white">
                    SC
                  </div>
                ) : null}
                <div
                  className={classes(
                    "max-w-[310px] rounded-md px-3 py-2 text-[12px] leading-relaxed",
                    message.role === "owner"
                      ? "bg-neutral-950 text-white"
                      : "border border-neutral-800 bg-neutral-900 text-neutral-300",
                  )}
                >
                  <div className="whitespace-pre-wrap">{message.text}</div>
                  {message.attachments?.length ? (
                    <div className="mt-2 space-y-1 border-t border-white/20 pt-2 text-[10px] opacity-80">
                      {message.attachments.map((item) => (
                        <div key={item.name} className="truncate">
                          {item.name} - {formatBytes(item.size)}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {message.result ? (
                    <div className="mt-3 rounded-md border border-emerald-900 bg-neutral-950 p-3 text-neutral-300">
                      <div className="text-[11px] font-semibold text-neutral-50">
                        {message.result.opportunity.id}
                      </div>
                      <div className="mt-1 text-[12px] font-medium text-neutral-200">
                        {message.result.project.name}
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-neutral-500">
                        <span>{message.result.client.name}</span>
                        <span>{message.result.artifacts.length} artifacts</span>
                        <span>{message.result.approvals.length} approvals</span>
                      </div>
                      {message.result.next_actions.length > 0 ? (
                        <div className="mt-2 text-[10px] text-neutral-500">
                          {message.result.next_actions[0]}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
          {error ? (
            <div className="rounded-md border border-rose-900 bg-rose-950 px-3 py-2 text-[11px] text-rose-400">
              {error}
            </div>
          ) : null}
        </div>

        <div className="coordinator-composer">
          {attachments.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-2">
              {attachments.map((item) => (
                <div key={item.id} className="attachment-chip">
                  {item.previewUrl ? (
                    <img src={item.previewUrl} alt="" className="h-9 w-9 rounded object-cover" />
                  ) : (
                    <div className="grid h-9 w-9 place-items-center rounded bg-neutral-800 text-[10px] text-neutral-500">
                      FILE
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10px] font-medium text-neutral-200">
                      {item.name}
                    </div>
                    <div className="text-[9px] text-neutral-500">{formatBytes(item.size)}</div>
                  </div>
                  <button
                    onClick={() => removeAttachment(item.id)}
                    className="text-[10px] text-neutral-500"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Message BureauOS..."
            className="min-h-20 w-full resize-none bg-transparent text-[12px] text-neutral-100 outline-none placeholder:text-neutral-500"
          />
          <div className="flex items-center justify-between border-t border-neutral-800 pt-2">
            <div className="flex items-center gap-2">
              <input
                ref={fileInput}
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.md,.csv,.json,.doc,.docx"
                className="hidden"
                onChange={(event) => addFiles(event.target.files)}
              />
              <button
                onClick={() => fileInput.current?.click()}
                className="h-7 rounded-md border border-neutral-800 px-2 text-[11px] text-neutral-500 hover:bg-neutral-900"
              >
                + File
              </button>
              <span className="text-[10px] text-neutral-500">images, docs, briefs</span>
            </div>
            <button
              onClick={() => void submit()}
              disabled={busy || (!draft.trim() && attachments.length === 0)}
              className="h-7 rounded-md bg-neutral-950 px-3 text-[11px] font-medium text-white disabled:bg-neutral-700 disabled:text-neutral-500"
            >
              {busy ? "Sending" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function PendingApprovals({
  approvals,
  onResolve,
  onOpen,
}: {
  approvals: ApprovalRecord[];
  onResolve: (id: string, status: "approved" | "rejected") => Promise<void>;
  onOpen: () => void;
}) {
  const visible = approvals.slice(0, 3);
  return (
    <section className="dashboard-panel">
      <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-neutral-50">
          Pending Approvals
          <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-500">
            {visible.length}
          </span>
        </div>
        <button onClick={onOpen} className="text-[10px] text-neutral-500">
          View all
        </button>
      </div>
      <div className="divide-y divide-neutral-800 px-5">
        {visible.length > 0 ? (
          visible.map((approval) => (
            <div
              key={approval.id}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-3"
            >
              <div>
                <div className="text-[12px] font-medium text-neutral-50">{approval.action}</div>
                <div className="mt-1 text-[10px] text-neutral-500">
                  {approval.target} - {approval.scope}
                </div>
              </div>
              <button
                onClick={() => void onResolve(approval.id, "approved")}
                className="h-8 rounded-md bg-emerald-600 px-4 text-[11px] font-medium text-white"
              >
                Approve
              </button>
              <button
                onClick={() => void onResolve(approval.id, "rejected")}
                className="h-8 rounded-md border border-neutral-800 px-4 text-[11px] text-neutral-500"
              >
                Reject
              </button>
            </div>
          ))
        ) : (
          <div className="py-5">
            <EmptyState
              title="No pending approvals"
              description="External commitments and high-risk actions will appear here before execution."
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-neutral-800 px-5 py-4 text-[11px] text-neutral-500">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
        {approvals.length} owner decisions waiting.
      </div>
    </section>
  );
}

function Timeline({ events, artifacts }: { events: AuditEvent[]; artifacts: ArtifactRecord[] }) {
  const visible = events
    .slice(-6)
    .map(
      (event) =>
        [
          event.action,
          event.result,
          event.target ?? "BureauOS",
          event.actor,
          event.result === "ok" ? "green" : "red",
          event.timestamp,
        ] as const,
    );
  const signalReports = artifacts
    .filter((artifact) => artifact.type === "github-signal-report")
    .sort((a, b) => new Date(b.created ?? "").getTime() - new Date(a.created ?? "").getTime())
    .slice(0, 3);
  const failingChecks = signalReports.reduce(
    (sum, report) => sum + (report.failing_checks_count ?? 0),
    0,
  );
  const staleWork = signalReports.reduce(
    (sum, report) =>
      sum + (report.stale_issues_count ?? 0) + (report.stale_pull_requests_count ?? 0),
    0,
  );

  return (
    <section className="dashboard-panel">
      <div className="flex items-start justify-between border-b border-neutral-800 px-6 py-4">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-50">Live Operations Timeline</h2>
          <p className="mt-1 text-[11px] text-neutral-500">
            Real-time autonomous activity across the company.
          </p>
        </div>
        <button className="text-[10px] text-neutral-500">View all activity</button>
      </div>
      {visible.length > 0 ? (
        <div className="timeline-strip px-6 py-5">
          {visible.map((event, index) => (
            <div key={`${event[0]}-${index}`} className="timeline-event">
              <span
                className={classes(
                  "timeline-dot",
                  event[4] === "red" ? "bg-rose-600" : "bg-emerald-600",
                )}
              />
              <div className="text-[10px] text-neutral-500">{timeAgo(event[5])}</div>
              <div className="mt-1 text-[11px] font-semibold text-neutral-50">{event[0]}</div>
              <div className="text-[10px] text-neutral-500">{event[1]}</div>
              <div className="mt-1 text-[10px] text-neutral-500">{event[3]}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-6 py-5">
          <EmptyState
            title="No live operations yet"
            description="Audit events, intake runs, approvals, GitHub signals, and report generation will stream here."
          />
        </div>
      )}
      {signalReports.length > 0 ? (
        <div className="grid grid-cols-[150px_1fr] gap-4 border-t border-neutral-800 px-6 py-4">
          <div>
            <div className="text-[11px] font-semibold text-neutral-50">GitHub Signals</div>
            <div className="mt-1 text-[10px] text-neutral-500">
              {failingChecks} failing checks, {staleWork} stale items
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {signalReports.map((report) => (
              <div key={report.id} className="rounded-md border border-neutral-800 p-2">
                <div className="truncate text-[10px] font-medium text-neutral-50">
                  {report.repository ?? "GitHub"}
                </div>
                <div className="mt-1 text-[10px] text-neutral-500">
                  {report.github_event ?? "sync"}
                  {report.github_action ? `:${report.github_action}` : ""}
                </div>
                <div className="mt-2 flex gap-2 text-[10px] text-neutral-500">
                  <span>PR {report.pull_requests_count ?? 0}</span>
                  <span>CI {report.checks_count ?? 0}</span>
                  <span className={report.failing_checks_count ? "text-rose-400" : ""}>
                    Fail {report.failing_checks_count ?? 0}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function RevenuePulse({
  pulse,
  clients,
  opportunities,
  onGenerateReport,
}: {
  pulse?: CompanyPulse;
  clients: ClientRecord[];
  opportunities: OpportunityRecord[];
  onGenerateReport: () => Promise<BusinessReportResult>;
}) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<BusinessReportResult | undefined>();
  const pipeline = pulse?.revenue.pipeline_value ?? 0;
  const active = pulse?.revenue.active_opportunities ?? 0;
  const margin = opportunities.length
    ? opportunities.reduce((sum, item) => sum + (item.expected_margin || 0), 0) /
      opportunities.length
    : 0;
  const won = opportunities
    .filter((item) => item.status === "won")
    .reduce((sum, item) => sum + (item.expected_value || 0), 0);
  const topClients = clients
    .map((client) => ({
      client,
      value: opportunities
        .filter((item) => item.client_id === client.id)
        .reduce((sum, item) => sum + (item.expected_value || 0), 0),
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);

  const generate = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      setReport(await onGenerateReport());
    } finally {
      setBusy(false);
    }
  };

  const cards = [
    ["Pipeline Value", formatMoney(pipeline), `${opportunities.length} total opportunities`],
    ["Expected Margin", `${Math.round(margin)}%`, "Average expected margin"],
    ["Active Opportunities", String(active), "Not won or lost"],
    ["Won Revenue", formatMoney(won), "Closed won opportunity value"],
    ["Clients With Pipeline", String(topClients.length), `${clients.length} clients total`],
  ] as const;

  return (
    <section className="dashboard-panel">
      <div className="grid grid-cols-[150px_1fr_210px] gap-4 p-4">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-50">Revenue Pulse</h2>
          <p className="mt-1 text-[11px] text-neutral-500">
            Real-time revenue and pipeline health.
          </p>
          <button
            onClick={() => void generate()}
            disabled={busy}
            className="mt-5 text-[11px] font-medium text-neutral-500 disabled:text-neutral-300"
          >
            {busy ? "Generating" : "View full report"}
          </button>
          {report ? (
            <div className="mt-2 text-[10px] text-emerald-400">
              Portfolio report {report.cross_project_report.id} generated
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-5 gap-3">
          {cards.map((card) => (
            <div key={card[0]} className="rounded-md border border-neutral-800 p-3">
              <div className="text-[10px] text-neutral-500">{card[0]}</div>
              <div className="mt-2 text-xl font-semibold text-neutral-50">{card[1]}</div>
              <div className="mt-2 text-[10px] text-emerald-400">{card[2]}</div>
            </div>
          ))}
        </div>
        <div className="rounded-md border border-neutral-800 p-3">
          <div className="text-[10px] font-semibold text-neutral-50">Top Clients by LTV</div>
          {topClients.length > 0 ? (
            topClients.map((item, index) => (
              <div
                key={item.client.id}
                className="mt-2 flex justify-between text-[10px] text-neutral-500"
              >
                <span>
                  {index + 1}. {item.client.name}
                </span>
                <span>{formatMoney(item.value)}</span>
              </div>
            ))
          ) : (
            <div className="mt-3 text-[10px] text-neutral-500">No client revenue yet</div>
          )}
        </div>
      </div>
    </section>
  );
}

function AgentLayer({ agents }: { agents: AgentDefinition[] }) {
  const visible = agents.slice(0, 11).map((agent) => [agentAbbr(agent.role), agent.role] as const);
  return (
    <section className="h-[52px] border-t border-neutral-800 bg-neutral-950">
      <div className="grid h-full grid-cols-[170px_1fr_120px] items-center gap-4 px-5">
        <div>
          <div className="text-[13px] font-semibold text-neutral-50">Agent Layer</div>
          <div className="mt-1 text-[10px] text-neutral-500">
            Autonomous teams executing across functions.
          </div>
        </div>
        <div className="flex gap-2 overflow-hidden">
          {visible.length > 0 ? (
            visible.map(([abbr, label]) => (
              <div key={label} className="agent-pill">
                <span className="grid h-6 w-6 place-items-center rounded-md border border-neutral-800 bg-neutral-900 text-[9px] font-semibold text-neutral-300">
                  {abbr}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-medium text-neutral-50">{abbr}</div>
                  <div className="truncate text-[9px] text-neutral-500">{label}</div>
                </div>
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-600" />
              </div>
            ))
          ) : (
            <div className="text-[11px] text-neutral-500">No agents loaded</div>
          )}
        </div>
        <button className="h-9 rounded-md border border-neutral-800 text-[11px] text-neutral-500">
          Manage Agents
        </button>
      </div>
    </section>
  );
}

function TodayView({ state }: { state: DashboardState }) {
  const blocked = state.projects.filter((project) => project.status === "blocked").length;
  return (
    <SectionShell title="Today" description="A real operating view of what needs attention now.">
      <div className="grid grid-cols-3 gap-4">
        <MetricTile
          label="Approvals waiting"
          value={String(state.approvals.length)}
          detail="Owner gates"
        />
        <MetricTile label="Blocked work" value={String(blocked)} detail="Project status blocked" />
        <MetricTile label="Runs" value={String(state.runs.length)} detail="All persisted runs" />
      </div>
      <div className="mt-5 divide-y divide-neutral-800 rounded-md border border-neutral-800">
        {sortNewest(state.runs)
          .slice(0, 8)
          .map((run) => (
            <div
              key={run.id}
              className="grid grid-cols-[120px_1fr_120px] items-center gap-4 px-4 py-3 text-[11px]"
            >
              <span className="font-medium text-neutral-50">{formatLabel(run.type)}</span>
              <span className="truncate text-neutral-500">{run.scope}</span>
              <StatusPill
                value={formatLabel(run.status)}
                tone={
                  run.status === "completed"
                    ? "green"
                    : run.status === "needs_human"
                      ? "amber"
                      : "muted"
                }
              />
            </div>
          ))}
        {state.runs.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No runs yet"
              description="Coordinator intake, scheduled jobs, and GitHub signals will create runs here."
            />
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}

function GoalsView({ state }: { state: DashboardState }) {
  const total = state.opportunities.reduce((sum, item) => sum + (item.expected_value || 0), 0);
  return (
    <SectionShell
      title="Goals"
      description="Company goals derived from current portfolio, not static example numbers."
    >
      <div className="grid grid-cols-3 gap-4">
        <MetricTile
          label="Pipeline"
          value={formatMoney(total)}
          detail="Expected opportunity value"
        />
        <MetricTile
          label="Active clients"
          value={String(state.clients.filter((client) => client.status === "active").length)}
          detail={`${state.clients.length} clients tracked`}
        />
        <MetricTile
          label="Run completion"
          value={`${completedRunCoverage(state.runs)}%`}
          detail="Completed over total runs"
        />
      </div>
    </SectionShell>
  );
}

function RevenueWorkspace({ state }: { state: DashboardState }) {
  const pipeline = state.opportunities.reduce((sum, item) => sum + (item.expected_value || 0), 0);
  return (
    <SectionShell title="Revenue" description="Pipeline, opportunity quality, and proposal state.">
      <div className="grid grid-cols-3 gap-4">
        <MetricTile label="Pipeline" value={formatMoney(pipeline)} detail="Expected value" />
        <MetricTile
          label="Opportunities"
          value={String(state.opportunities.length)}
          detail={`${state.pulse?.revenue.active_opportunities ?? 0} active`}
        />
        <MetricTile
          label="Average margin"
          value={`${Math.round(
            state.opportunities.length
              ? state.opportunities.reduce((sum, item) => sum + (item.expected_margin || 0), 0) /
                  state.opportunities.length
              : 0,
          )}%`}
          detail="Expected margin"
        />
      </div>
      <div className="mt-5 divide-y divide-neutral-800 rounded-md border border-neutral-800">
        {sortNewest(state.opportunities)
          .slice(0, 8)
          .map((opportunity) => (
            <div
              key={opportunity.id}
              className="grid grid-cols-[1fr_110px_110px_130px] items-center gap-4 px-4 py-3 text-[11px]"
            >
              <div>
                <div className="font-medium text-neutral-50">{opportunity.title}</div>
                <div className="mt-1 text-neutral-500">
                  {clientName(state.clients, opportunity.client_id)}
                </div>
              </div>
              <span>{formatMoney(opportunity.expected_value || 0)}</span>
              <span>{Math.round(opportunity.expected_margin || 0)}%</span>
              <StatusPill
                value={formatLabel(opportunity.status)}
                tone={opportunityTone(opportunity.status)}
              />
            </div>
          ))}
        {state.opportunities.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No opportunities yet"
              description="Client opportunities created by the coordinator will appear here."
            />
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}

function DeliveryWorkspace({ state }: { state: DashboardState }) {
  return (
    <SectionShell
      title="Delivery"
      description="Projects, repositories, status, and team execution."
    >
      <div className="grid grid-cols-3 gap-4">
        <MetricTile
          label="Projects"
          value={String(state.projects.length)}
          detail="Tracked delivery streams"
        />
        <MetricTile
          label="Blocked"
          value={String(state.projects.filter((project) => project.status === "blocked").length)}
          detail="Needs intervention"
        />
        <MetricTile
          label="Repos linked"
          value={String(state.projects.filter((project) => project.repository).length)}
          detail="GitHub native execution"
        />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        {sortNewest(state.projects).map((project) => (
          <div key={project.id} className="rounded-md border border-neutral-800 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold text-neutral-50">{project.name}</div>
                <div className="mt-1 text-[11px] text-neutral-500">
                  {clientName(state.clients, project.client_id)}
                </div>
              </div>
              <StatusPill value={formatLabel(project.status)} tone={projectTone(project.status)} />
            </div>
            <div className="mt-3 text-[11px] text-neutral-500">
              {project.stack || "Stack not set"}
            </div>
            <div className="mt-2 truncate text-[10px] text-neutral-500">
              {project.repository || "Repository pending"}
            </div>
          </div>
        ))}
        {state.projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            description="The coordinator creates a project when you describe a client job."
          />
        ) : null}
      </div>
    </SectionShell>
  );
}

function GrowthWorkspace({ state }: { state: DashboardState }) {
  const growthArtifacts = state.artifacts.filter((artifact) =>
    ["social-post-brief", "ad-campaign-brief", "creative-brief", "campaign-brief"].includes(
      artifact.type,
    ),
  );
  return (
    <SectionShell
      title="Growth"
      description="Draft-first marketing, content, social, and ads assets."
    >
      <div className="grid grid-cols-3 gap-4">
        <MetricTile
          label="Growth artifacts"
          value={String(growthArtifacts.length)}
          detail="Draft assets"
        />
        <MetricTile
          label="Opportunities"
          value={String(state.opportunities.length)}
          detail="Commercial pipeline"
        />
        <MetricTile
          label="Approvals"
          value={String(state.approvals.length)}
          detail="External action gates"
        />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3">
        {growthArtifacts.slice(0, 6).map((artifact) => (
          <div key={artifact.id} className="rounded-md border border-neutral-800 p-4">
            <div className="text-[11px] font-semibold text-neutral-50">
              {formatLabel(artifact.type)}
            </div>
            <div className="mt-2 text-[10px] text-neutral-500">{artifact.id}</div>
            <div className="mt-3 text-[10px] text-neutral-500">
              {artifact.created ? timeAgo(artifact.created) : "created"}
            </div>
          </div>
        ))}
        {growthArtifacts.length === 0 ? (
          <EmptyState
            title="No growth drafts yet"
            description="Social, ads, and creative drafts are generated from intake and reports."
          />
        ) : null}
      </div>
    </SectionShell>
  );
}

function ClientsWorkspace({ state }: { state: DashboardState }) {
  return (
    <SectionShell
      title="Clients"
      description="Client memory, project history, and commercial value."
    >
      <div className="grid grid-cols-3 gap-4">
        <MetricTile label="Clients" value={String(state.clients.length)} detail="Memory profiles" />
        <MetricTile
          label="Active"
          value={String(state.clients.filter((client) => client.status === "active").length)}
          detail="Active status"
        />
        <MetricTile
          label="Industries"
          value={String(new Set(state.clients.map((client) => client.industry)).size)}
          detail="Distinct categories"
        />
      </div>
      <div className="mt-5 divide-y divide-neutral-800 rounded-md border border-neutral-800">
        {state.clients.map((client) => (
          <div
            key={client.id}
            className="grid grid-cols-[1fr_120px_120px_140px] items-center gap-4 px-4 py-3 text-[11px]"
          >
            <div>
              <div className="font-medium text-neutral-50">{client.name}</div>
              <div className="mt-1 text-neutral-500">{client.slug}</div>
            </div>
            <span>{client.industry}</span>
            <StatusPill
              value={formatLabel(client.status)}
              tone={client.status === "active" ? "green" : "muted"}
            />
            <span className="text-neutral-500">
              {state.projects.filter((project) => project.client_id === client.id).length} projects
            </span>
          </div>
        ))}
        {state.clients.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No clients yet"
              description="A client memory profile is created from the coordinator intake."
            />
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}

function RiskWorkspace({ state }: { state: DashboardState }) {
  const blocked = state.projects.filter((project) => project.status === "blocked");
  return (
    <SectionShell
      title="Risk"
      description="Approvals, blocked work, and policy-controlled execution."
    >
      <div className="grid grid-cols-3 gap-4">
        <MetricTile
          label="Pending approvals"
          value={String(state.approvals.length)}
          detail="Owner review required"
        />
        <MetricTile
          label="Blocked projects"
          value={String(blocked.length)}
          detail="Delivery risk"
        />
        <MetricTile
          label="Failed runs"
          value={String(state.runs.filter((run) => run.status === "failed").length)}
          detail="Needs triage"
        />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        {[...state.approvals, ...blocked].slice(0, 8).map((item) => (
          <div key={item.id} className="rounded-md border border-neutral-800 p-4">
            <div className="text-[12px] font-semibold text-neutral-50">
              {"action" in item ? item.action : item.name}
            </div>
            <div className="mt-2 text-[11px] text-neutral-500">
              {"scope" in item ? item.scope : clientName(state.clients, item.client_id)}
            </div>
          </div>
        ))}
        {state.approvals.length === 0 && blocked.length === 0 ? (
          <EmptyState
            title="No active risk"
            description="Policy gates and blocked project signals will appear here."
          />
        ) : null}
      </div>
    </SectionShell>
  );
}

function approvalTone(status: string): Tone {
  if (status === "approved") return "green";
  if (status === "rejected" || status === "expired") return "red";
  if (status === "pending") return "amber";
  return "muted";
}

function ApprovalsWorkspace({
  state,
  onResolve,
}: {
  state: DashboardState;
  onResolve: (id: string, status: "approved" | "rejected") => Promise<void>;
}) {
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const allApprovals = [...state.approvals, ...state.resolvedApprovals];
  const visible = allApprovals
    .filter((approval) => filter === "all" || approval.status === filter)
    .sort((a, b) => (b.updated ?? b.created ?? "").localeCompare(a.updated ?? a.created ?? ""));
  const approved = state.resolvedApprovals.filter((approval) => approval.status === "approved");
  const rejected = state.resolvedApprovals.filter((approval) => approval.status === "rejected");

  return (
    <SectionShell
      title="Approvals"
      description="Owner decisions, external action gates, and resolved approval history."
    >
      <div className="grid grid-cols-4 gap-4">
        <MetricTile
          label="Pending"
          value={String(state.approvals.length)}
          detail="Waiting for owner"
        />
        <MetricTile label="Approved" value={String(approved.length)} detail="Resolved allowed" />
        <MetricTile label="Rejected" value={String(rejected.length)} detail="Resolved blocked" />
        <MetricTile
          label="Total"
          value={String(allApprovals.length)}
          detail="Pending and history"
        />
      </div>
      <div className="mt-5 flex gap-2">
        {(["pending", "approved", "rejected", "all"] as const).map((item) => (
          <button
            key={item}
            onClick={() => setFilter(item)}
            className={classes(
              "h-8 rounded-md border px-3 text-[11px]",
              filter === item
                ? "border-neutral-700 bg-neutral-900 text-neutral-100"
                : "border-neutral-800 text-neutral-500",
            )}
          >
            {formatLabel(item)}
          </button>
        ))}
      </div>
      <div className="mt-4 overflow-hidden rounded-md border border-neutral-800">
        <div className="grid grid-cols-[160px_100px_1fr_110px_150px_170px] bg-neutral-900 px-4 py-2 text-[10px] font-semibold uppercase text-neutral-500">
          <span>Action</span>
          <span>Status</span>
          <span>Scope</span>
          <span>Actor</span>
          <span>Updated</span>
          <span />
        </div>
        {visible.map((approval) => (
          <div
            key={approval.id}
            className="grid grid-cols-[160px_100px_1fr_110px_150px_170px] items-center gap-3 border-t border-neutral-800 px-4 py-3 text-[11px]"
          >
            <div className="min-w-0">
              <div className="truncate font-medium text-neutral-50">{approval.action}</div>
              <div className="mt-1 truncate text-[10px] text-neutral-600">{approval.id}</div>
            </div>
            <StatusPill value={formatLabel(approval.status)} tone={approvalTone(approval.status)} />
            <div className="min-w-0">
              <div className="truncate text-neutral-400">{approval.scope}</div>
              <div className="mt-1 truncate text-[10px] text-neutral-600">{approval.target}</div>
            </div>
            <span className="truncate text-neutral-500">{approval.actor}</span>
            <div className="text-neutral-500">
              {approval.updated ? timeAgo(approval.updated) : "unknown"}
              {approval.resolved_by ? (
                <div className="mt-1 text-[10px] text-neutral-600">{approval.resolved_by}</div>
              ) : null}
            </div>
            {approval.status === "pending" ? (
              <div className="flex gap-2">
                <button
                  onClick={() => void onResolve(approval.id, "approved")}
                  className="h-8 rounded-md bg-emerald-600 px-3 text-[10px] font-medium text-white"
                >
                  Approve
                </button>
                <button
                  onClick={() => void onResolve(approval.id, "rejected")}
                  className="h-8 rounded-md border border-neutral-800 px-3 text-[10px] text-neutral-500"
                >
                  Reject
                </button>
              </div>
            ) : (
              <span className="truncate text-[10px] text-neutral-600">
                {approval.reason || approval.resolved_at || "Resolved"}
              </span>
            )}
          </div>
        ))}
        {visible.length === 0 ? (
          <div className="border-t border-neutral-800 p-5">
            <EmptyState
              title="No approvals in this view"
              description="Policy gates appear here before BureauOS performs sensitive actions."
            />
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}

function MemoryWorkspace({ state }: { state: DashboardState }) {
  return (
    <SectionShell title="Memory" description="The durable company memory written by the kernel.">
      <div className="grid grid-cols-4 gap-3">
        <MetricTile label="Clients" value={String(state.clients.length)} detail="Profiles" />
        <MetricTile
          label="Projects"
          value={String(state.projects.length)}
          detail="Project memories"
        />
        <MetricTile
          label="Artifacts"
          value={String(state.artifacts.length)}
          detail="Generated records"
        />
        <MetricTile
          label="Audit events"
          value={String(state.audit.length)}
          detail="Recent stream"
        />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3">
        {sortNewest(state.artifacts)
          .slice(0, 9)
          .map((artifact) => (
            <div key={artifact.id} className="rounded-md border border-neutral-800 p-4">
              <div className="truncate text-[11px] font-semibold text-neutral-50">
                {artifact.id}
              </div>
              <div className="mt-2 text-[10px] text-neutral-500">{formatLabel(artifact.type)}</div>
              <div className="mt-3 text-[10px] text-neutral-500">
                {artifact.created ? timeAgo(artifact.created) : "created"}
              </div>
            </div>
          ))}
        {state.artifacts.length === 0 ? (
          <EmptyState
            title="No artifacts yet"
            description="Reports, briefs, dispatch packets, and GitHub signal reports will appear here."
          />
        ) : null}
      </div>
    </SectionShell>
  );
}

function AgentsWorkspace({ state }: { state: DashboardState }) {
  const configured = state.capabilities.filter(
    (capability) => capability.status === "configured" || capability.status === "available",
  ).length;
  const highRisk = state.capabilities.filter(
    (capability) => capability.risk_class === "high" || capability.risk_class === "critical",
  ).length;
  const assignedTo = (agentId: string): CapabilityDefinition[] =>
    state.capabilities.filter(
      (capability) =>
        capability.allowed_agents.includes(agentId) || capability.allowed_agents.includes("*"),
    );
  const enabledActions = (capability: CapabilityDefinition): string[] =>
    Object.entries(capability.actions)
      .filter(([, enabled]) => enabled)
      .map(([action]) => action);

  return (
    <SectionShell title="Agents" description="The autonomous organization and role boundaries.">
      <div className="grid grid-cols-3 gap-4">
        <MetricTile label="Agents" value={String(state.agents.length)} detail="Role contracts" />
        <MetricTile
          label="Capabilities"
          value={String(state.capabilities.length)}
          detail={`${configured} configured or available`}
        />
        <MetricTile label="High risk" value={String(highRisk)} detail="Approval-sensitive tools" />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3">
        {state.agents.map((agent) => (
          <div key={agent.id} className="rounded-md border border-neutral-800 p-4">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-md bg-neutral-950 text-[10px] font-semibold text-white">
                {agentAbbr(agent.role)}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-neutral-50">
                  {agent.role}
                </div>
                <div className="text-[10px] text-neutral-500">{agent.category}</div>
              </div>
            </div>
            <p className="mt-3 line-clamp-3 text-[11px] leading-relaxed text-neutral-500">
              {agent.description}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {assignedTo(agent.id)
                .slice(0, 4)
                .map((capability) => (
                  <span
                    key={capability.id}
                    className="rounded border border-neutral-800 px-2 py-1 text-[9px] text-neutral-400"
                    title={`${capability.name}: ${
                      enabledActions(capability).join(", ") || "no enabled actions"
                    }`}
                  >
                    {capability.id}
                  </span>
                ))}
              {assignedTo(agent.id).length === 0 ? (
                <span className="text-[10px] text-neutral-600">No capability assigned</span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 divide-y divide-neutral-800 rounded-md border border-neutral-800">
        {state.capabilities.map((capability) => (
          <div
            key={capability.id}
            className="grid grid-cols-[170px_90px_90px_1fr_160px] items-center gap-4 px-4 py-3 text-[11px]"
          >
            <div>
              <div className="font-medium text-neutral-50">{capability.name}</div>
              <div className="mt-1 text-[10px] text-neutral-500">{capability.id}</div>
            </div>
            <span className="text-neutral-500">{capability.type}</span>
            <StatusPill
              value={capability.status}
              tone={
                capability.status === "blocked"
                  ? "red"
                  : capability.status === "configured"
                    ? "green"
                    : "muted"
              }
            />
            <span className="truncate text-neutral-500">
              {enabledActions(capability).join(", ") || "No enabled actions"}
            </span>
            <span className="truncate text-neutral-500">
              {capability.required_approvals.length
                ? capability.required_approvals.join(", ")
                : "No approval gate"}
            </span>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

function ReportsWorkspace({ state }: { state: DashboardState }) {
  const reports = state.artifacts.filter((artifact) =>
    [
      "executive-report",
      "cross-project-executive-report",
      "business-operating-report",
      "client-account-plan",
    ].includes(artifact.type),
  );
  return (
    <SectionShell
      title="Reports"
      description="Executive, cross-project, and business reports generated from current registries."
    >
      <div className="grid grid-cols-3 gap-3">
        {sortNewest(reports).map((artifact) => (
          <div key={artifact.id} className="rounded-md border border-neutral-800 p-4">
            <div className="text-[11px] font-semibold text-neutral-50">
              {formatLabel(artifact.type)}
            </div>
            <div className="mt-2 truncate text-[10px] text-neutral-500">{artifact.id}</div>
            <div className="mt-3 text-[10px] text-neutral-500">
              {artifact.created ? timeAgo(artifact.created) : "created"}
            </div>
          </div>
        ))}
        {reports.length === 0 ? (
          <EmptyState
            title="No reports yet"
            description="Generate a business report from the Revenue Pulse panel."
          />
        ) : null}
      </div>
    </SectionShell>
  );
}

function SettingsView({
  settings,
  providers,
  providerConnectors,
  onProviderLogin,
  onProviderLogout,
  onRefresh,
}: {
  settings?: SettingsSummary;
  providers: ProviderConnection[];
  providerConnectors: ProviderConnector[];
  onProviderLogin: (input: {
    provider: string;
    mode?: "oauth" | "api-key" | "local";
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    baseUrl?: string;
    defaultModel?: string;
  }) => Promise<void>;
  onProviderLogout: (provider: string, id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [provider, setProvider] = useState("openai-codex");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [oauthCode, setOauthCode] = useState("");
  const [oauthAuthorization, setOauthAuthorization] = useState<
    ProviderAuthAuthorization | undefined
  >();
  const [oauthStatus, setOauthStatus] = useState<string | undefined>();
  const [modelList, setModelList] = useState<ProviderModelList | undefined>();
  const [busy, setBusy] = useState(false);
  const connector = providerConnectors.find((item) => item.id === provider);
  const connectedProvider = providers.find((item) => item.provider === provider);
  const mode =
    connector?.defaultAuthMode ??
    (provider === "openai-codex" ? "oauth" : provider === "local" ? "local" : "api-key");
  const authMethod = connector?.authMethods[0];
  const requiresApiKey = authMethod?.type === "api";
  const requiresBaseUrl = connector?.requiresBaseUrl || provider === "custom";
  const modelChoices = useMemo(() => {
    const seen = new Set<string>();
    return [
      ...(modelList?.models ?? []),
      ...(connector?.models ?? []),
      ...(connectedProvider?.default_model
        ? [{ id: connectedProvider.default_model, name: connectedProvider.default_model }]
        : []),
    ].filter((model) => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });
  }, [connector?.models, connectedProvider?.default_model, modelList?.models]);

  useEffect(() => {
    let cancelled = false;
    const fallback = connector
      ? {
          provider,
          source: "connector" as const,
          defaultModel: connectedProvider?.default_model || connector.defaultModel,
          models: connector.models,
        }
      : undefined;
    setModelList(fallback);
    const nextDefault = connectedProvider?.default_model || fallback?.defaultModel || "";
    setDefaultModel(nextDefault);

    Api.providerModels(provider)
      .then((models) => {
        if (cancelled) return;
        setModelList(models);
        setDefaultModel(models.defaultModel || models.models[0]?.id || "");
      })
      .catch(() => {
        if (cancelled || !fallback) return;
        setModelList(fallback);
      });

    return () => {
      cancelled = true;
    };
  }, [connector, connectedProvider?.default_model, provider]);

  const openAuthorizationUrl = async (url: string): Promise<void> => {
    if (window.bureau) {
      await window.bureau.openExternal(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const startOpenAICodexOAuth = async (): Promise<void> => {
    setOauthStatus("Opening OpenAI authorization...");
    const authorization = await Api.providerOAuthAuthorize("openai-codex");
    setOauthAuthorization(authorization);
    await openAuthorizationUrl(authorization.url);

    if (authorization.method === "code") {
      setOauthStatus(authorization.instructions);
      return;
    }

    setOauthStatus("Waiting for browser authorization...");
    const result = await Api.providerOAuthCallback("openai-codex", {
      method: 0,
      ...(defaultModel.trim() ? { defaultModel: defaultModel.trim() } : {}),
    });
    if (result.status !== "connected") {
      setOauthStatus("Authorization is still pending. Paste the final redirect URL to complete.");
      return;
    }
    setOauthStatus("OpenAI Codex OAuth connected.");
    setOauthAuthorization(undefined);
    setOauthCode("");
    setDefaultModel("");
    await onRefresh();
  };

  const completeOpenAICodexOAuth = async (): Promise<void> => {
    if (!oauthCode.trim()) return;
    setOauthStatus("Completing OpenAI Codex OAuth...");
    const result = await Api.providerOAuthCallback("openai-codex", {
      method: 0,
      code: oauthCode.trim(),
      ...(defaultModel.trim() ? { defaultModel: defaultModel.trim() } : {}),
    });
    if (result.status !== "connected") {
      setOauthStatus("Authorization is still pending.");
      return;
    }
    setOauthStatus("OpenAI Codex OAuth connected.");
    setOauthAuthorization(undefined);
    setOauthCode("");
    setDefaultModel("");
    await onRefresh();
  };

  const connect = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      if (provider === "openai-codex") {
        await startOpenAICodexOAuth();
        return;
      }
      await onProviderLogin({
        provider,
        mode,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(defaultModel.trim() ? { defaultModel: defaultModel.trim() } : {}),
      });
      setApiKey("");
      setBaseUrl("");
      setDefaultModel("");
      setOauthStatus(undefined);
      setOauthAuthorization(undefined);
      setOauthCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dashboard-panel p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-50">Settings</h2>
          <p className="mt-1 text-[11px] text-neutral-500">Provider authentication and routing.</p>
        </div>
        <div className="flex gap-2">
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            className="h-9 rounded-md border border-neutral-800 bg-neutral-950 px-3 text-[11px] text-neutral-100 outline-none focus:border-neutral-700"
          >
            {providerConnectors.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {requiresApiKey ? (
            <input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              className="h-9 rounded-md border border-neutral-800 bg-neutral-950 px-3 text-[11px] text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-neutral-700"
              placeholder="API key"
              type="password"
            />
          ) : null}
          {requiresBaseUrl ? (
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              className="h-9 rounded-md border border-neutral-800 bg-neutral-950 px-3 text-[11px] text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-neutral-700"
              placeholder="Base URL"
            />
          ) : null}
          <select
            value={defaultModel}
            onChange={(event) => setDefaultModel(event.target.value)}
            className="h-9 min-w-36 rounded-md border border-neutral-800 bg-neutral-950 px-3 text-[11px] text-neutral-100 outline-none focus:border-neutral-700"
          >
            {modelChoices.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name || model.id}
              </option>
            ))}
          </select>
          <button
            onClick={() => void connect()}
            disabled={busy}
            className="h-9 rounded-md bg-neutral-950 px-4 text-[11px] font-medium text-white"
          >
            {mode === "oauth" ? "Connect OAuth" : "Connect"}
          </button>
        </div>
      </div>
      {connector ? (
        <div className="mt-4 rounded-md border border-neutral-800 bg-neutral-950 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold text-neutral-50">{connector.name}</div>
              <div className="mt-1 text-[11px] text-neutral-500">{connector.description}</div>
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-neutral-500">
                <span className="rounded border border-neutral-800 px-2 py-1">
                  {connector.source === "config" ? "Config override" : "Built-in connector"}
                </span>
                <span className="rounded border border-neutral-800 px-2 py-1">
                  Default {connector.defaultModel}
                </span>
                <span className="rounded border border-neutral-800 px-2 py-1">
                  {connector.models.length} models
                </span>
                {modelList ? (
                  <span className="rounded border border-neutral-800 px-2 py-1">
                    Models from {modelList.source}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="text-right text-[10px] uppercase tracking-[0.08em] text-neutral-600">
              {connector.authMethods.map((method) => method.label).join(" / ")}
            </div>
          </div>
          {connector.noApiFallback ? (
            <div className="mt-3 text-[11px] text-neutral-500">
              This connector is isolated from API-key providers and never falls back to API auth.
            </div>
          ) : null}
        </div>
      ) : null}
      {settings ? (
        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-md border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-[10px] uppercase tracking-[0.08em] text-neutral-600">
              Workspace
            </div>
            <div className="mt-2 text-[13px] font-semibold text-neutral-50">
              {settings.organization.name}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-neutral-500">
              <span>Preset {settings.setup.preset}</span>
              <span>Mode {settings.setup.mode}</span>
              <span>Interface {settings.interface.mode}</span>
              <span>{settings.interface.mobile_first ? "Mobile-first" : "Desktop-first"}</span>
            </div>
            <div className="mt-3 truncate text-[10px] text-neutral-600">{settings.config_path}</div>
          </div>
          <div className="rounded-md border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-[10px] uppercase tracking-[0.08em] text-neutral-600">
              Supreme Coordinator
            </div>
            <div className="mt-2 text-[13px] font-semibold text-neutral-50">
              {settings.supreme_coordinator.provider}
            </div>
            <div className="mt-2 text-[11px] text-neutral-500">
              Model {settings.supreme_coordinator.model}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-neutral-500">
              <span className="rounded border border-neutral-800 px-2 py-1">
                {settings.supreme_coordinator.user_facing ? "Owner-facing" : "Internal only"}
              </span>
              <span className="rounded border border-neutral-800 px-2 py-1">
                {settings.supreme_coordinator.always_on ? "Always-on" : "Manual"}
              </span>
            </div>
          </div>
          <div className="rounded-md border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-[10px] uppercase tracking-[0.08em] text-neutral-600">
              Organization
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-neutral-500">
              <span>{settings.agents.roles} agent roles</span>
              <span>{settings.agents.configured} configured</span>
              <span>{settings.capabilities.catalog} capabilities</span>
              <span>{settings.providers.connectors} providers</span>
            </div>
            <div className="mt-3 text-[10px] text-neutral-600">
              Overrides: {settings.providers.configured_overrides.join(", ") || "none"}
            </div>
          </div>
          <div className="rounded-md border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-[10px] uppercase tracking-[0.08em] text-neutral-600">Autonomy</div>
            <div className="mt-2 text-[13px] font-semibold text-neutral-50">
              {enabledCount(settings.autonomy)} / {Object.keys(settings.autonomy).length} enabled
            </div>
            <div className="mt-2 space-y-1 text-[10px] text-neutral-500">
              {Object.entries(settings.autonomy).map(([key, value]) => (
                <div key={key} className="flex justify-between gap-2">
                  <span className="truncate">{formatLabel(key)}</span>
                  <span className={value ? "text-emerald-400" : "text-neutral-600"}>
                    {value ? "on" : "off"}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-[10px] uppercase tracking-[0.08em] text-neutral-600">
              Growth Policy
            </div>
            <div className="mt-2 text-[13px] font-semibold text-neutral-50">
              {enabledCount(settings.growth_autonomy)} /{" "}
              {Object.keys(settings.growth_autonomy).length} enabled
            </div>
            <div className="mt-2 space-y-1 text-[10px] text-neutral-500">
              {Object.entries(settings.growth_autonomy)
                .slice(0, 8)
                .map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-2">
                    <span className="truncate">{formatLabel(key)}</span>
                    <span className={value ? "text-emerald-400" : "text-neutral-600"}>
                      {value ? "on" : "off"}
                    </span>
                  </div>
                ))}
            </div>
          </div>
          <div className="rounded-md border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-[10px] uppercase tracking-[0.08em] text-neutral-600">
              Limits & Signals
            </div>
            <div className="mt-2 space-y-1 text-[10px] text-neutral-500">
              <div className="flex justify-between gap-2">
                <span>Retries</span>
                <span>{settings.limits.max_retries_per_task}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Files before review</span>
                <span>{settings.limits.max_files_changed_without_human_review}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Stale PR hours</span>
                <span>{settings.triggers.thresholds.stale_pr_hours}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Blocked issue hours</span>
                <span>{settings.triggers.thresholds.blocked_issue_hours}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Memory global access</span>
                <span
                  className={
                    settings.memory.coordinator_has_global_access
                      ? "text-emerald-400"
                      : "text-neutral-600"
                  }
                >
                  {settings.memory.coordinator_has_global_access ? "on" : "off"}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {provider === "openai-codex" ? (
        <div className="mt-4 rounded-md border border-neutral-800 bg-neutral-950 p-4">
          <div className="text-[11px] font-semibold text-neutral-50">
            OpenAI Codex uses browser OAuth only.
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">
            This connection is separate from OpenAI API keys and never falls back to API auth.
          </div>
          {oauthStatus ? (
            <div className="mt-3 text-[11px] text-neutral-300">{oauthStatus}</div>
          ) : null}
          {oauthAuthorization ? (
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <input
                value={oauthCode}
                onChange={(event) => setOauthCode(event.target.value)}
                className="h-9 rounded-md border border-neutral-800 bg-neutral-950 px-3 text-[11px] text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-neutral-700"
                placeholder="Final redirect URL or authorization code"
              />
              <button
                onClick={() => void completeOpenAICodexOAuth()}
                disabled={busy || !oauthCode.trim()}
                className="h-9 rounded-md border border-neutral-800 px-4 text-[11px] font-medium text-neutral-100 disabled:text-neutral-600"
              >
                Complete
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="mt-5 overflow-hidden rounded-md border border-neutral-800">
        <div className="grid grid-cols-[120px_90px_1fr_80px_90px_100px] bg-neutral-900 px-4 py-2 text-[10px] font-semibold uppercase text-neutral-500">
          <span>Provider</span>
          <span>Mode</span>
          <span>Credential</span>
          <span>Source</span>
          <span>Status</span>
          <span />
        </div>
        {providers.length === 0 ? (
          <div className="border-t border-neutral-800 px-4 py-6 text-[11px] text-neutral-500">
            No provider connected yet.
          </div>
        ) : null}
        {providers.map((item) => (
          <div
            key={`${item.provider}:${item.id}`}
            className="grid grid-cols-[120px_90px_1fr_80px_90px_100px] items-center border-t border-neutral-800 px-4 py-3 text-[11px]"
          >
            <span className="truncate font-medium text-neutral-50">
              {item.provider_name || item.provider}
            </span>
            <span className="text-neutral-500">{item.auth_mode}</span>
            <span className="truncate text-neutral-500">
              {item.id}{" "}
              {item.oauth_token_masked
                ? `- ${item.oauth_token_masked}`
                : item.api_key_masked
                  ? `- ${item.api_key_masked}`
                  : ""}
            </span>
            <span className="text-neutral-500">{item.source}</span>
            <span className={item.status === "ok" ? "text-emerald-400" : "text-amber-400"}>
              {item.status}
            </span>
            {item.source === "auth" ? (
              <button
                onClick={() => void onProviderLogout(item.provider, item.id)}
                className="h-7 rounded-md border border-neutral-800 text-[10px] text-neutral-500"
              >
                Disconnect
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function App() {
  const { state, refresh } = useDashboard();
  const [mode, setMode] = useState<AdaptiveMode>("portfolio");

  const onResolve = async (id: string, status: "approved" | "rejected"): Promise<void> => {
    await Api.resolveApproval(id, status);
    await refresh();
  };

  const onCoordinatorMessage = async (
    message: string,
    attachments?: CoordinatorAttachmentInput[],
  ): Promise<CoordinatorChatResult> => {
    const result = await Api.coordinatorChat({
      message,
      ...(attachments?.length ? { attachments } : {}),
    });
    await refresh();
    return result;
  };

  const onGenerateReport = async (): Promise<BusinessReportResult> => {
    const result = await Api.generateReports();
    await refresh();
    return result;
  };

  const onProviderLogin = async (input: {
    provider: string;
    mode?: "oauth" | "api-key" | "local";
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    baseUrl?: string;
    defaultModel?: string;
  }): Promise<void> => {
    await Api.providerLogin(input);
    await refresh();
  };

  const onProviderLogout = async (provider: string, id: string): Promise<void> => {
    await Api.providerLogout({ provider, id });
    await refresh();
  };

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-950 text-neutral-50">
      <Sidebar state={state} mode={mode} onModeChange={setMode} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header state={state} mode={mode} onModeChange={setMode} />
        <main className="flex-1 overflow-hidden p-4">
          <div className="dashboard-scale dashboard-grid">
            <div className="min-w-0">
              {mode === "portfolio" ? <PortfolioOperatingRoom state={state} /> : null}
              {mode === "today" ? <TodayView state={state} /> : null}
              {mode === "goals" ? <GoalsView state={state} /> : null}
              {mode === "revenue" ? <RevenueWorkspace state={state} /> : null}
              {mode === "delivery" ? <DeliveryWorkspace state={state} /> : null}
              {mode === "growth" ? <GrowthWorkspace state={state} /> : null}
              {mode === "clients" ? <ClientsWorkspace state={state} /> : null}
              {mode === "risk" ? <RiskWorkspace state={state} /> : null}
              {mode === "approvals" ? (
                <ApprovalsWorkspace state={state} onResolve={onResolve} />
              ) : null}
              {mode === "memory" ? <MemoryWorkspace state={state} /> : null}
              {mode === "agents" ? <AgentsWorkspace state={state} /> : null}
              {mode === "reports" ? <ReportsWorkspace state={state} /> : null}
              {mode === "settings" ? (
                <SettingsView
                  settings={state.settings}
                  providers={state.providers}
                  providerConnectors={state.providerConnectors}
                  onProviderLogin={onProviderLogin}
                  onProviderLogout={onProviderLogout}
                  onRefresh={refresh}
                />
              ) : null}
            </div>
            <div className="min-w-0">
              <CoordinatorPanel onMessage={onCoordinatorMessage} />
            </div>
            <div className="min-w-0">
              <Timeline events={state.audit} artifacts={state.artifacts} />
            </div>
            <div className="min-w-0">
              <PendingApprovals
                approvals={state.approvals}
                onResolve={onResolve}
                onOpen={() => setMode("approvals")}
              />
            </div>
            <div className="dashboard-revenue">
              <RevenuePulse
                pulse={state.pulse}
                clients={state.clients}
                opportunities={state.opportunities}
                onGenerateReport={onGenerateReport}
              />
            </div>
          </div>
        </main>
        <AgentLayer agents={state.agents} />
        {state.error ? (
          <div className="border-t border-rose-900 bg-rose-950 px-4 py-2 text-[11px] text-rose-400">
            API server unreachable: {state.error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
