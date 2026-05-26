import { ArrowRight } from "lucide-react";
import { BaseCard, BaseCardHeader } from "./BaseCard";
import { Button } from "../ui/button";
import { StatusPill } from "./StatusPill";
import { cn } from "../../lib/utils";
import { toneProgressClass } from "../../lib/tone";
import type { GoalItem } from "../../lib/types";

export function GoalCard({ goal, onOpen }: { goal: GoalItem; onOpen: () => void }) {
  return (
    <BaseCard className="gap-4">
      <BaseCardHeader title={goal.title} subtitle={goal.description}>
        <StatusPill value={`${goal.progress}%`} tone={goal.tone} />
      </BaseCardHeader>

      <div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", toneProgressClass[goal.tone])}
            style={{ width: `${goal.progress}%` }}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border/60 pt-3 text-micro">
          <div>
            <div className="text-eyebrow">Current</div>
            <div className="text-body-secondary mt-1 truncate text-foreground">{goal.current}</div>
          </div>
          <div>
            <div className="text-eyebrow">Target</div>
            <div className="text-body-secondary mt-1 truncate text-foreground">{goal.target}</div>
          </div>
        </div>
      </div>

      <div className="border-t border-border/60 pt-3">
        <div className="text-eyebrow">Next action</div>
        <div className="text-body mt-1 leading-relaxed text-foreground">{goal.nextAction}</div>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2">
        {goal.signals.map((signal) => (
          <span
            key={signal}
            className="text-meta max-w-full truncate rounded-md border border-border/60 bg-background/35 px-2 py-1"
          >
            {signal}
          </span>
        ))}
        <Button variant="ghost" size="sm" onClick={onOpen} className="ml-auto">
          Open
          <ArrowRight className="h-3 w-3" />
        </Button>
      </div>
    </BaseCard>
  );
}
