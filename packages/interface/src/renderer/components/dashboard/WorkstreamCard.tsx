import { GitBranch, GitPullRequest } from "lucide-react";
import { cn } from "../../lib/utils";
import { toneIndicatorClass, toneProgressClass, toneTextClass } from "../../lib/tone";
import type { Workstream } from "../../lib/types";

export function WorkstreamCard({ item, laneIndex }: { item: Workstream; laneIndex: number }) {
  const openPullRequest = async (url: string): Promise<void> => {
    if (window.bureau) {
      await window.bureau.openExternal(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="relative">
      {laneIndex > 0 ? (
        <>
          <span className="portfolio-connector hidden md:block" aria-hidden="true" />
          <span className="portfolio-node hidden md:block" aria-hidden="true" />
        </>
      ) : null}
      <div className="group relative z-10 flex flex-col gap-3 rounded-lg border border-border/70 bg-surface-subtle/55 p-3 shadow-[0_8px_18px_-16px_hsl(0_0%_0%/0.6)] transition-colors hover:border-border hover:bg-surface-subtle/75">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div
              className={cn(
                "text-[9px] font-semibold uppercase tracking-[0.08em]",
                item.kind === "opportunity" ? "text-primary/80" : "text-muted-foreground/70",
              )}
            >
              {item.kind === "opportunity" ? "Opportunity" : "Project"}
            </div>
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
          {item.delivery ? (
            <span
              className={cn(
                "flex h-6 shrink-0 items-center gap-1 rounded-md border border-border/60 bg-background/35 px-2 text-[10px]",
                toneTextClass[item.delivery.tone],
              )}
            >
              <GitPullRequest className="h-3 w-3" />
              {item.delivery.label}
            </span>
          ) : null}
        </div>

        {item.delivery ? (
          <div className="border-t border-border/60 pt-2">
            <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
              <GitBranch className="h-3 w-3 shrink-0" />
              <span className="truncate font-mono text-foreground/85">
                {item.delivery.repository}
              </span>
            </div>
            <div
              className={cn(
                "mt-1 truncate text-[10px] font-medium",
                toneTextClass[item.delivery.tone],
              )}
            >
              {item.delivery.detail}
            </div>
            {item.delivery.pullRequests.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {item.delivery.pullRequests.map((pullRequest) =>
                  pullRequest.url ? (
                    <button
                      key={`${pullRequest.label}-${pullRequest.url}`}
                      type="button"
                      className="h-5 rounded border border-border/60 px-1.5 font-mono text-[9px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                      title={pullRequest.title}
                      onClick={() => void openPullRequest(pullRequest.url!)}
                    >
                      {pullRequest.label}
                    </button>
                  ) : (
                    <span
                      key={pullRequest.label}
                      className="h-5 rounded border border-border/60 px-1.5 font-mono text-[9px] leading-5 text-muted-foreground"
                      title={pullRequest.title}
                    >
                      {pullRequest.label}
                    </span>
                  ),
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {item.badges.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {item.badges.map((badge) => (
              <span
                key={badge}
                className="h-5 rounded border border-border/60 px-1.5 font-mono text-[9px] leading-5 text-muted-foreground"
              >
                {badge}
              </span>
            ))}
          </div>
        ) : null}

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
