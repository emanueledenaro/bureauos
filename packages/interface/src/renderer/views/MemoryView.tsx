import { useEffect, useState } from "react";
import { Database, FileText, Loader2, Search } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { StatusPill } from "../components/dashboard/StatusPill";
import { EmptyState } from "../components/dashboard/EmptyState";
import { KpiBar } from "../components/dashboard/KpiBar";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { sortNewest } from "../lib/builders";
import { formatLabel, timeAgo } from "../lib/format";
import { Api, type CoordinatorGlobalMemoryPacket } from "../lib/api";
import type { DashboardState } from "../lib/types";

const DEFAULT_MEMORY_QUERY = "company clients projects revenue growth";

export function MemoryView({ state }: { state: DashboardState }) {
  const [query, setQuery] = useState(DEFAULT_MEMORY_QUERY);
  const [packet, setPacket] = useState<CoordinatorGlobalMemoryPacket | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const search = async (nextQuery = query): Promise<void> => {
    const normalized = nextQuery.trim();
    if (!normalized || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await Api.coordinatorMemory(normalized, 12);
      setPacket(result);
      setQuery(normalized);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Api.coordinatorMemory(DEFAULT_MEMORY_QUERY, 12)
      .then((result) => {
        if (!cancelled) setPacket(result);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rootPreview = packet?.rootMemory
    .split("\n")
    .filter((line) => line.trim())
    .slice(0, 12)
    .join("\n");

  return (
    <SectionShell
      title="Memory"
      description="The durable company memory written by the kernel."
      action={
        <div className="flex flex-1 max-w-md items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void search();
              }}
              className="h-8 pl-7"
              placeholder="Search company memory"
            />
          </div>
          <Button size="sm" onClick={() => void search()} disabled={loading || !query.trim()}>
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Search className="h-3 w-3" />
            )}
            {loading ? "Searching" : "Search"}
          </Button>
        </div>
      }
    >
      <KpiBar columns={4}>
        <MetricTile
          label="Clients"
          value={String(state.clients.length)}
          detail="Profiles"
          icon={Database}
        />
        <MetricTile
          label="Projects"
          value={String(state.projects.length)}
          detail="Project memories"
          icon={Database}
        />
        <MetricTile
          label="Artifacts"
          value={String(state.artifacts.length)}
          detail="Generated records"
          icon={FileText}
        />
        <MetricTile
          label="Audit events"
          value={String(state.audit.length)}
          detail="Recent stream"
          icon={Database}
        />
      </KpiBar>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-lg border border-border/70 bg-surface-subtle/60 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[12px] font-semibold text-foreground">
                Supreme Coordinator Memory Packet
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {packet
                  ? `${packet.topHits.length} hits · ${timeAgo(packet.generatedAt)}`
                  : "Waiting for memory packet"}
              </div>
            </div>
            {packet ? <StatusPill value="Audited" tone="success" /> : null}
          </div>
          {error ? (
            <div className="mt-3 rounded-md border border-danger/40 bg-danger-subtle/30 p-3 text-[11px] text-danger">
              {error}
            </div>
          ) : null}
          {rootPreview ? (
            <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-surface-raised p-3 font-mono text-[10px] leading-relaxed text-foreground/80">
              {rootPreview}
            </pre>
          ) : (
            <div className="mt-3 rounded-md border border-dashed border-border/60 p-4">
              <div className="text-[12px] font-semibold text-foreground">
                No memory packet loaded
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                Global memory appears here after the coordinator assembles a packet.
              </div>
            </div>
          )}
          {packet ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {packet.topHits.map((hit) => (
                <div
                  key={`${hit.path}:${hit.score}`}
                  className="rounded-md border border-border/60 bg-surface-raised p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate font-mono text-[10px] font-semibold text-foreground">
                      {hit.path}
                    </div>
                    <span className="text-[9px] text-muted-foreground">{hit.score}</span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-[10px] leading-relaxed text-muted-foreground">
                    {hit.snippet}
                  </p>
                </div>
              ))}
              {packet.topHits.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/60 p-4 sm:col-span-2">
                  <div className="text-[12px] font-semibold text-foreground">No memory hits</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    The query did not match any current workspace memory.
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-border/70 bg-surface-subtle/60 p-4">
          <div className="text-[12px] font-semibold text-foreground">Audit Trail</div>
          <div className="mt-3 space-y-2 text-[11px]">
            <AuditRow label="Actor" value={packet?.audit.actor ?? "supreme_coordinator"} />
            <AuditRow label="Action" value={packet?.audit.action ?? "memory.global.search"} />
            <AuditRow
              label="Result"
              value={packet?.audit.result ?? "pending"}
              tone={packet?.audit.result === "ok" ? "success" : "neutral"}
            />
            <AuditRow
              label="Timestamp"
              value={packet?.audit.timestamp ? timeAgo(packet.audit.timestamp) : "not loaded"}
            />
          </div>
          <div className="mt-4 border-t border-border/60 pt-4">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Recent memory artifacts
            </div>
            <div className="mt-2 space-y-2">
              {sortNewest(state.artifacts)
                .slice(0, 5)
                .map((artifact) => (
                  <div
                    key={artifact.id}
                    className="rounded-md border border-border/60 bg-surface-raised/60 p-3"
                  >
                    <div className="truncate text-[11px] font-semibold text-foreground">
                      {formatLabel(artifact.type)}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      {artifact.id}
                    </div>
                  </div>
                ))}
              {state.artifacts.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/60 p-3 text-[10px] text-muted-foreground">
                  No artifacts yet.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {sortNewest(state.artifacts)
          .slice(0, 9)
          .map((artifact) => (
            <div
              key={artifact.id}
              className="rounded-lg border border-border/70 bg-surface-subtle/60 p-3"
            >
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                {artifact.id}
              </div>
              <div className="mt-1 truncate text-[12px] font-semibold text-foreground">
                {formatLabel(artifact.type)}
              </div>
              <div className="mt-2 text-[10px] text-muted-foreground">
                {artifact.created ? timeAgo(artifact.created) : "created"}
              </div>
            </div>
          ))}
        {state.artifacts.length === 0 ? (
          <div className="md:col-span-3">
            <EmptyState
              title="No artifacts yet"
              description="Reports, briefs, dispatch packets, and GitHub signal reports will appear here."
            />
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}

function AuditRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "neutral";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span
        className={
          tone === "success"
            ? "truncate font-medium text-success"
            : "truncate font-medium text-foreground"
        }
      >
        {value}
      </span>
    </div>
  );
}
