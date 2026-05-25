import { GitPullRequest } from "lucide-react";
import { cn } from "../../lib/utils";
import { toneIndicatorClass, toneProgressClass, toneTextClass } from "../../lib/tone";
import type { Workstream } from "../../lib/types";

export function WorkstreamCard({
  item,
  laneIndex,
}: {
  item: Workstream;
  laneIndex: number;
}) {
  return (
    <div className="relative">
      {laneIndex > 0 ? (
        <>
          <span className="portfolio-connector" aria-hidden="true" />
          <span className="portfolio-node" aria-hidden="true" />
        </>
      ) : null}
      <div className="group relative z-10 flex flex-col gap-3 rounded-lg border border-border/70 bg-surface-raised p-3 shadow-[0_8px_18px_-12px_hsl(0_0%_0%/0.6)] transition-colors hover:border-border">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-foreground">{item.title}</div>
            <div
              className={cn(
                "mt-1 flex items-center gap-1.5 text-[11px] font-medium",
                toneTextClass[item.tone],
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", toneIndicatorClass[item.tone])} />
              {item.status}
            </div>
          </div>
          {item.github ? (
            <span className="flex shrink-0 items-center gap-1 rounded-full border border-border/60 bg-surface-subtle px-2 py-0.5 text-[10px] text-muted-foreground">
              <GitPullRequest className="h-3 w-3" />
              {item.github}
            </span>
          ) : null}
        </div>

        <div className="mt-auto flex items-center gap-3">
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-all", toneProgressClass[item.tone])}
              style={{ width: `${item.progress}%` }}
            />
          </div>
          <div className="w-9 text-right text-[10px] font-medium text-muted-foreground">
            {item.progress}%
          </div>
        </div>
        <div className="truncate text-[10px] text-muted-foreground">{item.meta}</div>
      </div>
    </div>
  );
}
