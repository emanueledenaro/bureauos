import { useState } from "react";
import { FileText, Loader2, WandSparkles } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { EmptyState } from "../components/dashboard/EmptyState";
import { ActionBanner } from "../components/dashboard/ActionBanner";
import { BaseCard } from "../components/dashboard/BaseCard";
import { ViewToolbar } from "../components/dashboard/ViewToolbar";
import { Badge } from "../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { useAsyncAction } from "../hooks/useAsyncAction";
import { sortNewest } from "../lib/builders";
import { formatLabel, timeAgo } from "../lib/format";
import { Api, type ArtifactRecord, type BusinessReportResult, type ReportDetail } from "../lib/api";
import type { DashboardState } from "../lib/types";
import { useT } from "../i18n/i18n";

const REPORT_TYPES = new Set([
  "executive-report",
  "cross-project-executive-report",
  "business-operating-report",
  "client-account-plan",
  "client-success-status-report",
  "revenue-pipeline-report",
]);

export function ReportsView({
  state,
  onGenerateReport,
}: {
  state: DashboardState;
  onGenerateReport: () => Promise<BusinessReportResult>;
}) {
  const t = useT();
  const reports = sortNewest(state.artifacts.filter((artifact) => REPORT_TYPES.has(artifact.type)));
  const generate = useAsyncAction(onGenerateReport);

  const [openReportId, setOpenReportId] = useState<string | undefined>();
  const [detail, setDetail] = useState<ReportDetail | undefined>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | undefined>();
  const openReport = reports.find((report) => report.id === openReportId);

  const showReport = async (artifact: ArtifactRecord): Promise<void> => {
    setOpenReportId(artifact.id);
    setDetail(undefined);
    setDetailError(undefined);
    setDetailLoading(true);
    try {
      setDetail(await Api.reportDetail(artifact.id));
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : String(error));
    } finally {
      setDetailLoading(false);
    }
  };

  const closeReport = (open: boolean): void => {
    if (open) return;
    setOpenReportId(undefined);
    setDetail(undefined);
    setDetailError(undefined);
    setDetailLoading(false);
  };

  return (
    <SectionShell
      title={t("reports.title", "Reports")}
      description={t(
        "reports.description",
        "Executive, client, revenue, and business reports generated from current registries.",
      )}
      action={
        <ViewToolbar
          primary={{
            label: t("reports.generateReport", "Generate report"),
            icon: WandSparkles,
            onClick: () => void generate.run(),
            busy: generate.busy,
            busyLabel: t("reports.generating", "Generating"),
          }}
        />
      }
    >
      {generate.error ? (
        <ActionBanner
          tone="danger"
          title={t("reports.generationFailed", "Report generation failed")}
          detail={generate.error}
          onDismiss={generate.reset}
          className="mb-3"
        />
      ) : null}
      {generate.result ? (
        <ActionBanner
          tone="success"
          title={`${t("reports.reportsGenerated", "Reports generated")} · ${generate.result.executive_report.id}`}
          detail={t(
            "reports.reportsGeneratedDetail",
            "Executive, cross-project, and business operating reports were written locally.",
          )}
          onDismiss={generate.reset}
          className="mb-3"
        />
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {reports.map((artifact) => (
          <BaseCard
            key={artifact.id}
            variant="interactive"
            role="button"
            tabIndex={0}
            className="gap-3 focus-ring"
            onClick={() => void showReport(artifact)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void showReport(artifact);
              }
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-md border border-border/60 bg-surface-raised text-muted-foreground">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-card-title">{formatLabel(artifact.type)}</div>
                  <div className="text-meta mt-0.5 truncate font-mono">{artifact.id}</div>
                </div>
              </div>
              <Badge variant="muted">{artifact.type.split("-")[0]}</Badge>
            </div>
            <div className="text-meta">
              {artifact.created
                ? `${t("reports.created", "Created")} ${timeAgo(artifact.created)}`
                : t("reports.created", "Created")}
            </div>
          </BaseCard>
        ))}
        {reports.length === 0 ? (
          <div className="md:col-span-2 xl:col-span-3">
            <EmptyState
              title={t("reports.emptyState", "No reports yet")}
              description={t(
                "reports.emptyStateDescription",
                "Use Generate report to write an executive, cross-project, and business operating report from current registries.",
              )}
              icon={FileText}
            />
          </div>
        ) : null}
      </div>

      <Dialog open={Boolean(openReportId)} onOpenChange={closeReport}>
        <DialogContent className="max-h-[85vh] w-full max-w-3xl gap-3 overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {openReport ? formatLabel(openReport.type) : t("reports.dialogTitle", "Report")}
            </DialogTitle>
            <DialogDescription className="font-mono">
              {openReportId}
              {openReport?.created
                ? ` · ${t("reports.createdLower", "created")} ${timeAgo(openReport.created)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex items-center gap-2 rounded-md border border-border/60 bg-surface-raised p-4 text-meta">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("reports.loadingReport", "Loading report")}
            </div>
          ) : detailError ? (
            <div className="rounded-md border border-danger/40 bg-danger-subtle/30 p-4 text-[12px] text-danger">
              {detailError}
            </div>
          ) : detail ? (
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background/80 p-4 font-mono text-[11px] leading-relaxed text-foreground/80">
              {detail.body}
            </pre>
          ) : null}
        </DialogContent>
      </Dialog>
    </SectionShell>
  );
}
