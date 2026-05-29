import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * Wraps a fixed-column grid table in a horizontally scrollable container.
 * On viewports narrower than `minWidth` the user pans horizontally instead of
 * the columns collapsing into an unreadable layout.
 */
export function ResponsiveTable({
  minWidth = 640,
  className,
  children,
}: {
  minWidth?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border/70", className)}>
      <div data-e2e-horizontal-scroll="true" className="overflow-x-auto">
        <div style={{ minWidth: `${minWidth}px` }}>{children}</div>
      </div>
    </div>
  );
}
