import {
  Briefcase,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  ListChecks,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { StatusPill } from "../components/dashboard/StatusPill";
import { EmptyState } from "../components/dashboard/EmptyState";
import { ActionBanner } from "../components/dashboard/ActionBanner";
import { BaseCard, BaseCardFooter, BaseCardHeader } from "../components/dashboard/BaseCard";
import { KpiBar } from "../components/dashboard/KpiBar";
import { ViewToolbar } from "../components/dashboard/ViewToolbar";
import { DataTable, type DataTableColumn } from "../components/dashboard/DataTable";
import { OperationalFocus } from "../components/dashboard/OperationalFocus";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useAsyncAction } from "../hooks/useAsyncAction";
import { buildLinkedWorkItems, clientName, linkedWorkTone, sortNewest } from "../lib/builders";
import { projectTone } from "../lib/tone";
import { formatLabel, timeAgo } from "../lib/format";
import { useState } from "react";
import { useT } from "../i18n/i18n";
import type { ProjectRepositoryVerificationResult } from "../lib/api";
import type { DashboardState, LinkedWorkItem, WorkstreamPullRequestLink } from "../lib/types";

function ExternalLinkText({
  label,
  url,
  fallbackClassName = "text-muted-foreground",
}: {
  label: string;
  url?: string;
  fallbackClassName?: string;
}) {
  if (!url) return <span className={fallbackClassName}>{label}</span>;
  return (
    <a
      className="inline-flex min-w-0 items-center gap-1 text-info hover:text-info/80"
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      <span className="truncate">{label}</span>
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

function PullRequestLinks({ links }: { links: WorkstreamPullRequestLink[] }) {
  const t = useT();
  if (links.length === 0)
    return <span className="text-muted-foreground">{t("delivery.noPr", "No PR")}</span>;
  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {links.map((link) =>
        link.url ? (
          <a
            key={`${link.label}:${link.url}`}
            className="inline-flex items-center gap-1 rounded border border-border/60 bg-surface-raised px-1.5 py-0.5 text-[10px] text-info hover:text-info/80"
            href={link.url}
            target="_blank"
            rel="noreferrer"
          >
            <GitPullRequest className="h-3 w-3" />
            {link.label}
          </a>
        ) : (
          <span
            key={`${link.label}:${link.title ?? ""}`}
            className="inline-flex items-center gap-1 rounded border border-border/60 bg-surface-raised px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            <GitPullRequest className="h-3 w-3" />
            {link.label}
          </span>
        ),
      )}
    </div>
  );
}

export function DeliveryView({
  state,
  onVerifyRepositories,
}: {
  state: DashboardState;
  onVerifyRepositories: (projectSlug?: string) => Promise<ProjectRepositoryVerificationResult>;
}) {
  const t = useT();
  const blocked = state.projects.filter((project) => project.status === "blocked").length;
  const reposLinked = state.projects.filter((project) => project.repository).length;
  const latestVerification = [...state.artifacts]
    .filter((artifact) => artifact.type === "repository-verification-report")
    .sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""))[0];
  const attentionCount = latestVerification?.attention_count ?? 0;
  const unverifiedCount = latestVerification?.unverified_count ?? 0;
  const linkedWork = buildLinkedWorkItems(state);
  const blockedProject = sortNewest(state.projects).find((project) => project.status === "blocked");
  const missingRepositoryProject = sortNewest(state.projects).find(
    (project) => !project.repository,
  );
  const staleLinkedWork = linkedWork.find(
    (item) => item.prState === "stale" || item.issueState === "stale",
  );
  const missingPrRun = linkedWork.find((item) => item.prState === "missing");
  const deliveryFocus =
    blockedProject ??
    (staleLinkedWork ? "stale-linked-work" : undefined) ??
    missingRepositoryProject ??
    (missingPrRun ? "missing-pr-run" : undefined);
  const deliveryFocusTone =
    blockedProject || staleLinkedWork
      ? "danger"
      : missingRepositoryProject || missingPrRun
        ? "warning"
        : state.projects.length > 0
          ? "success"
          : "neutral";
  const deliveryFocusTitle =
    typeof deliveryFocus === "object"
      ? `${deliveryFocus.name} · ${clientName(state.clients, deliveryFocus.client_id)}`
      : deliveryFocus === "stale-linked-work" && staleLinkedWork
        ? `${formatLabel(staleLinkedWork.runType)} · ${t("delivery.staleGithubSignal", "stale GitHub signal")}`
        : deliveryFocus === "missing-pr-run" && missingPrRun
          ? `${formatLabel(missingPrRun.runType)} · ${t("delivery.prMissing", "PR missing")}`
          : state.projects.length > 0
            ? t("delivery.queueClearTitle", "Delivery queue is clear enough to keep moving")
            : t("delivery.createFirstStreamTitle", "Create the first delivery stream");
  const deliveryFocusDetail =
    typeof deliveryFocus === "object"
      ? deliveryFocus.status === "blocked"
        ? t(
            "delivery.focusBlockedDetail",
            "Project is blocked. Assign a recovery action before starting more delivery work for this account.",
          )
        : t(
            "delivery.focusMissingRepoDetail",
            "Repository is not linked yet. Connect the project repo before expecting GitHub-native delivery evidence.",
          )
      : deliveryFocus === "stale-linked-work" && staleLinkedWork
        ? staleLinkedWork.prDetail
        : deliveryFocus === "missing-pr-run" && missingPrRun
          ? missingPrRun.prDetail
          : state.projects.length > 0
            ? t(
                "delivery.focusQueueClearDetail",
                "No blocked project is first in the queue. Continue with repository verification and active project-manager runs.",
              )
            : t(
                "delivery.focusNoMemoryDetail",
                "No project memory exists yet. The coordinator should create a project from approved client scope.",
              );

  const verifyAll = useAsyncAction(onVerifyRepositories);
  const [busyProject, setBusyProject] = useState<string | undefined>();
  const [verifyError, setVerifyError] = useState<string | undefined>();

  const linkedWorkColumns: DataTableColumn<LinkedWorkItem>[] = [
    {
      id: "run",
      header: t("delivery.colRun", "Run"),
      width: "minmax(180px,1.15fr)",
      mobileLabel: t("delivery.colRun", "Run"),
      render: (item) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusPill value={formatLabel(item.runStatus)} tone={item.runTone} />
            <span className="text-meta truncate font-mono">{item.runId}</span>
          </div>
          <div className="text-body mt-1 truncate font-medium text-foreground">
            {formatLabel(item.runType)}
          </div>
          <div className="text-meta mt-0.5 truncate">{item.runScope}</div>
        </div>
      ),
    },
    {
      id: "issue",
      header: "Linear",
      width: "150px",
      mobileLabel: "Linear",
      render: (item) => (
        <div className="flex min-w-0 flex-col gap-1">
          <Badge variant={linkedWorkTone(item.issueState)}>{formatLabel(item.issueState)}</Badge>
          <ExternalLinkText label={item.issueLabel} url={item.issueUrl} />
          <span className="text-meta truncate">{item.issueDetail}</span>
        </div>
      ),
    },
    {
      id: "github",
      header: "GitHub",
      width: "minmax(200px,1fr)",
      mobileLabel: "GitHub",
      render: (item) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant={linkedWorkTone(item.prState)}>{formatLabel(item.prState)}</Badge>
            <PullRequestLinks links={item.pullRequests} />
          </div>
          <div className="text-meta mt-1 truncate font-mono">{item.repository}</div>
          <div className="text-meta mt-0.5 truncate">{item.prDetail}</div>
        </div>
      ),
    },
    {
      id: "refs",
      header: t("delivery.colRefs", "Refs"),
      width: "170px",
      mobileLabel: t("delivery.colRefs", "Refs"),
      render: (item) => (
        <div className="min-w-0 text-meta">
          <div className="truncate">
            {t("delivery.branchLabel", "Branch")}: {item.branch}
          </div>
          <div className="truncate">
            {t("delivery.commitLabel", "Commit")}: {item.commit}
          </div>
        </div>
      ),
    },
    {
      id: "checks",
      header: t("delivery.colChecks", "Checks"),
      width: "130px",
      mobileLabel: t("delivery.colChecks", "Checks"),
      render: (item) => (
        <div className="flex flex-wrap gap-1">
          <Badge
            variant={item.failingChecks > 0 ? "danger" : item.checks > 0 ? "success" : "muted"}
          >
            {t("delivery.ciBadge", "CI")} {item.checks}
          </Badge>
          <Badge variant={item.staleCount > 0 ? "warning" : "muted"}>
            {t("delivery.staleBadge", "Stale")} {item.staleCount}
          </Badge>
        </div>
      ),
    },
  ];

  const verifySingle = async (projectSlug: string): Promise<void> => {
    setBusyProject(projectSlug);
    setVerifyError(undefined);
    try {
      await onVerifyRepositories(projectSlug);
    } catch (error) {
      // A failing single-project verify must surface, not silently no-op (SER-206).
      setVerifyError(
        error instanceof Error
          ? error.message
          : t("delivery.verificationFailedFallback", "Repository verification failed."),
      );
    } finally {
      setBusyProject(undefined);
    }
  };

  return (
    <SectionShell
      title={t("delivery.title", "Delivery")}
      description={t("delivery.description", "Projects, repositories, status, and team execution.")}
      action={
        <ViewToolbar
          primary={{
            label: t("delivery.verifyRepositories", "Verify repositories"),
            icon: RefreshCw,
            onClick: () => void verifyAll.run(),
            busy: verifyAll.busy,
            busyLabel: t("delivery.verifying", "Verifying"),
          }}
        />
      }
    >
      {verifyError ? (
        <ActionBanner
          tone="danger"
          title={t("delivery.verificationFailedTitle", "Repository verification failed")}
          detail={verifyError}
          onDismiss={() => setVerifyError(undefined)}
          className="mb-3"
        />
      ) : null}
      {verifyAll.error ? (
        <ActionBanner
          tone="danger"
          title={t("delivery.verificationFailedTitle", "Repository verification failed")}
          detail={verifyAll.error}
          onDismiss={verifyAll.reset}
          className="mb-3"
        />
      ) : latestVerification ? (
        <ActionBanner
          tone="info"
          title={t("delivery.lastVerificationTitle", "Last repository verification")}
          detail={`${latestVerification.verified_count ?? 0} ${t("delivery.verified", "verified")} · ${attentionCount} ${t("delivery.attention", "attention")} · ${unverifiedCount} ${t("delivery.unverified", "unverified")} · ${latestVerification.created ? timeAgo(latestVerification.created) : t("delivery.now", "now")}`}
          className="mb-3"
        />
      ) : null}

      <OperationalFocus
        className="mb-section"
        tone={deliveryFocusTone}
        icon={ListChecks}
        title={deliveryFocusTitle}
        detail={deliveryFocusDetail}
        signals={[
          `${blocked} ${t("delivery.signalBlocked", "blocked")}`,
          `${reposLinked}/${Math.max(state.projects.length, 1)} ${t("delivery.signalRepos", "repos")}`,
          `${linkedWork.length} ${t("delivery.signalRuns", "runs")}`,
        ]}
      />

      <KpiBar>
        <MetricTile
          label={t("delivery.kpiProjects", "Projects")}
          value={String(state.projects.length)}
          detail={t("delivery.kpiProjectsDetail", "Tracked delivery streams")}
          icon={Briefcase}
          tone="info"
        />
        <MetricTile
          label={t("delivery.kpiBlocked", "Blocked")}
          value={String(blocked)}
          detail={t("delivery.kpiBlockedDetail", "Needs intervention")}
          icon={ShieldAlert}
          tone={blocked > 0 ? "danger" : "success"}
        />
        <MetricTile
          label={t("delivery.kpiReposLinked", "Repos linked")}
          value={String(reposLinked)}
          detail={
            latestVerification
              ? `${attentionCount} ${t("delivery.attention", "attention")} · ${unverifiedCount} ${t("delivery.unverified", "unverified")}`
              : t("delivery.kpiReposLinkedDetail", "GitHub native execution")
          }
          icon={GitBranch}
          tone={reposLinked > 0 ? "success" : "warning"}
        />
      </KpiBar>

      <div className="mt-section">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-section-title">
              {t("delivery.linkedWorkTitle", "Linked Work Dashboard")}
            </h3>
            <p className="text-meta mt-0.5">
              {t(
                "delivery.linkedWorkSubtitle",
                "Linear issues, runs, PRs, checks, branches, and commits from local evidence.",
              )}
            </p>
          </div>
          <Badge
            variant={linkedWork.some((item) => item.prState === "stale") ? "warning" : "muted"}
          >
            {linkedWork.length} {t("delivery.signalRuns", "runs")}
          </Badge>
        </div>
        <DataTable
          columns={linkedWorkColumns}
          rows={linkedWork.slice(0, 8)}
          rowKey={(item) => item.id}
          mobileFallback="cards"
          minWidth={920}
          emptyState={{
            title: t("delivery.linkedWorkEmptyTitle", "No linked work yet"),
            description: t(
              "delivery.linkedWorkEmptyDescription",
              "Linear issues, runs, PRs, checks, branches, and commits appear here.",
            ),
          }}
        />
      </div>

      <div className="mt-section grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sortNewest(state.projects).map((project) => (
          <BaseCard key={project.id} className="gap-3">
            <BaseCardHeader
              title={project.name}
              subtitle={clientName(state.clients, project.client_id)}
            >
              <StatusPill value={formatLabel(project.status)} tone={projectTone(project.status)} />
            </BaseCardHeader>
            <div className="text-body-secondary text-muted-foreground">
              {project.stack || t("delivery.stackNotSet", "Stack not set")}
            </div>
            <div className="text-meta flex items-center gap-1.5 truncate font-mono">
              <GitBranch className="h-3 w-3 shrink-0" />
              {project.repository || t("delivery.repositoryPending", "Repository pending")}
            </div>
            <BaseCardFooter className="justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void verifySingle(project.slug)}
                disabled={Boolean(busyProject) || !project.repository}
              >
                <RefreshCw
                  className={busyProject === project.slug ? "h-3 w-3 animate-spin" : "h-3 w-3"}
                />
                {busyProject === project.slug
                  ? t("delivery.verifying", "Verifying")
                  : t("delivery.verify", "Verify")}
              </Button>
            </BaseCardFooter>
          </BaseCard>
        ))}
        {state.projects.length === 0 ? (
          <div className="md:col-span-2 xl:col-span-3">
            <EmptyState
              title={t("delivery.noProjectsTitle", "No projects yet")}
              description={t(
                "delivery.noProjectsDescription",
                "The coordinator creates a project when you describe a client job.",
              )}
            />
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}
