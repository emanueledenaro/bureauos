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
function coreRequests() {
  return [
    Api.pulse(),
    Api.clients(),
    Api.clientIntelligence(),
    Api.projects(),
    Api.projectOwnership(),
    Api.opportunities(),
    Api.growthMemory(),
    Api.approvals(),
    Api.approvalsResolved(),
    Api.notifications(),
    Api.runs(),
    Api.agents(),
    Api.capabilities(),
    Api.artifacts(),
    Api.policyExplain(),
    Api.providers(),
    Api.settings(),
    Api.providerConnectors(),
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

  const refreshDashboard = async ({
    includeAudit = false,
  }: DashboardRefreshOptions = {}): Promise<void> => {
    // allSettled (not all): one rejected endpoint must not blank the dashboard.
    const results: CoreSettledResults = await Promise.allSettled(coreRequests());
    const auditResult = includeAudit
      ? await Promise.allSettled([Api.audit(30)]).then((settled) => settled[0])
      : undefined;

    setState((current) => applyCoreResults(current, results, auditResult));
  };

  const refresh = async (): Promise<void> => refreshDashboard({ includeAudit: true });

  useEffect(() => {
    void refreshDashboard({ includeAudit: true });
    const timer = setInterval(
      () => void refreshDashboard({ includeAudit: false }),
      CORE_REFRESH_INTERVAL_MS,
    );

    let stream: EventSource | undefined;
    let auditFallbackTimer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    const pollAudit = async (): Promise<void> => {
      try {
        const events = await Api.audit(30);
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
      clearInterval(timer);
      if (auditFallbackTimer) clearInterval(auditFallbackTimer);
      stream?.close();
    };
  }, []);

  return { state, refresh };
}
