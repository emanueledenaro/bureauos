import { useState } from "react";
import { AlertTriangle, Briefcase, DollarSign, FileText, RefreshCw, Users } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { ClientAccountCard } from "../components/dashboard/ClientAccountCard";
import { EmptyState } from "../components/dashboard/EmptyState";
import { Button } from "../components/ui/button";
import { formatMoney } from "../lib/format";
import type { ClientSuccessStatusResult, MemoryTriggerResult } from "../lib/api";
import type { DashboardState } from "../lib/types";

export function ClientsView({
  state,
  onGenerateSuccessStatus,
  onMemoryTriggerScan,
}: {
  state: DashboardState;
  onGenerateSuccessStatus: () => Promise<ClientSuccessStatusResult>;
  onMemoryTriggerScan: () => Promise<MemoryTriggerResult>;
}) {
  const intelligence = state.clientIntelligence;
  const clients = intelligence?.clients ?? [];
  const [busy, setBusy] = useState<"status" | "scan" | undefined>();
  const [lastAction, setLastAction] = useState<string | undefined>();

  const generateSuccessStatus = async (): Promise<void> => {
    setBusy("status");
    try {
      const result = await onGenerateSuccessStatus();
      setLastAction(`${result.reports.length} client success report(s) generated`);
    } catch (error) {
      setLastAction(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  };

  const scanMemoryTriggers = async (): Promise<void> => {
    setBusy("scan");
    try {
      const result = await onMemoryTriggerScan();
      setLastAction(
        `${result.triggered.length} follow-up run(s), ${result.skipped.length} skipped`,
      );
    } catch (error) {
      setLastAction(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <SectionShell
      title="Clients"
      description="Client memory, project history, and commercial value."
      action={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void generateSuccessStatus()}
            disabled={Boolean(busy) || clients.length === 0}
          >
            <FileText className="h-3 w-3" />
            {busy === "status" ? "Generating" : "Status reports"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void scanMemoryTriggers()}
            disabled={Boolean(busy) || clients.length === 0}
          >
            <RefreshCw className="h-3 w-3" />
            {busy === "scan" ? "Scanning" : "Scan due"}
          </Button>
        </>
      }
    >
      {lastAction ? (
        <div className="mb-3 rounded-md border border-border/60 bg-surface-subtle px-3 py-2 text-[11px] text-muted-foreground">
          {lastAction}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricTile
          label="Clients"
          value={String(intelligence?.totals.clients ?? state.clients.length)}
          detail="Memory profiles"
          icon={Users}
          tone="info"
        />
        <MetricTile
          label="Pipeline"
          value={formatMoney(intelligence?.totals.pipeline_value ?? 0)}
          detail="Open opportunity value"
          icon={DollarSign}
          tone="success"
        />
        <MetricTile
          label="Won value"
          value={formatMoney(intelligence?.totals.won_value ?? 0)}
          detail="Closed won opportunities"
          icon={DollarSign}
          tone="success"
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <MetricTile
          label="Active projects"
          value={String(intelligence?.totals.active_projects ?? 0)}
          detail="Across all clients"
          icon={Briefcase}
          tone="info"
        />
        <MetricTile
          label="Blocked projects"
          value={String(intelligence?.totals.blocked_projects ?? 0)}
          detail="Client delivery risk"
          icon={AlertTriangle}
          tone={intelligence?.totals.blocked_projects ? "danger" : "success"}
        />
        <MetricTile
          label="Follow-ups due"
          value={String(intelligence?.totals.follow_ups_due ?? 0)}
          detail="Relationship memory"
          icon={Users}
          tone={intelligence?.totals.follow_ups_due ? "warning" : "success"}
        />
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-2">
        {clients.map((item) => (
          <ClientAccountCard key={item.client.id} item={item} />
        ))}
        {clients.length === 0 ? (
          <div className="xl:col-span-2">
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
