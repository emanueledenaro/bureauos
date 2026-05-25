import { AlertTriangle, Briefcase, DollarSign, Users } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { ClientAccountCard } from "../components/dashboard/ClientAccountCard";
import { EmptyState } from "../components/dashboard/EmptyState";
import { formatMoney } from "../lib/format";
import type { DashboardState } from "../lib/types";

export function ClientsView({ state }: { state: DashboardState }) {
  const intelligence = state.clientIntelligence;
  const clients = intelligence?.clients ?? [];
  return (
    <SectionShell
      title="Clients"
      description="Client memory, project history, and commercial value."
    >
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
