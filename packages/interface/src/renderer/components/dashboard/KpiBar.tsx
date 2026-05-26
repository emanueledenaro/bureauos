import { Children, type ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * Wrap del pattern ricorrente `grid gap-3 sm:grid-cols-N + MetricTile×N`
 * presente in 11+ viste. Calcola da solo la grid in base al numero di figli.
 *
 * @example
 * <KpiBar>
 *   <MetricTile … />
 *   <MetricTile … />
 *   <MetricTile … />
 * </KpiBar>
 */
export function KpiBar({
  children,
  className,
  columns,
}: {
  children: ReactNode;
  className?: string;
  /** Override del numero colonne (utile quando vuoi forzare 4 con 2 children) */
  columns?: 1 | 2 | 3 | 4 | 5;
}) {
  const count = columns ?? Math.min(Math.max(Children.count(children), 1), 5);
  const COLS: Record<number, string> = {
    1: "grid-cols-1",
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
    5: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
  };
  return (
    <div
      data-e2e-horizontal-scroll="true"
      className={cn(
        "grid grid-flow-col auto-cols-[minmax(220px,80vw)] gap-3 overflow-x-auto pb-1 no-scrollbar sm:grid-flow-row sm:auto-cols-auto sm:overflow-visible sm:pb-0",
        COLS[count],
        className,
      )}
    >
      {children}
    </div>
  );
}
