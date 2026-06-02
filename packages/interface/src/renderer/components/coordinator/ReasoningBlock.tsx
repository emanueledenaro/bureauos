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
// Canonical Phase-1 step sequence. Phase 2 will replace this static list with
// streamed `reasoning` deltas; for now it gives the disclosure something more
// than the collapsed one-liner by showing the whole arc with the live step lit.
const STEP_KEYS: StreamStatus[] = ["started", "provider_streaming", "persisting"];

export function ReasoningBlock({ status, active }: { status?: StreamStatus; active: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // Before the first status event arrives, the turn is in its opening phase, so
  // default to "started" for the collapsed label and the emphasized step.
  const effectiveStatus = status ?? "started";
  const step = reasoningStepForStatus(effectiveStatus);
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
          <ul className="mt-1 space-y-0.5 border-l-2 border-primary/40 pl-3 text-meta">
            {STEP_KEYS.map((stepStatus) => {
              const s = reasoningStepForStatus(stepStatus);
              const isCurrent = stepStatus === effectiveStatus;
              return (
                <li
                  key={stepStatus}
                  className={cn(isCurrent ? "text-foreground" : "text-muted-foreground")}
                >
                  {t(s.key, s.fallback)}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
