import { ArrowRight } from "lucide-react";
import { BaseCard } from "../dashboard/BaseCard";
import { Button } from "../ui/button";
import type { CoordinatorIntakeResult } from "../../lib/api";

/**
 * Card di preview del risultato di un messaggio del coordinator.
 * Usata sotto il bubble quando la risposta contiene un opportunity/project
 * appena creato.
 */
export function ResultCard({ result }: { result: CoordinatorIntakeResult }) {
  return (
    <BaseCard
      padding="compact"
      className="mt-2 w-full max-w-md gap-2 bg-surface-raised"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-eyebrow font-mono uppercase">{result.opportunity.id}</div>
          <div className="text-card-title mt-1 truncate">{result.project.name}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Client" value={result.client.name} />
        <Stat label="Artifacts" value={String(result.artifacts.length)} />
        <Stat label="Approvals" value={String(result.approvals.length)} />
      </div>
      {result.next_actions.length > 0 ? (
        <div className="rounded-md border border-border/60 bg-surface-subtle p-2 text-body-secondary text-foreground">
          {result.next_actions[0]}
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm">
          Open opportunity
          <ArrowRight className="h-3 w-3" />
        </Button>
      </div>
    </BaseCard>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-eyebrow">{label}</div>
      <div className="text-body-secondary mt-0.5 truncate font-medium text-foreground">{value}</div>
    </div>
  );
}
