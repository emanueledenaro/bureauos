import { useEffect, useMemo, useState } from "react";
import {
  Api,
  type AgentDefinition,
  type ApprovalRecord,
  type AuditEvent,
  type ClientRecord,
  type CompanyPulse,
  type OpportunityRecord,
  type ProjectRecord,
  type RunRecord,
} from "./lib/api";

// ---------- helpers ----------

function classes(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function formatMoney(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

function timeAgo(iso: string): string {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface DashboardState {
  pulse?: CompanyPulse;
  clients: ClientRecord[];
  projects: ProjectRecord[];
  opportunities: OpportunityRecord[];
  approvals: ApprovalRecord[];
  runs: RunRecord[];
  agents: AgentDefinition[];
  audit: AuditEvent[];
  error?: string;
  loading: boolean;
}

const emptyState: DashboardState = {
  clients: [],
  projects: [],
  opportunities: [],
  approvals: [],
  runs: [],
  agents: [],
  audit: [],
  loading: true,
};

function useDashboard(): {
  state: DashboardState;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<DashboardState>(emptyState);

  const refresh = async (): Promise<void> => {
    try {
      const [pulse, clients, projects, opportunities, approvals, runs, agents, audit] =
        await Promise.all([
          Api.pulse(),
          Api.clients(),
          Api.projects(),
          Api.opportunities(),
          Api.approvals(),
          Api.runs(),
          Api.agents(),
          Api.audit(20),
        ]);
      setState({
        pulse,
        clients,
        projects,
        opportunities,
        approvals,
        runs,
        agents,
        audit,
        loading: false,
      });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
    }
  };

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15000);

    let es: EventSource | undefined;
    let cancelled = false;
    (async () => {
      try {
        const base = await (window.bureau
          ? window.bureau.apiUrl()
          : Promise.resolve("http://127.0.0.1:3737"));
        if (cancelled || !base) return;
        es = new EventSource(`${base}/events`);
        es.addEventListener("audit", (ev) => {
          try {
            const event = JSON.parse((ev as MessageEvent).data) as AuditEvent;
            setState((s) => ({ ...s, audit: [...s.audit, event].slice(-50) }));
          } catch {
            // ignore malformed events
          }
        });
        es.onerror = () => {
          // EventSource auto-retries; nothing to do here.
        };
      } catch {
        // SSE unavailable; polling keeps the dashboard fresh.
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(t);
      es?.close();
    };
  }, []);

  return { state, refresh };
}

// ---------- header ----------

function StatusPill({
  tone,
  label,
  value,
}: {
  tone: "ok" | "warn" | "bad";
  label: string;
  value: string;
}) {
  const dot = tone === "ok" ? "bg-ok-500" : tone === "warn" ? "bg-warn-500" : "bg-bad-500";
  return (
    <div className="flex flex-col items-start rounded-md border border-neutral-200 bg-white px-3 py-1.5">
      <div className="flex items-center gap-2 text-xs font-medium text-neutral-700">
        <span className={classes("h-2 w-2 rounded-full", dot)} />
        {label}
      </div>
      <div className="text-xs text-neutral-500">{value}</div>
    </div>
  );
}

type AdaptiveMode = "portfolio" | "today" | "goals";

function Header({
  pulse,
  mode,
  onModeChange,
}: {
  pulse?: CompanyPulse;
  mode: AdaptiveMode;
  onModeChange: (m: AdaptiveMode) => void;
}) {
  const now = new Date();
  const date = now.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const modes: AdaptiveMode[] = ["portfolio", "today", "goals"];
  return (
    <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
      <div>
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-semibold text-neutral-900">Company Pulse</h1>
          <span className="text-xs text-neutral-500">Adaptive:</span>
          {modes.map((m, i) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              className={classes(
                "text-xs",
                mode === m
                  ? "font-medium text-neutral-900"
                  : "text-neutral-400 hover:text-neutral-600",
              )}
            >
              {m[0]?.toUpperCase()}
              {m.slice(1)}
              {i < modes.length - 1 ? " /" : ""}
            </button>
          ))}
        </div>
        {pulse && (
          <div className="text-xs text-neutral-500">
            {pulse.organization} - {pulse.preset} preset, {pulse.mode} mode
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <StatusPill tone="ok" label="Autonomous Mode" value="Active" />
        <StatusPill tone="warn" label="Risk Level" value="Moderate" />
        <StatusPill tone="ok" label="Revenue Health" value="Strong" />
        <div className="text-right text-xs text-neutral-500">
          <div>{date}</div>
          <div>{time}</div>
        </div>
      </div>
    </header>
  );
}

// ---------- sidebar ----------

function SidebarLink({
  label,
  badge,
  active,
}: {
  label: string;
  badge?: number;
  active?: boolean;
}) {
  return (
    <div
      className={classes(
        "flex items-center justify-between rounded-md px-3 py-2 text-sm",
        active
          ? "bg-neutral-100 font-medium text-neutral-900"
          : "text-neutral-600 hover:bg-neutral-100",
      )}
    >
      <span>{label}</span>
      {badge !== undefined && badge > 0 ? (
        <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-700">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

function Sidebar({ state }: { state: DashboardState }) {
  return (
    <aside className="flex w-56 flex-col border-r border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-4 py-4">
        <div className="text-sm font-semibold text-neutral-900">BureauOS</div>
        <div className="text-xs text-neutral-500">Operating Room</div>
      </div>
      <nav className="flex-1 space-y-0.5 p-2">
        <SidebarLink label="Home" active />
        <SidebarLink label="Revenue" />
        <SidebarLink label="Delivery" />
        <SidebarLink label="Growth" />
        <SidebarLink label="Clients" badge={state.clients.length} />
        <SidebarLink label="Risk" />
        <SidebarLink label="Memory" />
        <SidebarLink label="Agents" badge={state.agents.length} />
        <div className="my-2 border-t border-neutral-200" />
        <SidebarLink label="Inbox" />
        <SidebarLink label="Approvals" badge={state.approvals.length} />
        <SidebarLink label="Reports" />
        <SidebarLink label="Settings" />
      </nav>
      <div className="border-t border-neutral-200 p-3">
        <div className="text-xs font-medium text-neutral-700">System Status</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
          <span className="h-2 w-2 rounded-full bg-ok-500" />
          {state.error ? "API offline" : "All systems online"}
        </div>
        <div className="text-xs text-neutral-500">{state.agents.length} agents registered</div>
      </div>
    </aside>
  );
}

// ---------- portfolio map ----------

function ProjectCard({ p }: { p: ProjectRecord }) {
  const statusTone: Record<string, string> = {
    in_progress: "bg-ok-500",
    blocked: "bg-bad-500",
    proposal: "bg-warn-500",
    approved: "bg-ok-500",
    intake: "bg-neutral-300",
    delivered: "bg-neutral-300",
    cancelled: "bg-neutral-300",
  };
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-3">
      <div className="flex items-start justify-between">
        <div className="text-sm font-medium text-neutral-900">{p.name}</div>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-700">
          {p.status.replace("_", " ")}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-500">
        <span
          className={classes("h-1.5 w-1.5 rounded-full", statusTone[p.status] ?? "bg-neutral-300")}
        />
        {p.stack || "stack tbd"} {p.repository ? `- ${p.repository}` : ""}
      </div>
      <div className="mt-2 h-1.5 w-full rounded bg-neutral-100">
        <div className="h-1.5 rounded bg-ok-500" style={{ width: "45%" }} />
      </div>
    </div>
  );
}

function PortfolioMap({ state }: { state: DashboardState }) {
  const byClient = useMemo(() => {
    const map = new Map<string, { client?: ClientRecord; projects: ProjectRecord[] }>();
    for (const c of state.clients) map.set(c.id, { client: c, projects: [] });
    map.set("_internal", { client: undefined, projects: [] });
    for (const p of state.projects) {
      const bucket = map.get(p.client_id) ?? map.get("_internal");
      if (bucket) bucket.projects.push(p);
    }
    return map;
  }, [state.clients, state.projects]);

  const columns = Array.from(byClient.entries()).filter(
    ([, v]) => v.projects.length > 0 || v.client,
  );
  const hasContent = columns.some(([, v]) => v.projects.length > 0);

  return (
    <section className="rounded-lg border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Portfolio Operating Room</h2>
          <p className="text-xs text-neutral-500">
            Live portfolio view of workstreams, projects, and autonomous execution.
          </p>
        </div>
        <div className="flex gap-1 text-xs">
          {["Portfolio Map", "Workload", "Gantt", "Kanban"].map((t, i) => (
            <span
              key={t}
              className={classes(
                "rounded-md px-2 py-1",
                i === 0 ? "bg-neutral-100 font-medium text-neutral-900" : "text-neutral-500",
              )}
            >
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="p-4">
        {!hasContent ? (
          <div className="rounded-md border border-dashed border-neutral-200 p-6 text-center text-sm text-neutral-500">
            No projects yet. Run{" "}
            <code className="rounded bg-neutral-100 px-1">bureau client create</code> and{" "}
            <code className="rounded bg-neutral-100 px-1">bureau project create</code> to populate
            the portfolio.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {columns.map(([id, { client, projects }]) => (
              <div key={id} className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <div className="text-xs font-medium text-neutral-900">
                    {client ? client.name : "Internal Product"}
                  </div>
                  <div className="text-[10px] text-neutral-500">{projects.length} projects</div>
                </div>
                {projects.map((p) => (
                  <ProjectCard key={p.id} p={p} />
                ))}
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 rounded-md border border-neutral-200 p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <div className="text-xs font-medium text-neutral-700">Capacity Allocation</div>
            <div className="text-[10px] text-neutral-500">Live distribution across the company</div>
          </div>
          <div className="flex h-3 overflow-hidden rounded bg-neutral-100">
            <div className="bg-ok-500" style={{ width: "60%" }} />
            <div className="bg-neutral-700" style={{ width: "20%" }} />
            <div className="bg-warn-500" style={{ width: "15%" }} />
            <div className="bg-bad-500" style={{ width: "5%" }} />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-neutral-500">
            <span>Client Delivery 60%</span>
            <span>BureauOS Product 20%</span>
            <span>Growth 15%</span>
            <span>Risk/Admin 5%</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- timeline ----------

function OperationsTimeline({ events }: { events: AuditEvent[] }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Live Operations Timeline</h2>
          <p className="text-xs text-neutral-500">
            Real-time autonomous activity across the company.
          </p>
        </div>
        <span className="text-xs text-neutral-500">View all activity</span>
      </div>
      <ol className="divide-y divide-neutral-100 px-4 py-2">
        {events.length === 0 ? (
          <li className="py-3 text-xs text-neutral-500">
            No events yet. Run <code>bureau init</code> in the workspace.
          </li>
        ) : (
          events
            .slice(-10)
            .reverse()
            .map((e, i) => (
              <li key={i} className="flex items-center gap-3 py-2 text-xs">
                <span className="text-neutral-500">{timeAgo(e.timestamp)}</span>
                <span
                  className={classes(
                    "h-1.5 w-1.5 rounded-full",
                    e.result === "ok" ? "bg-ok-500" : "bg-bad-500",
                  )}
                />
                <span className="font-medium text-neutral-900">{e.action}</span>
                <span className="text-neutral-500">{e.target ?? ""}</span>
                <span className="ml-auto rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">
                  {e.actor}
                </span>
              </li>
            ))
        )}
      </ol>
    </section>
  );
}

// ---------- right rail ----------

function CoordinatorChat() {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
          Supreme Coordinator
          <span className="text-[10px] font-normal text-ok-600">Online (stub)</span>
        </div>
        <span className="text-neutral-400">...</span>
      </div>
      <div className="space-y-3 p-3 text-xs">
        <div className="rounded-md bg-neutral-100 px-3 py-2 text-neutral-700">
          A client wants a mobile app.
        </div>
        <div className="space-y-2 rounded-md border border-neutral-200 p-3">
          <div className="text-neutral-900">
            Opportunity intake will be implemented in Phase 9 (Supreme Coordinator agent). For now,
            the kernel writes structured intake artifacts when you run{" "}
            <code className="rounded bg-neutral-100 px-1">bureau opportunity create</code>.
          </div>
        </div>
        <div className="flex gap-2">
          <button className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-700">
            Create proposal
          </button>
          <button className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-700">
            Launch discovery
          </button>
          <button className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-700">
            Prepare estimate
          </button>
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
  return (
    <section className="rounded-lg border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <div className="text-sm font-semibold text-neutral-900">
          Pending Approvals ({approvals.length})
        </div>
        <span className="text-xs text-neutral-500">View all</span>
      </div>
      <div className="divide-y divide-neutral-100">
        {approvals.length === 0 ? (
          <div className="px-4 py-6 text-xs text-neutral-500">No approvals waiting.</div>
        ) : (
          approvals.map((a) => (
            <div key={a.id} className="space-y-2 px-4 py-3 text-xs">
              <div className="font-medium text-neutral-900">{a.action}</div>
              <div className="text-neutral-500">
                {a.target} - {a.scope}
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded-md bg-ok-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-ok-600"
                  onClick={() => void onResolve(a.id, "approved")}
                >
                  Approve
                </button>
                <button
                  className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-700 hover:bg-neutral-100"
                  onClick={() => void onResolve(a.id, "rejected")}
                >
                  Reject
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="border-t border-neutral-200 px-4 py-2 text-[10px] text-neutral-500">
        Autonomous mode is handling all draft work; only external commitments need approval.
      </div>
    </section>
  );
}

// ---------- revenue pulse ----------

function KpiCard({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold text-neutral-900">{value}</div>
      {delta && <div className="mt-0.5 text-xs text-ok-600">{delta}</div>}
    </div>
  );
}

function RevenuePulse({
  pulse,
  opportunities,
}: {
  pulse?: CompanyPulse;
  opportunities: OpportunityRecord[];
}) {
  const pipeline = pulse?.revenue.pipeline_value ?? 0;
  const active = pulse?.revenue.active_opportunities ?? 0;
  const margin = opportunities.length
    ? opportunities.reduce((acc, o) => acc + (o.expected_margin || 0), 0) / opportunities.length
    : 0;
  const won = opportunities.filter((o) => o.status === "won");
  const wonValue = won.reduce((acc, o) => acc + (o.expected_value || 0), 0);
  return (
    <section className="rounded-lg border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Revenue Pulse</h2>
          <p className="text-xs text-neutral-500">Real-time revenue and pipeline health.</p>
        </div>
        <span className="text-xs text-neutral-500">View full report</span>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-5">
        <KpiCard label="Pipeline Value" value={formatMoney(pipeline)} />
        <KpiCard label="Expected Margin" value={`${Math.round(margin)}%`} />
        <KpiCard label="Active Opportunities" value={String(active)} />
        <KpiCard label="Won (MTD)" value={formatMoney(wonValue)} />
        <KpiCard label="Client LTV" value={formatMoney(wonValue)} />
      </div>
    </section>
  );
}

// ---------- agent layer ----------

function AgentLayer({ agents }: { agents: AgentDefinition[] }) {
  const visible = agents.slice(0, 11);
  return (
    <section className="border-t border-neutral-200 bg-white">
      <div className="flex items-center justify-between px-4 py-2">
        <div>
          <div className="text-sm font-semibold text-neutral-900">Agent Layer</div>
          <div className="text-[10px] text-neutral-500">
            Autonomous teams executing across functions.
          </div>
        </div>
        <span className="text-xs text-neutral-500">Manage Agents</span>
      </div>
      <div className="flex gap-2 overflow-x-auto px-4 pb-3">
        {visible.map((a) => (
          <div
            key={a.id}
            className="flex min-w-[140px] items-center gap-2 rounded-md border border-neutral-200 px-3 py-2"
            title={a.description}
          >
            <span className="grid h-6 w-6 place-items-center rounded bg-neutral-100 text-[10px] font-medium text-neutral-700">
              {a.role.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <div className="text-xs font-medium text-neutral-900">{a.role}</div>
              <div className="text-[10px] text-neutral-500">{a.category}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- root ----------

function GoalsView({ state }: { state: DashboardState }) {
  const opps = state.opportunities;
  const totalValue = opps.reduce((acc, o) => acc + (o.expected_value || 0), 0);
  const wonValue = opps
    .filter((o) => o.status === "won")
    .reduce((acc, o) => acc + (o.expected_value || 0), 0);
  const margin = opps.length
    ? opps.reduce((acc, o) => acc + (o.expected_margin || 0), 0) / opps.length
    : 0;

  return (
    <section className="rounded-lg border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-neutral-900">Business Goals</h2>
        <p className="text-xs text-neutral-500">Where the company is heading this quarter.</p>
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div className="rounded-md border border-neutral-200 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Pipeline</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-neutral-900">
            {formatMoney(totalValue)}
          </div>
          <div className="text-xs text-neutral-500">
            {opps.length} opportunities across {state.clients.length} clients
          </div>
        </div>
        <div className="rounded-md border border-neutral-200 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">
            Won (cumulative)
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold text-neutral-900">
            {formatMoney(wonValue)}
          </div>
          <div className="text-xs text-neutral-500">Expected margin {Math.round(margin)}%</div>
        </div>
      </div>
      <div className="border-t border-neutral-200 px-4 py-3">
        <div className="text-xs font-medium text-neutral-700">Opportunity pipeline</div>
        <ol className="mt-2 space-y-1 text-xs text-neutral-700">
          {opps.length === 0 ? (
            <li className="text-neutral-500">No opportunities yet.</li>
          ) : (
            opps.map((o) => (
              <li key={o.id} className="flex justify-between rounded bg-neutral-50 px-2 py-1">
                <span>{o.title}</span>
                <span className="text-neutral-500">
                  {o.status} - {formatMoney(o.expected_value || 0)}
                </span>
              </li>
            ))
          )}
        </ol>
      </div>
    </section>
  );
}

function TodayView({ state }: { state: DashboardState }) {
  const blockedRuns = state.runs.filter(
    (r) => r.status === "blocked" || r.status === "needs_human",
  );
  const blockedProjects = state.projects.filter((p) => p.status === "blocked");
  return (
    <section className="rounded-lg border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-neutral-900">Today</h2>
        <p className="text-xs text-neutral-500">What needs your attention right now.</p>
      </div>
      <div className="space-y-4 p-4 text-xs">
        <div>
          <div className="font-medium text-neutral-700">
            Approvals waiting ({state.approvals.length})
          </div>
          {state.approvals.length === 0 ? (
            <div className="mt-1 text-neutral-500">Nothing waiting.</div>
          ) : (
            <ul className="mt-1 space-y-1">
              {state.approvals.map((a) => (
                <li key={a.id} className="rounded bg-neutral-50 px-2 py-1">
                  {a.action} - {a.target} ({a.scope})
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="font-medium text-neutral-700">
            Blocked work ({blockedRuns.length + blockedProjects.length})
          </div>
          {blockedRuns.length + blockedProjects.length === 0 ? (
            <div className="mt-1 text-neutral-500">No blockers.</div>
          ) : (
            <ul className="mt-1 space-y-1">
              {blockedRuns.map((r) => (
                <li key={r.id} className="rounded bg-neutral-50 px-2 py-1">
                  Run {r.id} - {r.status}: {r.scope}
                </li>
              ))}
              {blockedProjects.map((p) => (
                <li key={p.id} className="rounded bg-neutral-50 px-2 py-1">
                  Project {p.name} blocked
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

export function App() {
  const { state, refresh } = useDashboard();
  const [mode, setMode] = useState<AdaptiveMode>("portfolio");

  const onResolve = async (id: string, status: "approved" | "rejected"): Promise<void> => {
    try {
      await Api.resolveApproval(id, status);
      await refresh();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex h-full min-h-screen">
      <Sidebar state={state} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header pulse={state.pulse} mode={mode} onModeChange={setMode} />
        <main className="flex flex-1 gap-4 overflow-auto p-4">
          <div className="flex flex-1 flex-col gap-4">
            {mode === "portfolio" && <PortfolioMap state={state} />}
            {mode === "today" && <TodayView state={state} />}
            {mode === "goals" && <GoalsView state={state} />}
            <OperationsTimeline events={state.audit} />
            <RevenuePulse pulse={state.pulse} opportunities={state.opportunities} />
          </div>
          <div className="flex w-80 flex-shrink-0 flex-col gap-4">
            <CoordinatorChat />
            <PendingApprovals approvals={state.approvals} onResolve={onResolve} />
          </div>
        </main>
        <AgentLayer agents={state.agents} />
        {state.error && (
          <div className="border-t border-bad-500 bg-bad-500/10 px-4 py-2 text-xs text-bad-600">
            API server unreachable: {state.error} - start it with <code>bureau serve</code> or
            launch the desktop app.
          </div>
        )}
      </div>
    </div>
  );
}
