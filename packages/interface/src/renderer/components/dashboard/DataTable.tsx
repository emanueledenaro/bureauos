import { Fragment, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { EmptyState } from "./EmptyState";

export interface DataTableColumn<Row> {
  id: string;
  header: ReactNode;
  /** Larghezza CSS (es. "120px", "minmax(0,1fr)"). Default: minmax(0,1fr). */
  width?: string;
  /** Allineamento testo. Default: "start". */
  align?: "start" | "center" | "end";
  /** Render della cella per la riga. */
  render: (row: Row) => ReactNode;
  /** Label mostrato come "eyebrow" sopra il valore nella fallback a card. */
  mobileLabel?: string;
  /** Se true non viene mostrato nella fallback a card (utile per colonne action). */
  hideOnMobile?: boolean;
}

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  density?: "comfortable" | "compact";
  /** minWidth della griglia (px). La tabella sotto questa larghezza fa scroll-X. */
  minWidth?: number;
  emptyState?: { title: string; description: string };
  /** "scroll" = overflow-x sempre. "cards" = sotto md collassa in card stack. */
  mobileFallback?: "scroll" | "cards";
  className?: string;
}

/**
 * Tabella responsive dichiarativa. Su viewport stretti usa scroll-X o si
 * trasforma in card stack a seconda di `mobileFallback`. Sostituisce il
 * pattern ResponsiveTable + grid manuali sparse in TodayView/ApprovalsView/
 * AgentsView/SettingsView/GoalsView/RevenueView.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  density = "comfortable",
  minWidth = 640,
  emptyState,
  mobileFallback = "scroll",
  className,
}: DataTableProps<Row>) {
  const gridTemplate = columns.map((column) => column.width ?? "minmax(0,1fr)").join(" ");
  const rowPadding = density === "compact" ? "px-3 py-2" : "px-4 py-3";

  const empty =
    rows.length === 0 && emptyState ? (
      <div className="border-t border-border/60 p-5">
        <EmptyState title={emptyState.title} description={emptyState.description} />
      </div>
    ) : null;

  const table = (
    <div className="overflow-hidden rounded-lg border border-border">
      {mobileFallback === "cards" ? (
        <>
          <div className="hidden md:block">
            <TableGrid
              columns={columns}
              rows={rows}
              rowKey={rowKey}
              gridTemplate={gridTemplate}
              rowPadding={rowPadding}
              minWidth={minWidth}
              wrap="overflow"
            />
          </div>
          <div className="divide-y divide-border/60 md:hidden">
            {rows.map((row, index) => (
              <MobileCard
                key={rowKey(row, index)}
                row={row}
                columns={columns}
                className={rowPadding}
              />
            ))}
          </div>
        </>
      ) : (
        <TableGrid
          columns={columns}
          rows={rows}
          rowKey={rowKey}
          gridTemplate={gridTemplate}
          rowPadding={rowPadding}
          minWidth={minWidth}
          wrap="overflow"
        />
      )}
      {empty}
    </div>
  );

  return <div className={className}>{table}</div>;
}

function TableGrid<Row>({
  columns,
  rows,
  rowKey,
  gridTemplate,
  rowPadding,
  minWidth,
  wrap,
}: {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  gridTemplate: string;
  rowPadding: string;
  minWidth: number;
  wrap: "overflow" | "none";
}) {
  const content = (
    <div style={{ minWidth: `${minWidth}px` }}>
      <div
        className={cn(
          "grid bg-surface-subtle/60 text-eyebrow",
          rowPadding,
        )}
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {columns.map((column) => (
          <span key={column.id} className={alignClass(column.align)}>
            {column.header}
          </span>
        ))}
      </div>
      {rows.map((row, index) => (
        <div
          key={rowKey(row, index)}
          className={cn(
            "grid items-center gap-3 border-t border-border/60 text-body transition-colors hover:bg-surface-subtle/40",
            rowPadding,
          )}
          style={{ gridTemplateColumns: gridTemplate }}
        >
          {columns.map((column) => (
            <div key={column.id} className={cn("min-w-0", alignClass(column.align))}>
              {column.render(row)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  if (wrap === "overflow") {
    return <div className="overflow-x-auto">{content}</div>;
  }
  return content;
}

function MobileCard<Row>({
  row,
  columns,
  className,
}: {
  row: Row;
  columns: DataTableColumn<Row>[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {columns.filter((column) => !column.hideOnMobile).map((column) => (
        <Fragment key={column.id}>
          <div className="flex flex-col gap-0.5">
            <span className="text-eyebrow">{column.mobileLabel ?? column.header}</span>
            <div className="text-body">{column.render(row)}</div>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function alignClass(align?: "start" | "center" | "end"): string {
  if (align === "center") return "text-center justify-self-center";
  if (align === "end") return "text-right justify-self-end";
  return "text-left";
}
