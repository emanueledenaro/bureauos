import { useEffect, useState } from "react";
import { Api, type AuditEvent } from "../lib/api";
import type { DashboardState } from "../lib/types";

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

export function useDashboard(): {
  state: DashboardState;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<DashboardState>(emptyState);

  const refresh = async (): Promise<void> => {
    try {
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
        providers,
        settings,
        providerConnectors,
        audit,
      ] = await Promise.all([
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
        Api.providers(),
        Api.settings(),
        Api.providerConnectors(),
        Api.audit(30),
      ]);
      setState({
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
