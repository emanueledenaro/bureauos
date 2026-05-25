import { useState } from "react";
import { Briefcase, GitBranch, RefreshCw, ShieldAlert } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { StatusPill } from "../components/dashboard/StatusPill";
import { EmptyState } from "../components/dashboard/EmptyState";
import { Button } from "../components/ui/button";
import { clientName, sortNewest } from "../lib/builders";
import { projectTone } from "../lib/tone";
import { formatLabel, timeAgo } from "../lib/format";
import type { DashboardState } from "../lib/types";

export function DeliveryView({
  state,
  onVerifyRepositories,
}: {
  state: DashboardState;
  onVerifyRepositories: (projectSlug?: string) => Promise<unknown>;
}) {
  const [busyProject, setBusyProject] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const blocked = state.projects.filter((project) => project.status === "blocked").length;
  const reposLinked = state.projects.filter((project) => project.repository).length;
  const latestVerification = [...state.artifacts]
    .filter((artifact) => artifact.type === "repository-verification-report")
    .sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""))[0];
  const attentionCount = latestVerification?.attention_count ?? 0;
  const unverifiedCount = latestVerification?.unverified_count ?? 0;

  const verify = async (projectSlug?: string): Promise<void> => {
    setBusyProject(projectSlug ?? "all");
    setError(undefined);
    try {
      await onVerifyRepositories(projectSlug);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyProject(undefined);
    }
  };

  return (
    <SectionShell
      title="Delivery"
      description="Projects, repositories, status, and team execution."
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void verify()}
          disabled={busyProject !== undefined}
        >
          <RefreshCw className={busyProject === "all" ? "animate-spin" : ""} />
          Verify repositories
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
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
      </div>

      {latestVerification || error ? (
        <div className="mt-4 rounded-lg border border-border/70 bg-surface-subtle/60 px-4 py-3 text-[11px]">
          {error ? (
            <div className="text-danger">Repository verification failed: {error}</div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
              <span className="font-medium text-foreground">Last repository verification</span>
              <span>{latestVerification?.created ? timeAgo(latestVerification.created) : "now"}</span>
              <span>{latestVerification?.verified_count ?? 0} verified</span>
              <span>{attentionCount} attention</span>
              <span>{unverifiedCount} unverified</span>
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sortNewest(state.projects).map((project) => (
          <div
            key={project.id}
            className="flex flex-col gap-3 rounded-lg border border-border/70 bg-surface-subtle/60 p-4 transition-colors hover:bg-surface-subtle"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-foreground">
                  {project.name}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {clientName(state.clients, project.client_id)}
                </div>
              </div>
              <StatusPill value={formatLabel(project.status)} tone={projectTone(project.status)} />
            </div>
            <div className="text-[11px] text-muted-foreground">
              {project.stack || "Stack not set"}
            </div>
            <div className="flex items-center gap-1.5 truncate font-mono text-[10px] text-muted-foreground">
              <GitBranch className="h-3 w-3 shrink-0" />
              {project.repository || "Repository pending"}
            </div>
            <div className="mt-auto flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void verify(project.slug)}
                disabled={busyProject !== undefined || !project.repository}
              >
                <RefreshCw className={busyProject === project.slug ? "animate-spin" : ""} />
                Verify
              </Button>
            </div>
          </div>
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
