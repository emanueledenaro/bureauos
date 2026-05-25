import { useEffect, useState } from "react";
import { Sidebar, SidebarDrawer } from "./components/layout/Sidebar";
import { Header } from "./components/layout/Header";
import { AgentLayer } from "./components/layout/AgentLayer";
import { CoordinatorPanel } from "./components/coordinator/CoordinatorPanel";
import { Sheet, SheetContent, SheetTitle } from "./components/ui/sheet";
import { TooltipProvider } from "./components/ui/tooltip";
import { PortfolioView } from "./views/PortfolioView";
import { TodayView } from "./views/TodayView";
import { GoalsView } from "./views/GoalsView";
import { RevenueView } from "./views/RevenueView";
import { DeliveryView } from "./views/DeliveryView";
import { GrowthView } from "./views/GrowthView";
import { ClientsView } from "./views/ClientsView";
import { RiskView } from "./views/RiskView";
import { ApprovalsView } from "./views/ApprovalsView";
import { MemoryView } from "./views/MemoryView";
import { AgentsView } from "./views/AgentsView";
import { ReportsView } from "./views/ReportsView";
import { SettingsView } from "./views/SettingsView";
import { TimelineView } from "./views/TimelineView";
import { PendingApprovalsView } from "./views/PendingApprovalsView";
import { RevenuePulseView } from "./views/RevenuePulseView";
import { useDashboard } from "./hooks/useDashboard";
import { adaptiveDefaultMode } from "./lib/builders";
import {
  Api,
  type AutonomousRetryResult,
  type BusinessReportResult,
  type CoordinatorAttachmentInput,
  type CoordinatorChatResult,
  type ProjectRepositoryVerificationResult,
} from "./lib/api";
import type { AdaptiveMode, DashboardState } from "./lib/types";

