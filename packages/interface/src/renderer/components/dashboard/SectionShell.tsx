import type { ReactNode } from "react";
import { Card } from "../ui/card";
import { cn } from "../../lib/utils";

export function SectionShell({
  title,
  description,
  children,
  action,
  className,
  contentClassName,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-tight text-foreground">{title}</h2>
          {description ? (
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      <div className={cn("p-5", contentClassName)}>{children}</div>
    </Card>
  );
}
