import { useEffect, useState } from "react";
import { Api, type AuditEvent } from "../lib/api";
import type { DashboardState } from "../lib/types";

const AUDIT_EVENT_LIMIT = 60;
const CORE_REFRESH_INTERVAL_MS = 15000;
const AUDIT_FALLBACK_INTERVAL_MS = 15000;

const emptyState: DashboardState = {
  clients: [],
  projects: [],
  projectOwnership: [],
  opportunities: [],
  approvals: [],
  resolvedApprovals: [],
  notifications: [],
  runs: [],
  agents: [],
  capabilities: [],
  providers: [],
  providerConnectors: [],
  artifacts: [],
  audit: [],
  policyExplain: undefined,
  loading: true,
  hasLoaded: false,
};

function auditEventKey(event: AuditEvent): string {
  return [event.timestamp, event.actor, event.action, event.target ?? "", event.result].join("|");
}

export function mergeAuditEvents(
  current: AuditEvent[],
  incoming: AuditEvent[],
  limit = AUDIT_EVENT_LIMIT,
): AuditEvent[] {
  const eventsByKey = new Map<string, AuditEvent>();
  for (const event of [...current, ...incoming]) {
    eventsByKey.set(auditEventKey(event), event);
  }

  return [...eventsByKey.values()]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-limit);
}

interface DashboardRefreshOptions {
  includeAudit?: boolean;
}

/**
 * The ordered batch of core dashboard requests. The first entry (company pulse)
 * doubles as the health probe used to decide whether to show a global error.
 *
 * Order is load-bearing: `applyCoreResults` destructures the settled results in
 * exactly this sequence. Deriving `CoreSettledResults` from this factory keeps
 * the two in lockstep.
 */
function coreRequests(signal?: AbortSignal) {
  return [
    Api.pulse(signal),
    Api.clients(signal),
    Api.clientIntelligence(signal),
    Api.projects(signal),
    Api.projectOwnership(signal),
    Api.opportunities(signal),
    Api.growthMemory(signal),
    Api.approvals(signal),
    Api.approvalsResolved(signal),
    Api.notifications(signal),
    Api.runs(signal),
    Api.agents(signal),
    Api.capabilities(signal),
    Api.artifacts(signal),
    Api.policyExplain(20, signal),
    Api.providers(signal),
    Api.settings(signal),
    Api.providerConnectors(signal),
  ] as const;
}

/** Maps a tuple of promises to the matching tuple of settled results. */
type SettledTuple<T extends readonly unknown[]> = {
  [K in keyof T]: PromiseSettledResult<Awaited<T[K]>>;
};

type CoreSettledResults = SettledTuple<ReturnType<typeof coreRequests>>;

/**
 * Reads a settled result, falling back to the last-good value when the request
 * rejected. Keeping the previous slice avoids blanking the dashboard when a
 * single endpoint is briefly unavailable.
 */
function settledOr<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

/**
 * Builds the next dashboard state from a batch of settled core requests.
 *
 * Behaviour (SER-154):
 * - Each slice keeps its last-good (or empty) value when its request rejects,
 *   so one failing endpoint never blanks the whole dashboard.
 * - The global `error` is only set when the health probe (company pulse) fails
 *   or when every core request fails. Partial failures stay silent and recover
 *   on the next tick.
 */
export function applyCoreResults(
  current: DashboardState,
  results: CoreSettledResults,
  auditResult: PromiseSettledResult<AuditEvent[]> | undefined,
): DashboardState {
  const [
    pulse,
    clients,
    clientIntelligence,
    projects,
    projectOwnership,
    opportunities,
    growthMemory,
    approvals,
    resolvedApprovals,
    notifications,
    runs,
    agents,
    capabilities,
    artifacts,
    policyExplain,
    providers,
    settings,
    providerConnectors,
  ] = results;

  const healthOk = pulse.status === "fulfilled";
  const allFailed =
    results.every((result) => result.status === "rejected") &&
    (auditResult === undefined || auditResult.status === "rejected");

  // Surface an error banner only on a real health failure or a total outage.
  // A real probe failure carries the rejection message; an all-failed batch
  // borrows the first available rejection reason for context.
  let error: string | undefined;
  if (!healthOk) {
    error = pulse.reason instanceof Error ? pulse.reason.message : String(pulse.reason);
  } else if (allFailed) {
    const firstRejection = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    error = firstRejection
      ? firstRejection.reason instanceof Error
        ? firstRejection.reason.message
        : String(firstRejection.reason)
      : "API server unreachable";
  }

  const audit = auditResult
    ? mergeAuditEvents(current.audit, settledOr(auditResult, []))
    : current.audit;

  return {
    pulse: settledOr(pulse, current.pulse),
    clients: settledOr(clients, current.clients),
    clientIntelligence: settledOr(clientIntelligence, current.clientIntelligence),
    projects: settledOr(projects, current.projects),
    projectOwnership: settledOr(projectOwnership, current.projectOwnership),
    opportunities: settledOr(opportunities, current.opportunities),
    growthMemory: settledOr(growthMemory, current.growthMemory),
    approvals: settledOr(approvals, current.approvals),
    resolvedApprovals: settledOr(resolvedApprovals, current.resolvedApprovals),
    notifications: settledOr(notifications, current.notifications),
    runs: settledOr(runs, current.runs),
    agents: settledOr(agents, current.agents),
    capabilities: settledOr(capabilities, current.capabilities),
    artifacts: settledOr(artifacts, current.artifacts),
    policyExplain: settledOr(policyExplain, current.policyExplain),
    providers: settledOr(providers, current.providers),
    settings: settledOr(settings, current.settings),
    providerConnectors: settledOr(providerConnectors, current.providerConnectors),
    audit,
    error,
    loading: false,
    hasLoaded: true,
  };
}

