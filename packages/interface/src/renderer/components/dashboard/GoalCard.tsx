import { ArrowRight } from "lucide-react";
import { Button } from "../ui/button";
import { StatusPill } from "./StatusPill";
import { cn } from "../../lib/utils";
import { toneProgressClass } from "../../lib/tone";
import type { GoalItem } from "../../lib/types";

export function GoalCard({ goal, onOpen }: { goal: GoalItem; onOpen: () => void }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border/70 bg-surface-subtle/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-foreground">{goal.title}</div>
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
            {goal.description}
          </p>
        </div>
        <StatusPill value={`${goal.progress}%`} tone={goal.tone} />
      </div>

      <div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", toneProgressClass[goal.tone])}
            style={{ width: `${goal.progress}%` }}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border/60 pt-3 text-[10px]">
          <div>
            <div className="text-muted-foreground/70">Current</div>
            <div className="mt-1 truncate text-foreground">{goal.current}</div>
          </div>
          <div>
            <div className="text-muted-foreground/70">Target</div>
            <div className="mt-1 truncate text-foreground">{goal.target}</div>
          </div>
        </div>
      </div>

      <div className="border-t border-border/60 pt-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Next action
        </div>
        <div className="mt-1 text-[12px] leading-relaxed text-foreground">{goal.nextAction}</div>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2">
        {goal.signals.map((signal) => (
          <span
            key={signal}
            className="max-w-full truncate rounded-full border border-border/60 bg-surface-raised px-2 py-1 text-[10px] text-muted-foreground"
          >
            {signal}
          </span>
        ))}
        <Button variant="ghost" size="sm" onClick={onOpen} className="ml-auto">
          Open
          <ArrowRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