export function App() {
  const { state, refresh } = useDashboard();
  const [mode, setMode] = useState<AdaptiveMode>("portfolio");
  const [modeTouched, setModeTouched] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [coordinatorOpen, setCoordinatorOpen] = useState(false);

  useEffect(() => {
    if (!modeTouched && !state.loading) {
      setMode(adaptiveDefaultMode(state));
    }
  }, [modeTouched, state]);

  const onModeChange = (nextMode: AdaptiveMode): void => {
    setModeTouched(true);
    setMode(nextMode);
  };

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

  const onVerifyRepositories = async (
    projectSlug?: string,
  ): Promise<ProjectRepositoryVerificationResult> => {
    const result = await Api.verifyProjectRepositories({
      ...(projectSlug ? { projectSlug } : {}),
    });
    await refresh();
    return result;
  };

  const onRetryScan = async (): Promise<AutonomousRetryResult> => {
    const result = await Api.autonomyRetryScan();
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
    <TooltipProvider delayDuration={120}>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <Sidebar state={state} mode={mode} onModeChange={onModeChange} />
        <SidebarDrawer
          state={state}
          mode={mode}
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          onModeChange={onModeChange}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            state={state}
            mode={mode}
            onModeChange={onModeChange}
            onOpenSidebar={() => setSidebarOpen(true)}
            onOpenCoordinator={() => setCoordinatorOpen(true)}
          />
          <main className="flex-1 overflow-y-auto bg-background">
            <DashboardLayout
              mode={mode}
              state={state}
              onModeChange={onModeChange}
              onResolve={onResolve}
              onCoordinatorMessage={onCoordinatorMessage}
              onGenerateReport={onGenerateReport}
              onProviderLogin={onProviderLogin}
              onProviderLogout={onProviderLogout}
              onVerifyRepositories={onVerifyRepositories}
              onRetryScan={onRetryScan}
              onRefresh={refresh}
            />
          </main>
          <AgentLayer agents={state.agents} />
          {state.error ? (
            <div className="border-t border-danger/40 bg-danger-subtle/40 px-5 py-2 text-[11px] text-danger">
              API server unreachable: {state.error}
            </div>
          ) : null}
        </div>
        <Sheet open={coordinatorOpen} onOpenChange={setCoordinatorOpen}>
          <SheetContent side="right" className="w-[92vw] max-w-[420px] p-3">
            <SheetTitle className="sr-only">Supreme Coordinator</SheetTitle>
            <CoordinatorPanel onMessage={onCoordinatorMessage} />
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}

function DashboardLayout({
  mode,
  state,
  onModeChange,
  onResolve,
  onCoordinatorMessage,
  onGenerateReport,
  onProviderLogin,
  onProviderLogout,
  onVerifyRepositories,
  onRetryScan,
  onRefresh,
}: {
  mode: AdaptiveMode;
  state: DashboardState;
  onModeChange: (mode: AdaptiveMode) => void;
  onResolve: (id: string, status: "approved" | "rejected") => Promise<void>;
  onCoordinatorMessage: (
    message: string,
    attachments?: CoordinatorAttachmentInput[],
  ) => Promise<CoordinatorChatResult>;
  onGenerateReport: () => Promise<BusinessReportResult>;
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
  onVerifyRepositories: (projectSlug?: string) => Promise<ProjectRepositoryVerificationResult>;
  onRetryScan: () => Promise<AutonomousRetryResult>;
  onRefresh: () => Promise<void>;
}) {
  const mainView = renderMainView({
    mode,
    state,
    onModeChange,
    onResolve,
    onProviderLogin,
    onProviderLogout,
    onVerifyRepositories,
    onRetryScan,
    onRefresh,
  });

  return (
    <div className="mx-auto flex max-w-[1640px] flex-col gap-4 p-4 lg:p-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-4">
          {mainView}
          <TimelineView events={state.audit} artifacts={state.artifacts} />
        </div>
        <div className="hidden min-w-0 flex-col gap-4 xl:flex">
          <CoordinatorPanel onMessage={onCoordinatorMessage} />
          <PendingApprovalsView
            approvals={state.approvals}
            onResolve={onResolve}
            onOpen={() => onModeChange("approvals")}
          />
        </div>
      </div>
      <RevenuePulseView
        pulse={state.pulse}
        clients={state.clients}
        opportunities={state.opportunities}
        onGenerateReport={onGenerateReport}
      />
    </div>
  );
}

function renderMainView({
  mode,
  state,
  onModeChange,
  onResolve,
  onProviderLogin,
  onProviderLogout,
  onVerifyRepositories,
  onRetryScan,
  onRefresh,
}: {
  mode: AdaptiveMode;
  state: DashboardState;
  onModeChange: (mode: AdaptiveMode) => void;
  onResolve: (id: string, status: "approved" | "rejected") => Promise<void>;
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
  onVerifyRepositories: (projectSlug?: string) => Promise<ProjectRepositoryVerificationResult>;
  onRetryScan: () => Promise<AutonomousRetryResult>;
  onRefresh: () => Promise<void>;
}) {
  switch (mode) {
    case "portfolio":
      return <PortfolioView state={state} />;
    case "today":
      return <TodayView state={state} onModeChange={onModeChange} />;
    case "goals":
      return <GoalsView state={state} onModeChange={onModeChange} />;
    case "revenue":
      return <RevenueView state={state} />;
    case "delivery":
      return <DeliveryView state={state} onVerifyRepositories={onVerifyRepositories} />;
    case "growth":
      return <GrowthView state={state} />;
    case "clients":
      return <ClientsView state={state} />;
    case "risk":
      return <RiskView state={state} onRetryScan={onRetryScan} />;
    case "approvals":
      return <ApprovalsView state={state} onResolve={onResolve} />;
    case "memory":
      return <MemoryView state={state} />;
    case "agents":
      return <AgentsView state={state} />;
    case "reports":
      return <ReportsView state={state} />;
    case "settings":
      return (
        <SettingsView
          settings={state.settings}
          providers={state.providers}
          providerConnectors={state.providerConnectors}
          onProviderLogin={onProviderLogin}
          onProviderLogout={onProviderLogout}
          onRefresh={onRefresh}
        />
      );
    default:
      return <PortfolioView state={state} />;
  }
}
