import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "../../lib/utils";

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  className,
  action,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-36 flex-wrap items-start gap-3 rounded-lg border border-border/70 bg-surface-subtle/35 px-4 py-4 text-left sm:items-center",
        className,
      )}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border/60 bg-background/35 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 max-w-md">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
