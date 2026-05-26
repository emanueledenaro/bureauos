import { useCallback, useEffect, useState } from "react";
import { Sidebar, SidebarDrawer } from "./components/layout/Sidebar";
import { Header } from "./components/layout/Header";
import { AgentLayer } from "./components/layout/AgentLayer";
import { QuickChatPopover } from "./components/coordinator/QuickChatPopover";
import { TooltipProvider } from "./components/ui/tooltip";
import { CoordinatorView } from "./views/CoordinatorView";
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
import { RevenuePulseView } from "./views/RevenuePulseView";
import { useDashboard } from "./hooks/useDashboard";
import { adaptiveDefaultMode } from "./lib/builders";
import {
  Api,
  type AutonomousRetryResult,
  type BusinessReportResult,
  type ClientSuccessStatusResult,
  type CoordinatorAttachmentInput,
  type CoordinatorChatResult,
  type CoordinatorChatStreamHandlers,
  type GrowthContentPipelineResult,
  type MemoryTriggerResult,
  type ProjectRepositoryVerificationResult,
  type RevenuePipelineResult,
} from "./lib/api";
import type { AdaptiveMode, DashboardState } from "./lib/types";

export function App() {
  const { state, refresh } = useDashboard();
  const [mode, setMode] = useState<AdaptiveMode>("portfolio");
  const [modeTouched, setModeTouched] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [quickChatOpen, setQuickChatOpen] = useState(false);

  useEffect(() => {
    if (!modeTouched && !state.loading) {
      setMode(adaptiveDefaultMode(state));
    }
  }, [modeTouched, state]);

  // ⌘K / Ctrl+K apre il quick-chat coordinator da qualsiasi vista.
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuickChatOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const openCoordinatorPage = useCallback((): void => {
    setQuickChatOpen(false);
    setModeTouched(true);
    setMode("coordinator");
  }, []);

  const onModeChange = (nextMode: AdaptiveMode): void => {
    setModeTouched(true);
    setMode(nextMode);
  };

  const onResolve = async (
    id: string,
    status: "approved" | "rejected",
    reason?: string,
  ): Promise<void> => {
    try {
      await Api.resolveApproval(id, status, reason);
    } finally {
      await refresh();
    }
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

  const onCoordinatorMessageStream = async (
    message: string,
    attachments: CoordinatorAttachmentInput[] | undefined,
    handlers: CoordinatorChatStreamHandlers,
  ): Promise<CoordinatorChatResult> => {
    const result = await Api.coordinatorChatStream(
      {
        message,
        ...(attachments?.length ? { attachments } : {}),
      },
      handlers,
    );
    await refresh();
    return result;
  };

  const onGenerateReport = async (): Promise<BusinessReportResult> => {
    const result = await Api.generateReports();
    await refresh();
    return result;
  };

  const onGenerateGrowthContent = async (): Promise<GrowthContentPipelineResult> => {
    const result = await Api.generateGrowthContent({ maxDrafts: 4 });
    await refresh();
    return result;
  };

  const onGenerateRevenuePipeline = async (): Promise<RevenuePipelineResult> => {
    const result = await Api.generateRevenuePipeline({ maxOpportunities: 5 });
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

  const onGenerateClientSuccessStatus = async (): Promise<ClientSuccessStatusResult> => {
    const result = await Api.generateClientSuccessStatus();
    await refresh();
    return result;
  };

  const onMemoryTriggerScan = async (): Promise<MemoryTriggerResult> => {
    const result = await Api.memoryTriggerScan();
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
            onOpenQuickChat={() => setQuickChatOpen(true)}
          />
          <main className="min-w-0 flex-1 overflow-y-auto bg-background">
            <DashboardLayout
              mode={mode}
              state={state}
              onModeChange={onModeChange}
              onResolve={onResolve}
              onCoordinatorMessage={onCoordinatorMessage}
              onCoordinatorMessageStream={onCoordinatorMessageStream}
              onGenerateReport={onGenerateReport}
              onProviderLogin={onProviderLogin}
              onProviderLogout={onProviderLogout}
              onVerifyRepositories={onVerifyRepositories}
              onRetryScan={onRetryScan}
              onGenerateClientSuccessStatus={onGenerateClientSuccessStatus}
              onMemoryTriggerScan={onMemoryTriggerScan}
              onGenerateGrowthContent={onGenerateGrowthContent}
              onGenerateRevenuePipeline={onGenerateRevenuePipeline}
              onRefresh={refresh}
            />
          </main>
          <AgentLayer agents={state.agents} />
          {state.error ? (
            <div className="border-t border-danger/40 bg-danger-subtle/40 px-5 py-2 text-meta text-danger">
              API server unreachable: {state.error}
            </div>
          ) : null}
        </div>
        <QuickChatPopover
          open={quickChatOpen}
          onOpenChange={setQuickChatOpen}
          onSubmit={onCoordinatorMessage}
          onOpenFullCoordinator={openCoordinatorPage}
        />
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
  onCoordinatorMessageStream,
  onGenerateReport,
  onProviderLogin,
  onProviderLogout,
  onVerifyRepositories,
  onRetryScan,
  onGenerateClientSuccessStatus,
  onMemoryTriggerScan,
  onGenerateGrowthContent,
  onGenerateRevenuePipeline,
  onRefresh,
}: {
  mode: AdaptiveMode;
  state: DashboardState;
  onModeChange: (mode: AdaptiveMode) => void;
  onResolve: (id: string, status: "approved" | "rejected", reason?: string) => Promise<void>;
  onCoordinatorMessage: (
    message: string,
    attachments?: CoordinatorAttachmentInput[],
  ) => Promise<CoordinatorChatResult>;
  onCoordinatorMessageStream: (
    message: string,
    attachments: CoordinatorAttachmentInput[] | undefined,
    handlers: CoordinatorChatStreamHandlers,
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
  onGenerateClientSuccessStatus: () => Promise<ClientSuccessStatusResult>;
  onMemoryTriggerScan: () => Promise<MemoryTriggerResult>;
  onGenerateGrowthContent: () => Promise<GrowthContentPipelineResult>;
  onGenerateRevenuePipeline: () => Promise<RevenuePipelineResult>;
  onRefresh: () => Promise<void>;
}) {
  // La pagina coordinator richiede tutta l'altezza utile e non ha le righe
  // dashboard sotto (Timeline/RevenuePulse). Layout dedicato.
  if (mode === "coordinator") {
    return (
      <div className="mx-auto flex h-full w-full max-w-[1800px] flex-col p-3 sm:p-4 lg:p-5">
        <CoordinatorView
          state={state}
          onMessage={onCoordinatorMessage}
          onStreamMessage={onCoordinatorMessageStream}
          onModeChange={onModeChange}
        />
      </div>
    );
  }

  const mainView = renderMainView({
    mode,
    state,
    onModeChange,
    onResolve,
    onProviderLogin,
    onProviderLogout,
    onVerifyRepositories,
    onRetryScan,
    onGenerateClientSuccessStatus,
    onMemoryTriggerScan,
    onGenerateGrowthContent,
    onGenerateRevenuePipeline,
    onRefresh,
  });

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-3 sm:p-4 lg:p-5">
      {mainView}
      <TimelineView
        events={state.audit}
        artifacts={state.artifacts}
        runs={state.runs}
        approvals={state.approvals}
        resolvedApprovals={state.resolvedApprovals}
      />
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
  onGenerateClientSuccessStatus,
  onMemoryTriggerScan,
  onGenerateGrowthContent,
  onGenerateRevenuePipeline,
  onRefresh,
}: {
  mode: AdaptiveMode;
  state: DashboardState;
  onModeChange: (mode: AdaptiveMode) => void;
  onResolve: (id: string, status: "approved" | "rejected", reason?: string) => Promise<void>;
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
  onGenerateClientSuccessStatus: () => Promise<ClientSuccessStatusResult>;
  onMemoryTriggerScan: () => Promise<MemoryTriggerResult>;
  onGenerateGrowthContent: () => Promise<GrowthContentPipelineResult>;
  onGenerateRevenuePipeline: () => Promise<RevenuePipelineResult>;
  onRefresh: () => Promise<void>;
}) {
  switch (mode) {
    case "coordinator":
      // Handled by DashboardLayout's early branch.
      return null;
    case "portfolio":
      return <PortfolioView state={state} />;
    case "today":
      return (
        <TodayView
          state={state}
          onModeChange={onModeChange}
          onMemoryTriggerScan={onMemoryTriggerScan}
        />
      );
    case "goals":
      return <GoalsView state={state} onModeChange={onModeChange} />;
    case "revenue":
      return <RevenueView state={state} onGeneratePipeline={onGenerateRevenuePipeline} />;
    case "delivery":
      return <DeliveryView state={state} onVerifyRepositories={onVerifyRepositories} />;
    case "growth":
      return <GrowthView state={state} onGenerateContent={onGenerateGrowthContent} />;
    case "clients":
      return (
        <ClientsView
          state={state}
          onGenerateSuccessStatus={onGenerateClientSuccessStatus}
          onMemoryTriggerScan={onMemoryTriggerScan}
        />
      );
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