export function useDashboard(): {
  state: DashboardState;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<DashboardState>(emptyState);

  const refreshDashboard = async (
    { includeAudit = false }: DashboardRefreshOptions = {},
    signal?: AbortSignal,
  ): Promise<void> => {
    // allSettled (not all): one rejected endpoint must not blank the dashboard.
    const results: CoreSettledResults = await Promise.allSettled(coreRequests(signal));
    const auditResult = includeAudit
      ? await Promise.allSettled([Api.audit(30, signal)]).then((settled) => settled[0])
      : undefined;

    // The cycle was aborted (unmount) — don't apply its now-stale results.
    if (signal?.aborted) return;
    setState((current) => applyCoreResults(current, results, auditResult));
  };

  const refresh = async (): Promise<void> => refreshDashboard({ includeAudit: true });

  useEffect(() => {
    let cancelled = false;
    // Aborts the in-flight fan-out on unmount so its ~18 sockets release instead
    // of leaking against Chrome's 6-per-host budget (SER-222).
    const controller = new AbortController();
    let stream: EventSource | undefined;
    let auditFallbackTimer: ReturnType<typeof setInterval> | undefined;

    // Skip a tick while the previous fan-out is still in flight: overlapping
    // cycles would stack ~18 more sockets each and exhaust the connection budget
    // under a slow backend (SER-222). One refresh cycle at a time.
    let refreshing = false;
    const tick = async (includeAudit: boolean): Promise<void> => {
      if (cancelled || refreshing) return;
      refreshing = true;
      try {
        await refreshDashboard({ includeAudit }, controller.signal);
      } finally {
        refreshing = false;
      }
    };

    void tick(true);
    const timer = setInterval(() => void tick(false), CORE_REFRESH_INTERVAL_MS);

    const pollAudit = async (): Promise<void> => {
      try {
        const events = await Api.audit(30, controller.signal);
        if (cancelled) return;
        setState((current) => ({
          ...current,
          audit: mergeAuditEvents(current.audit, events),
        }));
      } catch {
        // Keep the dashboard usable; the next fallback tick can recover.
      }
    };

    const startAuditFallback = (): void => {
      if (cancelled || auditFallbackTimer) return;
      void pollAudit();
      auditFallbackTimer = setInterval(() => void pollAudit(), AUDIT_FALLBACK_INTERVAL_MS);
    };

    (async () => {
      try {
        const base = await (window.bureau
          ? window.bureau.apiUrl()
          : Promise.resolve("http://127.0.0.1:3737"));
        if (cancelled || !base) return;
        if (typeof EventSource === "undefined") {
          startAuditFallback();
          return;
        }
        stream = new EventSource(`${base}/events`);
        stream.addEventListener("audit", (event) => {
          try {
            const item = JSON.parse((event as MessageEvent).data) as AuditEvent;
            setState((current) => ({
              ...current,
              audit: mergeAuditEvents(current.audit, [item]),
            }));
          } catch {
            // The fallback covers malformed events if the stream later disconnects.
          }
        });
        stream.onerror = () => {
          stream?.close();
          stream = undefined;
          startAuditFallback();
        };
      } catch {
        startAuditFallback();
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
      if (auditFallbackTimer) clearInterval(auditFallbackTimer);
      stream?.close();
    };
  }, []);

  return { state, refresh };
}
