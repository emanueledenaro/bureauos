import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { toneBadgeVariant, toneIndicatorClass, toneTextClass, type Tone } from "../../lib/tone";
import { Badge } from "../ui/badge";

export function OperationalFocus({
  eyebrow = "Next move",
  title,
  detail,
  icon: Icon,
  tone = "neutral",
  signals = [],
  className,
}: {
  eyebrow?: string;
  title: string;
  detail: string;
  icon?: LucideIcon;
  tone?: Tone;
  signals?: string[];
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "relative overflow-hidden rounded-lg border border-border/70 bg-surface-subtle/45 p-4",
        className,
      )}
    >
      <span
        className={cn("absolute inset-x-0 top-0 h-px opacity-80", toneIndicatorClass[tone])}
        aria-hidden
      />
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {Icon ? (
              <span
                className={cn(
                  "grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border/60 bg-background/45",
                  toneTextClass[tone],
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
            ) : null}
            <span className="text-eyebrow truncate">{eyebrow}</span>
          </div>
          <div className="mt-2 text-[15px] font-semibold leading-tight text-foreground">
            {title}
          </div>
          <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-muted-foreground">
            {detail}
          </p>
        </div>
        {signals.length > 0 ? (
          <div className="flex min-w-0 flex-wrap gap-1.5 sm:max-w-[45%] sm:justify-end">
            {signals.map((signal) => (
              <Badge key={signal} variant={toneBadgeVariant[tone]} className="max-w-full truncate">
                {signal}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
