import {
  Briefcase,
  ExternalLink,
  GitBranch,
  GitPullRequest,
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
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useAsyncAction } from "../hooks/useAsyncAction";
import { buildLinkedWorkItems, clientName, linkedWorkTone, sortNewest } from "../lib/builders";
import { projectTone } from "../lib/tone";
import { formatLabel, timeAgo } from "../lib/format";
import { useState } from "react";
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
  if (links.length === 0) return <span className="text-muted-foreground">No PR</span>;
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
  const blocked = state.projects.filter((project) => project.status === "blocked").length;
  const reposLinked = state.projects.filter((project) => project.repository).length;
  const latestVerification = [...state.artifacts]
    .filter((artifact) => artifact.type === "repository-verification-report")
    .sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""))[0];
  const attentionCount = latestVerification?.attention_count ?? 0;
  const unverifiedCount = latestVerification?.unverified_count ?? 0;
  const linkedWork = buildLinkedWorkItems(state);

  const verifyAll = useAsyncAction(onVerifyRepositories);
  const [busyProject, setBusyProject] = useState<string | undefined>();

  const linkedWorkColumns: DataTableColumn<LinkedWorkItem>[] = [
    {
      id: "run",
      header: "Run",
      width: "minmax(180px,1.15fr)",
      mobileLabel: "Run",
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
      header: "Refs",
      width: "170px",
      mobileLabel: "Refs",
      render: (item) => (
        <div className="min-w-0 text-meta">
          <div className="truncate">Branch: {item.branch}</div>
          <div className="truncate">Commit: {item.commit}</div>
        </div>
      ),
    },
    {
      id: "checks",
      header: "Checks",
      width: "130px",
      mobileLabel: "Checks",
      render: (item) => (
        <div className="flex flex-wrap gap-1">
          <Badge
            variant={item.failingChecks > 0 ? "danger" : item.checks > 0 ? "success" : "muted"}
          >
            CI {item.checks}
          </Badge>
          <Badge variant={item.staleCount > 0 ? "warning" : "muted"}>Stale {item.staleCount}</Badge>
        </div>
      ),
    },
  ];

  const verifySingle = async (projectSlug: string): Promise<void> => {
    setBusyProject(projectSlug);
    try {
      await onVerifyRepositories(projectSlug);
    } finally {
      setBusyProject(undefined);
    }
  };

  return (
    <SectionShell
      title="Delivery"
      description="Projects, repositories, status, and team execution."
      action={
        <ViewToolbar
          primary={{
            label: "Verify repositories",
            icon: RefreshCw,
            onClick: () => void verifyAll.run(),
            busy: verifyAll.busy,
            busyLabel: "Verifying",
          }}
        />
      }
    >
      {verifyAll.error ? (
        <ActionBanner
          tone="danger"
          title="Repository verification failed"
          detail={verifyAll.error}
          onDismiss={verifyAll.reset}
          className="mb-3"
        />
      ) : latestVerification ? (
        <ActionBanner
          tone="info"
          title="Last repository verification"
          detail={`${latestVerification.verified_count ?? 0} verified · ${attentionCount} attention · ${unverifiedCount} unverified · ${latestVerification.created ? timeAgo(latestVerification.created) : "now"}`}
          className="mb-3"
        />
      ) : null}

      <KpiBar>
        <MetricTile
          label="Projects"
          value={String(state.projects.length)}
          detail="Tracked delivery streams"
          icon={Briefcase}
          tone="info"
        />
        <MetricTile
          label="Blocked"
          value={String(blocked)}
          detail="Needs intervention"
          icon={ShieldAlert}
          tone={blocked > 0 ? "danger" : "success"}
        />
        <MetricTile
          label="Repos linked"
          value={String(reposLinked)}
          detail={
            latestVerification
              ? `${attentionCount} attention · ${unverifiedCount} unverified`
              : "GitHub native execution"
          }
          icon={GitBranch}
          tone={reposLinked > 0 ? "success" : "warning"}
        />
      </KpiBar>

      <div className="mt-section">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-section-title">Linked Work Dashboard</h3>
            <p className="text-meta mt-0.5">
              Linear issues, runs, PRs, checks, branches, and commits from local evidence.
            </p>
          </div>
          <Badge
            variant={linkedWork.some((item) => item.prState === "stale") ? "warning" : "muted"}
          >
            {linkedWork.length} runs
          </Badge>
        </div>
        <DataTable
          columns={linkedWorkColumns}
          rows={linkedWork.slice(0, 8)}
          rowKey={(item) => item.id}
          mobileFallback="cards"
          minWidth={920}
          emptyState={{
            title: "No linked work yet",
            description: "Linear issues, runs, PRs, checks, branches, and commits appear here.",
          }}
        />
      </div>

      <div className="mt-section grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sortNewest(state.projects).map((project) => (
          <BaseCard key={project.id} variant="interactive" className="gap-3">
            <BaseCardHeader
              title={project.name}
              subtitle={clientName(state.clients, project.client_id)}
            >
              <StatusPill value={formatLabel(project.status)} tone={projectTone(project.status)} />
            </BaseCardHeader>
            <div className="text-body-secondary text-muted-foreground">
              {project.stack || "Stack not set"}
            </div>
            <div className="text-meta flex items-center gap-1.5 truncate font-mono">
              <GitBranch className="h-3 w-3 shrink-0" />
              {project.repository || "Repository pending"}
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
                {busyProject === project.slug ? "Verifying" : "Verify"}
              </Button>
            </BaseCardFooter>
          </BaseCard>
        ))}
        {state.projects.length === 0 ? (
          <div className="md:col-span-2 xl:col-span-3">
            <EmptyState
              title="No projects yet"
              description="The coordinator creates a project when you describe a client job."
            />
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}
