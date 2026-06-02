import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { reasoningStepForStatus } from "../../lib/reasoning";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n/i18n";
import type { CoordinatorChatStreamEvent } from "../../lib/api";

type StreamStatus = Extract<CoordinatorChatStreamEvent, { type: "status" }>["status"];

export function ReasoningBlock({
  status,
  active,
  lines = [],
}: {
  status?: StreamStatus;
  active: boolean;
  lines?: string[];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // Fall back to the canonical status label when no live reasoning lines have arrived yet.
  const step = status ? reasoningStepForStatus(status) : reasoningStepForStatus("started");
  const latest = lines.length > 0 ? lines[lines.length - 1] : t(step.key, step.fallback);

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
          <span className="truncate">{latest}</span>
        </button>
        {open ? (
          <div className="mt-1 space-y-0.5 border-l-2 border-primary/40 pl-3">
            {lines.length > 0 ? (
              lines.map((line, i) => (
                <div
                  key={`${i}-${line}`}
                  className={cn(
                    "text-meta",
                    i === lines.length - 1 ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {line}
                </div>
              ))
            ) : (
              <div className="text-meta">{t(step.key, step.fallback)}</div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
