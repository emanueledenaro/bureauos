import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { Sparkline } from "./Sparkline";
import { cn } from "../../lib/utils";
import { toneTextClass, type Tone } from "../../lib/tone";

export function MetricTile({
  label,
  value,
  detail,
  icon: Icon,
  tone = "neutral",
  trend,
  sparkline,
  className,
  action,
}: {
  label: string;
  value: string;
  detail?: string;
  icon?: LucideIcon;
  tone?: Tone;
  trend?: { value: string; tone?: Tone };
  sparkline?: number[];
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "group flex flex-col gap-2 rounded-lg border border-border/70 bg-surface-subtle/60 p-4 transition-colors hover:bg-surface-subtle",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {Icon ? (
            <span className="grid h-7 w-7 place-items-center rounded-md border border-border/60 bg-surface-raised text-muted-foreground">
              <Icon className="h-3.5 w-3.5" />
            </span>
          ) : null}
          <div className="label-eyebrow">{label}</div>
        </div>
        {action}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="text-[22px] font-semibold leading-none tracking-tight text-foreground">
          {value}
        </div>
        {sparkline && sparkline.length > 1 ? (
          <Sparkline values={sparkline} tone={tone} className="h-8 w-20" />
        ) : null}
      </div>
      {(detail || trend) && (
        <div className="flex items-center justify-between gap-2 text-[11px]">
          {detail ? <span className="truncate text-muted-foreground">{detail}</span> : <span />}
          {trend ? (
            <span className={cn("font-medium", toneTextClass[trend.tone ?? tone])}>
              {trend.value}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-surface-subtle/40 p-2.5">
      <div className="truncate text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate text-[12px] font-semibold text-foreground">{value}</div>
    </div>
  );
}
