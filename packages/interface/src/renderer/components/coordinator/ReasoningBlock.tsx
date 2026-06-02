import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { reasoningStepForStatus } from "../../lib/reasoning";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n/i18n";
import type { CoordinatorChatStreamEvent } from "../../lib/api";

type StreamStatus = Extract<CoordinatorChatStreamEvent, { type: "status" }>["status"];

/**
 * "Coordinator work" disclosure. Phase 1: driven by the coarse stream `status`
 * (started/provider_streaming/persisting). Phase 2 will feed it richer `reasoning`
 * deltas. `active` keeps the spinner running until the turn completes.
 */
export function ReasoningBlock({ status, active }: { status?: StreamStatus; active: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const step = status ? reasoningStepForStatus(status) : reasoningStepForStatus("started");
  const label = t(step.key, step.fallback);

  return (
    <div className="flex items-start gap-2.5">
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-meta focus-ring inline-flex items-center gap-1.5 rounded text-muted-foreground hover:text-foreground"
          aria-expanded={open}
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {active ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          <span>{t("reasoning.title", "Coordinator work")}</span>
          <span aria-hidden>·</span>
          <span>{label}</span>
        </button>
        {open ? (
          <div className={cn("mt-1 border-l-2 border-primary/40 pl-3 text-meta")}>{label}</div>
        ) : null}
      </div>
    </div>
  );
}
