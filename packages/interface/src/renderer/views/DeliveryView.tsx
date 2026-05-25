import { Briefcase, GitBranch, RefreshCw, ShieldAlert } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { StatusPill } from "../components/dashboard/StatusPill";
import { EmptyState } from "../components/dashboard/EmptyState";
import { ActionBanner } from "../components/dashboard/ActionBanner";
import { BaseCard, BaseCardFooter, BaseCardHeader } from "../components/dashboard/BaseCard";
import { KpiBar } from "../components/dashboard/KpiBar";
import { ViewToolbar } from "../components/dashboard/ViewToolbar";
import { Button } from "../components/ui/button";
import { useAsyncAction } from "../hooks/useAsyncAction";
import { clientName, sortNewest } from "../lib/builders";
import { projectTone } from "../lib/tone";
import { formatLabel, timeAgo } from "../lib/format";
import { useState } from "react";
import type { ProjectRepositoryVerificationResult } from "../lib/api";
import type { DashboardState } from "../lib/types";

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

  const verifyAll = useAsyncAction(onVerifyRepositories);
  const [busyProject, setBusyProject] = useState<string | undefined>();

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
