import { useEffect, useMemo, useRef, useState } from "react";
import {
  Api,
  type AgentDefinition,
  type ApprovalRecord,
  type AuditEvent,
  type BusinessReportResult,
  type CoordinatorAttachmentInput,
  type ClientRecord,
  type CompanyPulse,
  type CoordinatorIntakeResult,
  type OpportunityRecord,
  type ProviderConnection,
  type ProjectRecord,
  type RunRecord,
} from "./lib/api";

function classes(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function formatMoney(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
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
  opportunities: OpportunityRecord[];
  approvals: ApprovalRecord[];
  runs: RunRecord[];
  agents: AgentDefinition[];
  providers: ProviderConnection[];
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
  opportunities: [],
  approvals: [],
  runs: [],
  agents: [],
  providers: [],
  audit: [],
  loading: true,
};

function useDashboard(): { state: DashboardState; refresh: () => Promise<void> } {
  const [state, setState] = useState<DashboardState>(emptyState);

  const refresh = async (): Promise<void> => {
    try {
      const [pulse, clients, projects, opportunities, approvals, runs, agents, providers, audit] =
        await Promise.all([
          Api.pulse(),
          Api.clients(),
          Api.projects(),
          Api.opportunities(),
          Api.approvals(),
          Api.runs(),
          Api.agents(),
          Api.providers(),
          Api.audit(30),
        ]);
      setState({
        pulse,
        clients,
        projects,
        opportunities,
        approvals,
        runs,
        agents,
        providers,
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

type AdaptiveMode = "portfolio" | "today" | "goals" | "settings";
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

const demoLanes: readonly PortfolioLane[] = [
  {
    label: "Internal Product",
    subtitle: "BureauOS",
    capacity: "20% Capacity",
    streams: [
      {
        title: "BureauOS Platform",
        status: "On Track",
        tone: "green",
        progress: 72,
        meta: "Core operating system",
        github: "PR Open",
        badges: ["PM", "Dev", "QA", "Arch", "Sec"],
      },
      {
        title: "v3.2 Core Platform",
        status: "On Track",
        tone: "green",
        progress: 60,
        meta: "Provider + memory kernel",
        github: "PR Open",
        badges: ["PM", "Dev", "QA"],
      },
      {
        title: "AI Agent Framework",
        status: "On Track",
        tone: "green",
        progress: 48,
        meta: "Runtime orchestration",
        badges: ["PM", "Dev", "Sec"],
      },
    ],
  },
  {
    label: "Client A",
    subtitle: "AlphaTech",
    capacity: "30% Capacity",
    streams: [
      {
        title: "Website Redesign",
        status: "On Track",
        tone: "green",
        progress: 75,
        meta: "Delivery sprint",
        github: "PR Open",
        badges: ["PM", "Dev", "QA", "UX", "CS"],
      },
      {
        title: "Marketing Campaign",
        status: "Proposal Ready",
        tone: "amber",
        progress: 40,
        meta: "Approval needed",
        badges: ["PM", "Content", "Ads"],
      },
    ],
  },
  {
    label: "Client B",
    subtitle: "GreenField Co.",
    capacity: "25% Capacity",
    streams: [
      {
        title: "Mobile App MVP",
        status: "On Track",
        tone: "green",
        progress: 65,
        meta: "Discovery complete",
        github: "PR Open",
        badges: ["PM", "Dev", "QA", "Data", "UX"],
      },
      {
        title: "SEO & Content Program",
        status: "On Track",
        tone: "green",
        progress: 55,
        meta: "Growth sprint",
        badges: ["PM", "Social", "Content"],
      },
    ],
  },
  {
    label: "Client C",
    subtitle: "Finova Labs",
    capacity: "25% Capacity",
    streams: [
      {
        title: "Data Platform Build",
        status: "Blocked",
        tone: "red",
        progress: 30,
        meta: "Blocked",
        badges: ["PM", "Dev", "Data", "Sec"],
      },
      {
        title: "Analytics Dashboard",
        status: "On Track",
        tone: "green",
        progress: 70,
        meta: "Reviewing PR",
        github: "PR Open",
        badges: ["PM", "Dev", "QA", "Data", "CS"],
      },
    ],
  },
];

const demoAgents = [
  ["PM", "Project Manager"],
  ["Dev", "Developer"],
  ["QA", "Quality Assurance"],
  ["UX", "Product Designer"],
  ["Data", "Data Engineer"],
  ["Sales", "Sales Agent"],
  ["Pricing", "Pricing Analyst"],
  ["Compliance", "Compliance Officer"],
  ["Social", "Social Media"],
  ["Ads", "Paid Media"],
  ["CS", "Client Success"],
] as const;

const demoApprovals = [
  {
    id: "demo-proposal",
    action: "Send proposal to AlphaTech",
    actor: "proposal",
    target: "Website Redesign Proposal v1.2",
    scope: "Value: $42,500",
    status: "pending",
  },
  {
    id: "demo-budget",
    action: "Approve ad budget increase",
    actor: "ads",
    target: "Google Ads - Growth Campaign",
    scope: "Budget: $4,000 -> $7,000",
    status: "pending",
  },
  {
    id: "demo-deploy",
    action: "Deploy to production",
    actor: "release",
    target: "Mobile App MVP - v1.0.0",
    scope: "Environment: Production",
    status: "pending",
  },
] satisfies ApprovalRecord[];

const demoEvents = [
  ["QA isolated", "CI failure", "Mobile App MVP", "QA", "green"],
  ["Proposal draft", "ready", "Website Redesign", "Pricing", "green"],
  ["Social post", "prepared", "Growth Campaign", "Social", "amber"],
  ["Compliance", "blocked ad launch", "Growth Campaign", "Compliance", "red"],
  ["Dev opened", "PR #42", "BureauOS Platform", "Dev", "blue"],
  ["Client update", "sent", "Finova Labs", "CS", "black"],
] as const;

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
      return "bg-neutral-300";
  }
}

function toneText(tone: Tone): string {
  switch (tone) {
    case "green":
      return "text-emerald-700";
    case "amber":
      return "text-amber-700";
    case "red":
      return "text-rose-700";
    case "black":
      return "text-neutral-950";
    case "muted":
      return "text-neutral-500";
  }
}

function Header({
  pulse,
  mode,
  onModeChange,
}: {
  pulse?: CompanyPulse;
  mode: AdaptiveMode;
  onModeChange: (mode: AdaptiveMode) => void;
}) {
  const modes: AdaptiveMode[] = ["portfolio", "today", "goals"];
  return (
    <header className="h-16 border-b border-neutral-200 bg-white">
      <div className="flex h-full items-center justify-between px-6">
        <div>
          <div className="flex items-baseline gap-3">
            <h1 className="text-[15px] font-semibold text-neutral-950">Company Pulse</h1>
            <span className="text-[11px] text-neutral-500">Adaptive:</span>
            <div className="flex items-center gap-1 text-[11px]">
              {modes.map((item, index) => (
                <button
                  key={item}
                  onClick={() => onModeChange(item)}
                  className={classes(
                    mode === item ? "font-medium text-emerald-700" : "text-neutral-500",
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
                  mode === "settings" ? "font-medium text-neutral-950" : "text-neutral-500",
                )}
              >
                Settings
              </button>
            </div>
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">
            {pulse?.organization ?? "BureauOS"} - Operating Room
          </div>
        </div>

        <div className="flex items-center gap-3">
          <TopMetric tone="green" label="Autonomous Mode" value="Active" />
          <TopMetric tone="amber" label="Risk Level" value="Moderate" />
          <TopMetric tone="green" label="Revenue Health" value="Strong" />
          <button className="grid h-8 w-8 place-items-center rounded-md border border-neutral-200 text-neutral-500">
            *
          </button>
          <div className="text-right text-[11px] leading-tight text-neutral-500">
            <div>May 19, 2030</div>
            <div>9:04 AM</div>
          </div>
          <div className="grid h-9 w-9 place-items-center rounded-full border border-neutral-200 bg-neutral-100 text-xs font-semibold text-neutral-700">
            ED
          </div>
        </div>
      </div>
    </header>
  );
}

function TopMetric({ tone, label, value }: { tone: Tone; label: string; value: string }) {
  return (
    <div className="min-w-32 rounded-md border border-neutral-200 bg-white px-4 py-2">
      <div className="flex items-center gap-2 text-[11px] font-medium text-neutral-700">
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
}: {
  icon: string;
  label: string;
  badge?: number;
  active?: boolean;
}) {
  return (
    <div
      className={classes(
        "flex h-10 items-center justify-between rounded-md px-3 text-[13px]",
        active ? "bg-neutral-100 text-neutral-950" : "text-neutral-600 hover:bg-neutral-50",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="grid h-4 w-4 place-items-center text-[11px] text-neutral-500">{icon}</span>
        <span>{label}</span>
      </div>
      {badge !== undefined && badge > 0 ? (
        <span className="grid min-w-5 place-items-center rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

function Sidebar({ state }: { state: DashboardState }) {
  return (
    <aside className="hidden w-[184px] flex-col border-r border-neutral-200 bg-white lg:flex">
      <div className="flex h-16 items-center gap-3 border-b border-neutral-200 px-5">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-neutral-950 text-sm font-semibold text-white">
          B
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold text-neutral-950">BureauOS</div>
          <div className="text-[11px] text-neutral-500">Operating Room</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        <SidebarItem icon="H" label="Home" active />
        <SidebarItem icon="$" label="Revenue" />
        <SidebarItem icon="D" label="Delivery" />
        <SidebarItem icon="G" label="Growth" />
        <SidebarItem icon="C" label="Clients" />
        <SidebarItem icon="R" label="Risk" />
        <SidebarItem icon="M" label="Memory" />
        <SidebarItem icon="A" label="Agents" />
        <div className="my-4 border-t border-neutral-200" />
        <SidebarItem icon="I" label="Inbox" badge={Math.max(7, state.approvals.length)} />
        <SidebarItem icon="V" label="Approvals" badge={Math.max(3, state.approvals.length)} />
        <SidebarItem icon="P" label="Reports" />
        <SidebarItem icon="S" label="Settings" />
      </nav>
      <div className="m-4 rounded-md border border-neutral-200 p-3">
        <div className="text-[11px] font-semibold text-neutral-900">System Status</div>
        <div className="mt-2 flex items-center gap-2 text-[10px] text-neutral-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
          {state.error ? "API Offline" : "All Systems Online"}
        </div>
        <div className="mt-2 text-[10px] text-neutral-500">
          {Math.max(42, state.agents.length)} agents active
        </div>
        <button className="mt-3 text-[10px] font-medium text-neutral-600">View status</button>
      </div>
    </aside>
  );
}

function deriveLanes(projects: ProjectRecord[]): PortfolioLane[] {
  const lanes = demoLanes.map((lane) => ({
    ...lane,
    streams: lane.streams.map((stream) => ({ ...stream, badges: [...stream.badges] })),
  }));
  projects.slice(0, 5).forEach((project, index) => {
    const lane = lanes[(index % (lanes.length - 1)) + 1];
    const card = lane?.streams[index % 2];
    if (!card) return;
    card.title = project.name;
    card.status = project.status === "blocked" ? "Blocked" : "On Track";
    card.tone = project.status === "blocked" ? "red" : "green";
    card.meta = project.stack || project.repository || "Client delivery";
    card.github = project.repository ? "PR Open" : "Repo Pending";
  });
  return lanes;
}

function WorkstreamCard({ item }: { item: Workstream }) {
  return (
    <div className="workstream-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-medium text-neutral-950">{item.title}</div>
          <div className={classes("mt-1 flex items-center gap-2 text-[10px]", toneText(item.tone))}>
            <span className={classes("h-1.5 w-1.5 rounded-full", toneDot(item.tone))} />
            {item.status}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="h-1.5 flex-1 rounded-full bg-neutral-100">
          <div
            className={classes(
              "h-1.5 rounded-full",
              item.tone === "red" ? "bg-neutral-500" : "bg-emerald-600",
            )}
            style={{ width: `${item.progress}%` }}
          />
        </div>
        <div className="w-8 text-right text-[10px] text-neutral-500">{item.progress}%</div>
        {item.github ? (
          <div className="text-[10px] font-medium text-neutral-700">{item.github}</div>
        ) : null}
      </div>
    </div>
  );
}

function PortfolioOperatingRoom({ state }: { state: DashboardState }) {
  const lanes = useMemo(() => deriveLanes(state.projects), [state.projects]);
  return (
    <section className="dashboard-panel portfolio-room">
      <div className="flex items-start justify-between border-b border-neutral-200 px-5 py-2.5">
        <div>
          <h2 className="text-[14px] font-semibold text-neutral-950">Portfolio Operating Room</h2>
          <p className="mt-0.5 text-[10px] text-neutral-500">
            Live portfolio view of workstreams, projects, and autonomous execution.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded-md border border-neutral-200 px-3 py-1.5 text-[11px] text-neutral-600">
            Filter
          </button>
          <button className="grid h-8 w-8 place-items-center rounded-md border border-neutral-200 text-neutral-500">
            ...
          </button>
        </div>
      </div>

      <div className="border-b border-neutral-200 px-5">
        <div className="flex h-8 items-center gap-7 text-[11px]">
          {["Portfolio Map", "Workload", "Gantt", "Kanban"].map((tab, index) => (
            <button
              key={tab}
              className={classes(
                "h-full border-b-2",
                index === 0
                  ? "border-neutral-950 font-medium text-neutral-950"
                  : "border-transparent text-neutral-500",
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 py-3">
        <div className="operating-map">
          {lanes.map((lane) => (
            <div key={lane.label} className="portfolio-column">
              <div className="mb-2 flex items-baseline justify-between">
                <div>
                  <div className="text-[12px] font-semibold text-neutral-950">{lane.label}</div>
                  <div className="text-[10px] text-neutral-500">{lane.subtitle}</div>
                </div>
                <div className="text-[10px] text-neutral-400">{lane.capacity}</div>
              </div>
              <div className="space-y-3">
                {lane.streams.map((item) => (
                  <WorkstreamCard key={item.title} item={item} />
                ))}
              </div>
              <div className="mt-2 flex min-h-6 flex-wrap items-center gap-1.5">
                {lane.streams[0]?.badges.map((badge) => (
                  <span
                    key={badge}
                    className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[10px] text-neutral-600"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-2 flex items-center gap-3 border-t border-neutral-100 pt-2">
          <div className="w-36 text-[11px]">
            <div className="font-semibold text-neutral-950">Capacity Allocation</div>
            <div className="text-neutral-500">Live distribution of team capacity.</div>
          </div>
          <div className="flex-1">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-neutral-100">
              <div className="bg-emerald-600" style={{ width: "60%" }} />
              <div className="bg-neutral-900" style={{ width: "20%" }} />
              <div className="bg-neutral-400" style={{ width: "15%" }} />
              <div className="bg-rose-500" style={{ width: "5%" }} />
            </div>
            <div className="mt-2 grid grid-cols-4 text-[10px] text-neutral-500">
              <span>Client Delivery 60%</span>
              <span>BureauOS Product 20%</span>
              <span>Growth 15%</span>
              <span>Risk / Admin 5%</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CoordinatorPanel({
  onIntake,
}: {
  onIntake: (
    message: string,
    clientName?: string,
    attachments?: CoordinatorAttachmentInput[],
  ) => Promise<CoordinatorIntakeResult>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef<ChatAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CoordinatorIntakeResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [draft, setDraft] = useState("A client wants a mobile app.");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

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
    try {
      const payload = await Promise.all(
        attachments.map((attachment) => toCoordinatorAttachment(attachment.file)),
      );
      const attachmentSummary = attachments.length
        ? `\n\nAttached files:\n${attachments
            .map((item) => `- ${item.name} (${item.type}, ${formatBytes(item.size)})`)
            .join("\n")}`
        : "";
      setResult(await onIntake(`${draft.trim()}${attachmentSummary}`, undefined, payload));
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
      <div className="flex items-start justify-between border-b border-neutral-200 px-5 py-4">
        <div>
          <h2 className="text-[13px] font-semibold text-neutral-950">Supreme Coordinator</h2>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-neutral-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
            Online
          </div>
        </div>
        <button className="text-neutral-400">...</button>
      </div>
      <div className="coordinator-chat px-5 py-4">
        <div className="coordinator-thread">
          <div className="ml-auto max-w-[250px] rounded-md bg-neutral-100 px-3 py-2 text-[12px] text-neutral-700">
            {draft || "A client wants a mobile app."}
          </div>
          <div className="flex gap-3">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-neutral-950 text-[10px] font-semibold text-white">
              SS
            </div>
            <div className="space-y-3">
              <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-[12px] leading-relaxed text-neutral-700">
                I can create the opportunity, classify the client, attach assets to the project
                memory, assign the agents, and keep everything in draft mode until approval.
              </div>
              <div className="rounded-md border border-neutral-200 bg-white p-3">
                <div className="text-[11px] font-semibold text-neutral-950">
                  Opportunity - OPP-2030-118
                </div>
                <div className="mt-1 text-[12px] font-medium text-neutral-800">
                  Mobile App for New Client
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-neutral-500">
                  <span>Est. Value $148,000</span>
                  <span>Close Date Jun 10, 2030</span>
                  <span>Stage Draft</span>
                </div>
                <button className="mt-3 h-8 w-full rounded-md border border-neutral-200 text-[11px] text-neutral-700">
                  Open Opportunity
                </button>
              </div>
            </div>
          </div>
          {result ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
              {result.project.name}: {result.artifacts.length} artifacts, {result.approvals.length}{" "}
              approvals.
            </div>
          ) : null}
          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
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
                    <div className="grid h-9 w-9 place-items-center rounded bg-neutral-100 text-[10px] text-neutral-500">
                      FILE
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10px] font-medium text-neutral-800">
                      {item.name}
                    </div>
                    <div className="text-[9px] text-neutral-500">{formatBytes(item.size)}</div>
                  </div>
                  <button
                    onClick={() => removeAttachment(item.id)}
                    className="text-[10px] text-neutral-400"
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
            className="min-h-20 w-full resize-none bg-transparent text-[12px] text-neutral-900 outline-none placeholder:text-neutral-400"
          />
          <div className="flex items-center justify-between border-t border-neutral-100 pt-2">
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
                className="h-7 rounded-md border border-neutral-200 px-2 text-[11px] text-neutral-600 hover:bg-neutral-50"
              >
                + File
              </button>
              <span className="text-[10px] text-neutral-400">images, docs, briefs</span>
            </div>
            <button
              onClick={() => void submit()}
              disabled={busy || (!draft.trim() && attachments.length === 0)}
              className="h-7 rounded-md bg-neutral-950 px-3 text-[11px] font-medium text-white disabled:bg-neutral-200 disabled:text-neutral-400"
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
}: {
  approvals: ApprovalRecord[];
  onResolve: (id: string, status: "approved" | "rejected") => Promise<void>;
}) {
  const visible = approvals.length ? approvals.slice(0, 3) : demoApprovals;
  const canResolve = approvals.length > 0;
  return (
    <section className="dashboard-panel">
      <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-neutral-950">
          Pending Approvals
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500">
            {visible.length}
          </span>
        </div>
        <button className="text-[10px] text-neutral-500">View all</button>
      </div>
      <div className="divide-y divide-neutral-100 px-5">
        {visible.map((approval) => (
          <div key={approval.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-3">
            <div>
              <div className="text-[12px] font-medium text-neutral-950">{approval.action}</div>
              <div className="mt-1 text-[10px] text-neutral-500">
                {approval.target} - {approval.scope}
              </div>
            </div>
            <button
              disabled={!canResolve}
              onClick={() => void onResolve(approval.id, "approved")}
              className="h-8 rounded-md bg-emerald-600 px-4 text-[11px] font-medium text-white disabled:bg-emerald-600"
            >
              Approve
            </button>
            <button
              disabled={!canResolve}
              onClick={() => void onResolve(approval.id, "rejected")}
              className="h-8 rounded-md border border-neutral-200 px-4 text-[11px] text-neutral-600"
            >
              Reject
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-neutral-100 px-5 py-4 text-[11px] text-neutral-500">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
        Autonomous mode is handling 89% of operations.
      </div>
    </section>
  );
}

function Timeline({ events }: { events: AuditEvent[] }) {
  const visible =
    events.length > 0
      ? events
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
          )
      : demoEvents.map((event) => [...event, ""] as const);

  return (
    <section className="dashboard-panel">
      <div className="flex items-start justify-between border-b border-neutral-200 px-6 py-4">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-950">Live Operations Timeline</h2>
          <p className="mt-1 text-[11px] text-neutral-500">
            Real-time autonomous activity across the company.
          </p>
        </div>
        <button className="text-[10px] text-neutral-500">View all activity</button>
      </div>
      <div className="timeline-strip px-6 py-5">
        {visible.map((event, index) => (
          <div key={`${event[0]}-${index}`} className="timeline-event">
            <span
              className={classes(
                "timeline-dot",
                event[4] === "red"
                  ? "bg-rose-600"
                  : event[4] === "amber"
                    ? "bg-amber-500"
                    : event[4] === "blue"
                      ? "bg-blue-600"
                      : event[4] === "black"
                        ? "bg-neutral-950"
                        : "bg-emerald-600",
              )}
            />
            <div className="text-[10px] text-neutral-400">
              {event[5] ? timeAgo(event[5]) : "9:0" + index + " AM"}
            </div>
            <div className="mt-1 text-[11px] font-semibold text-neutral-950">{event[0]}</div>
            <div className="text-[10px] text-neutral-500">{event[1]}</div>
            <div className="mt-1 text-[10px] text-neutral-400">{event[3]}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Sparkline() {
  return (
    <svg viewBox="0 0 80 32" className="h-8 w-20 text-emerald-700" aria-hidden="true">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        points="1,24 10,18 18,21 27,12 37,16 46,8 56,13 66,6 78,3"
      />
    </svg>
  );
}

function RevenuePulse({
  pulse,
  opportunities,
  onGenerateReport,
}: {
  pulse?: CompanyPulse;
  opportunities: OpportunityRecord[];
  onGenerateReport: () => Promise<BusinessReportResult>;
}) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<BusinessReportResult | undefined>();
  const pipeline = pulse?.revenue.pipeline_value || 2_480_000;
  const active = pulse?.revenue.active_opportunities || 27;
  const margin = opportunities.length
    ? opportunities.reduce((sum, item) => sum + (item.expected_margin || 0), 0) /
      opportunities.length
    : 42;

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
    ["Pipeline Value", formatMoney(pipeline), "18% vs last 30 days"],
    ["Expected Margin", `${Math.round(margin)}%`, "3pp vs last 30 days"],
    ["Active Opportunities", String(active), "5 vs last 30 days"],
    ["Revenue (MTD)", "$386K", "16% vs last month"],
    ["Client Lifetime Value", "$6.72M", "21% vs last 90 days"],
  ] as const;

  return (
    <section className="dashboard-panel">
      <div className="grid grid-cols-[150px_1fr_210px] gap-4 p-4">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-950">Revenue Pulse</h2>
          <p className="mt-1 text-[11px] text-neutral-500">
            Real-time revenue and pipeline health.
          </p>
          <button
            onClick={() => void generate()}
            disabled={busy}
            className="mt-5 text-[11px] font-medium text-neutral-600 disabled:text-neutral-300"
          >
            {busy ? "Generating" : "View full report"}
          </button>
          {report ? (
            <div className="mt-2 text-[10px] text-emerald-700">
              Report {report.executive_report.id} generated
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-5 gap-3">
          {cards.map((card) => (
            <div key={card[0]} className="rounded-md border border-neutral-200 p-3">
              <div className="text-[10px] text-neutral-500">{card[0]}</div>
              <div className="mt-2 text-xl font-semibold text-neutral-950">{card[1]}</div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <div className="text-[10px] text-emerald-700">{card[2]}</div>
                <Sparkline />
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-md border border-neutral-200 p-3">
          <div className="text-[10px] font-semibold text-neutral-950">Top Clients by LTV</div>
          {["AlphaTech", "GreenField Co.", "Finova Labs"].map((client, index) => (
            <div key={client} className="mt-2 flex justify-between text-[10px] text-neutral-600">
              <span>
                {index + 1}. {client}
              </span>
              <span>{["$2.14M", "$1.78M", "$1.23M"][index]}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AgentLayer({ agents }: { agents: AgentDefinition[] }) {
  const visible =
    agents.length > 0
      ? agents
          .slice(0, 11)
          .map((agent) => [agent.role.slice(0, 2).toUpperCase(), agent.role] as const)
      : demoAgents;
  return (
    <section className="h-[82px] border-t border-neutral-200 bg-white">
      <div className="grid h-full grid-cols-[170px_1fr_120px] items-center gap-4 px-5">
        <div>
          <div className="text-[13px] font-semibold text-neutral-950">Agent Layer</div>
          <div className="mt-1 text-[10px] text-neutral-500">
            Autonomous teams executing across functions.
          </div>
        </div>
        <div className="flex gap-2 overflow-hidden">
          {visible.map(([abbr, label]) => (
            <div key={label} className="agent-pill">
              <span className="grid h-7 w-7 place-items-center rounded-md border border-neutral-200 bg-neutral-50 text-[10px] font-semibold text-neutral-700">
                {abbr}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[11px] font-medium text-neutral-950">{abbr}</div>
                <div className="truncate text-[9px] text-neutral-500">{label}</div>
              </div>
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-600" />
            </div>
          ))}
        </div>
        <button className="h-9 rounded-md border border-neutral-200 text-[11px] text-neutral-600">
          Manage Agents
        </button>
      </div>
    </section>
  );
}

function TodayView({ state }: { state: DashboardState }) {
  const blocked = state.projects.filter((project) => project.status === "blocked").length;
  return (
    <section className="dashboard-panel p-6">
      <h2 className="text-[15px] font-semibold text-neutral-950">Today</h2>
      <div className="mt-5 grid grid-cols-3 gap-4">
        <FocusCard label="Approvals waiting" value={String(state.approvals.length)} />
        <FocusCard label="Blocked work" value={String(blocked)} />
        <FocusCard label="Runs today" value={String(state.runs.length)} />
      </div>
    </section>
  );
}

function GoalsView({ state }: { state: DashboardState }) {
  const total = state.opportunities.reduce((sum, item) => sum + (item.expected_value || 0), 0);
  return (
    <section className="dashboard-panel p-6">
      <h2 className="text-[15px] font-semibold text-neutral-950">Goals</h2>
      <div className="mt-5 grid grid-cols-3 gap-4">
        <FocusCard label="Quarter pipeline" value={formatMoney(total || 2_480_000)} />
        <FocusCard label="Target active clients" value="12" />
        <FocusCard label="Autonomous coverage" value="89%" />
      </div>
    </section>
  );
}

function FocusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 p-4">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-neutral-950">{value}</div>
    </div>
  );
}

function SettingsView({
  providers,
  onProviderLogin,
  onProviderLogout,
}: {
  providers: ProviderConnection[];
  onProviderLogin: (input: {
    provider: string;
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
  }) => Promise<void>;
  onProviderLogout: (provider: string, id: string) => Promise<void>;
}) {
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [busy, setBusy] = useState(false);

  const connect = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await onProviderLogin({
        provider,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(defaultModel.trim() ? { defaultModel: defaultModel.trim() } : {}),
      });
      setApiKey("");
      setDefaultModel("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dashboard-panel p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-950">Settings</h2>
          <p className="mt-1 text-[11px] text-neutral-500">Provider authentication and routing.</p>
        </div>
        <div className="flex gap-2">
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-[11px]"
          >
            {["openai", "anthropic", "google", "openrouter", "local", "custom"].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            className="h-9 rounded-md border border-neutral-200 px-3 text-[11px]"
            placeholder="API key"
            type="password"
          />
          <input
            value={defaultModel}
            onChange={(event) => setDefaultModel(event.target.value)}
            className="h-9 rounded-md border border-neutral-200 px-3 text-[11px]"
            placeholder="model"
          />
          <button
            onClick={() => void connect()}
            disabled={busy}
            className="h-9 rounded-md bg-neutral-950 px-4 text-[11px] font-medium text-white"
          >
            Connect
          </button>
        </div>
      </div>
      <div className="mt-5 overflow-hidden rounded-md border border-neutral-200">
        <div className="grid grid-cols-[120px_1fr_80px_90px_100px] bg-neutral-50 px-4 py-2 text-[10px] font-semibold uppercase text-neutral-500">
          <span>Provider</span>
          <span>Credential</span>
          <span>Source</span>
          <span>Status</span>
          <span />
        </div>
        {providers.map((item) => (
          <div
            key={`${item.provider}:${item.id}`}
            className="grid grid-cols-[120px_1fr_80px_90px_100px] items-center border-t border-neutral-100 px-4 py-3 text-[11px]"
          >
            <span className="font-medium text-neutral-950">{item.provider}</span>
            <span className="truncate text-neutral-500">
              {item.id} {item.api_key_masked ? `- ${item.api_key_masked}` : ""}
            </span>
            <span className="text-neutral-500">{item.source}</span>
            <span className={item.status === "ok" ? "text-emerald-700" : "text-amber-700"}>
              {item.status}
            </span>
            {item.source === "auth" ? (
              <button
                onClick={() => void onProviderLogout(item.provider, item.id)}
                className="h-7 rounded-md border border-neutral-200 text-[10px] text-neutral-600"
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
    if (id.startsWith("demo-")) return;
    await Api.resolveApproval(id, status);
    await refresh();
  };

  const onCoordinatorIntake = async (
    message: string,
    clientName?: string,
    attachments?: CoordinatorAttachmentInput[],
  ): Promise<CoordinatorIntakeResult> => {
    const result = await Api.coordinatorIntake({
      message,
      ...(clientName ? { clientName } : {}),
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
    apiKey?: string;
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
    <div className="flex h-screen overflow-hidden bg-[#f7f7f5] text-neutral-950">
      <Sidebar state={state} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header pulse={state.pulse} mode={mode} onModeChange={setMode} />
        <main className="flex-1 overflow-hidden p-4">
          <div className="dashboard-scale dashboard-grid">
            <div className="min-w-0">
              {mode === "portfolio" ? <PortfolioOperatingRoom state={state} /> : null}
              {mode === "today" ? <TodayView state={state} /> : null}
              {mode === "goals" ? <GoalsView state={state} /> : null}
              {mode === "settings" ? (
                <SettingsView
                  providers={state.providers}
                  onProviderLogin={onProviderLogin}
                  onProviderLogout={onProviderLogout}
                />
              ) : null}
            </div>
            <div className="min-w-0">
              <CoordinatorPanel onIntake={onCoordinatorIntake} />
            </div>
            <div className="min-w-0">
              <Timeline events={state.audit} />
            </div>
            <div className="min-w-0">
              <PendingApprovals approvals={state.approvals} onResolve={onResolve} />
            </div>
            <div className="dashboard-revenue">
              <RevenuePulse
                pulse={state.pulse}
                opportunities={state.opportunities}
                onGenerateReport={onGenerateReport}
              />
            </div>
          </div>
        </main>
        <AgentLayer agents={state.agents} />
        {state.error ? (
          <div className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-[11px] text-rose-700">
            API server unreachable: {state.error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
