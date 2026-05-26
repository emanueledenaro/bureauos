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
  runs: [],
  agents: [],
  capabilities: [],
  providers: [],
  providerConnectors: [],
  artifacts: [],
  audit: [],
  policyExplain: undefined,
  loading: true,
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

export function useDashboard(): {
  state: DashboardState;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<DashboardState>(emptyState);

  const refreshDashboard = async ({
    includeAudit = false,
  }: DashboardRefreshOptions = {}): Promise<void> => {
    try {
      const coreRequests = [
        Api.pulse(),
        Api.clients(),
        Api.clientIntelligence(),
        Api.projects(),
        Api.projectOwnership(),
        Api.opportunities(),
        Api.growthMemory(),
        Api.approvals(),
        Api.approvalsResolved(),
        Api.runs(),
        Api.agents(),
        Api.capabilities(),
        Api.artifacts(),
        Api.policyExplain(),
        Api.providers(),
        Api.settings(),
        Api.providerConnectors(),
      ] as const;

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
        runs,
        agents,
        capabilities,
        artifacts,
        policyExplain,
        providers,
        settings,
        providerConnectors,
      ] = await Promise.all(coreRequests);
      const audit = includeAudit ? await Api.audit(30) : undefined;

      setState((current) => ({
        pulse,
        clients,
        clientIntelligence,
        projects,
        projectOwnership,
        opportunities,
        growthMemory,
        approvals,
        resolvedApprovals,
        runs,
        agents,
        capabilities,
        artifacts,
        policyExplain,
        providers,
        settings,
        providerConnectors,
        audit: audit ? mergeAuditEvents(current.audit, audit) : current.audit,
        loading: false,
      }));
    } catch (e) {
      setState((current) => ({ ...current, loading: false, error: (e as Error).message }));
    }
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
