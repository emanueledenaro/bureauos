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
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
    5: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
  };
  return <div className={cn("grid gap-3", COLS[count], className)}>{children}</div>;
}
