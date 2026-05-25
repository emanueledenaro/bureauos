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
        "flex min-h-44 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/70 bg-surface-subtle/40 px-6 py-8 text-center",
        className,
      )}
    >
      <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-raised border border-border/60 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <div className="max-w-sm">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
