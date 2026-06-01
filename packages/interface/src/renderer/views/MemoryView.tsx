import { useEffect, useState } from "react";
import { Database, FileText, FolderOpen, Loader2, Search } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { StatusPill } from "../components/dashboard/StatusPill";
import { EmptyState } from "../components/dashboard/EmptyState";
import { KpiBar } from "../components/dashboard/KpiBar";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { sortNewest } from "../lib/builders";
import { formatLabel, timeAgo } from "../lib/format";
import {
  Api,
  type CoordinatorGlobalMemoryPacket,
  type MemoryBrowserEntry,
  type MemoryBrowserResult,
} from "../lib/api";
import type { DashboardState } from "../lib/types";
import { useT } from "../i18n/i18n";

const DEFAULT_MEMORY_QUERY = "company clients projects revenue growth";

export function MemoryView({ state }: { state: DashboardState }) {
  const t = useT();
  const [query, setQuery] = useState(DEFAULT_MEMORY_QUERY);
  const [packet, setPacket] = useState<CoordinatorGlobalMemoryPacket | undefined>();
  const [browser, setBrowser] = useState<MemoryBrowserResult | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [selectedPath, setSelectedPath] = useState<string | undefined>();

  const search = async (nextQuery = query): Promise<void> => {
    const normalized = nextQuery.trim();
    if (!normalized || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const [packetResult, browserResult] = await Promise.all([
        Api.coordinatorMemory(normalized, 12),
        Api.memoryBrowser({ query: normalized, limit: 80 }),
      ]);
      setPacket(packetResult);
      setBrowser(browserResult);
      setSelectedPath(browserResult.selected?.path);
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
    Promise.all([Api.coordinatorMemory(DEFAULT_MEMORY_QUERY, 12), Api.memoryBrowser({ limit: 80 })])
      .then(([packetResult, browserResult]) => {
        if (cancelled) return;
        setPacket(packetResult);
        setBrowser(browserResult);
        setSelectedPath(browserResult.selected?.path);
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

  const selectEntry = async (entry: MemoryBrowserEntry): Promise<void> => {
    setSelectedPath(entry.path);
    try {
      const result = await Api.memoryBrowser({
        query: browser?.query || undefined,
        path: entry.path,
        limit: 80,
      });
      setBrowser(result);
      setSelectedPath(result.selected?.path ?? entry.path);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const rootPreview = packet?.rootMemory
    .split("\n")
    .filter((line) => line.trim())
    .slice(0, 12)
    .join("\n");

  return (
    <SectionShell
      title={t("memory.title", "Memory")}
      description={t("memory.description", "The durable company memory written by the kernel.")}
      action={
        <div className="flex w-full min-w-0 max-w-md flex-1 items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void search();
              }}
              className="h-8 pl-7"
              placeholder={t("memory.searchPlaceholder", "Search company memory")}
            />
          </div>
          <Button size="sm" onClick={() => void search()} disabled={loading || !query.trim()}>
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Search className="h-3 w-3" />
            )}
            {loading ? t("memory.searching", "Searching") : t("memory.search", "Search")}
          </Button>
        </div>
      }
    >
      <KpiBar columns={4}>
        <MetricTile
          label={t("memory.clients", "Clients")}
          value={String(state.clients.length)}
          detail={t("memory.profiles", "Profiles")}
          icon={Database}
        />
        <MetricTile
          label={t("memory.projects", "Projects")}
          value={String(state.projects.length)}
          detail={t("memory.projectMemories", "Project memories")}
          icon={Database}
        />
        <MetricTile
          label={t("memory.artifacts", "Artifacts")}
          value={String(state.artifacts.length)}
          detail={t("memory.generatedRecords", "Generated records")}
          icon={FileText}
        />
        <MetricTile
          label={t("memory.auditEvents", "Audit events")}
          value={String(state.audit.length)}
          detail={t("memory.recentStream", "Recent stream")}
          icon={Database}
        />
      </KpiBar>

      <div className="mt-5 grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(300px,0.95fr)]">
        <div className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-surface-subtle/60 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[12px] font-semibold text-foreground">
                {t("memory.localMemoryBrowser", "Local Memory Browser")}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {browser
                  ? `${browser.entries.length} ${t("memory.entries", "entries")} · ${t(
                      "memory.semantic",
                      "semantic",
                    )} ${
                      browser.semantic_index.enabled
                        ? `${browser.semantic_index.provider} · ${browser.semantic_hits.length} ${t(
                            "memory.hits",
                            "hits",
                          )}`
                        : t("memory.off", "off")
                    }`
                  : t("memory.loadingMemoryEntries", "Loading memory entries")}
              </div>
            </div>
            <StatusPill value={t("memory.redacted", "Redacted")} tone="success" />
          </div>

          {browser ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {browser.categories.map((category) => (
                <span
                  key={category.id}
                  className="rounded-md border border-border/60 bg-surface-raised px-2 py-1 text-[10px] text-muted-foreground"
                >
                  {category.label}: {category.count}
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-4 space-y-2">
            {browser?.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => void selectEntry(entry)}
                className={`min-w-0 w-full rounded-md border p-3 text-left transition ${
                  selectedPath === entry.path
                    ? "border-primary/70 bg-primary/10"
                    : "border-border/60 bg-surface-raised hover:border-border"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate font-mono text-[10px] font-semibold text-foreground">
                      {entry.path}
                    </span>
                  </div>
                  <span className="shrink-0 rounded bg-surface-subtle px-1.5 py-0.5 text-[9px] uppercase text-muted-foreground">
                    {entry.category}
                  </span>
                </div>
                <div className="mt-2 text-[11px] font-semibold text-foreground">{entry.title}</div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                  {entry.preview}
                </p>
              </button>
            ))}
            {browser && browser.entries.length === 0 ? (
              <EmptyState
                title={t("memory.noMemoryEntries", "No memory entries")}
                description={t(
                  "memory.noMemoryEntriesDescription",
                  "No client, project, daily, or decision memory matched the current search.",
                )}
              />
            ) : null}
          </div>
        </div>

        <div className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-surface-subtle/60 p-4">
          <div className="text-[12px] font-semibold text-foreground">
            {t("memory.entryDetail", "Entry Detail")}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {browser?.selected
              ? `${browser.selected.category} · ${browser.selected.path}`
              : t("memory.selectAMemoryEntry", "Select a memory entry")}
          </div>
          {browser?.selected ? (
            <>
              <div className="mt-3 rounded-md border border-border/60 bg-surface-raised p-3">
                <div className="text-[12px] font-semibold text-foreground">
                  {browser.selected.title}
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {browser.selected.path}
                </div>
              </div>
              <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background/80 p-3 font-mono text-[10px] leading-relaxed text-foreground/80">
                {browser.selected.body}
              </pre>
            </>
          ) : (
            <div className="mt-3 rounded-md border border-dashed border-border/60 p-4">
              <div className="text-[12px] font-semibold text-foreground">
                {t("memory.noEntrySelected", "No entry selected")}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {t(
                  "memory.noEntrySelectedDescription",
                  "Client, project, daily, and decision memory details appear here.",
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-lg border border-border/70 bg-surface-subtle/60 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[12px] font-semibold text-foreground">
                {t("memory.supremeCoordinatorMemoryPacket", "Supreme Coordinator Memory Packet")}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {packet
                  ? `${packet.topHits.length} ${t("memory.hits", "hits")} · ${timeAgo(
                      packet.generatedAt,
                    )}`
                  : t("memory.waitingForMemoryPacket", "Waiting for memory packet")}
              </div>
            </div>
            {packet ? <StatusPill value={t("memory.audited", "Audited")} tone="success" /> : null}
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
                {t("memory.noMemoryPacketLoaded", "No memory packet loaded")}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {t(
                  "memory.noMemoryPacketLoadedDescription",
                  "Global memory appears here after the coordinator assembles a packet.",
                )}
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
                  <div className="text-[12px] font-semibold text-foreground">
                    {t("memory.noMemoryHits", "No memory hits")}
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {t(
                      "memory.noMemoryHitsDescription",
                      "The query did not match any current workspace memory.",
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-border/70 bg-surface-subtle/60 p-4">
          <div className="text-[12px] font-semibold text-foreground">
            {t("memory.auditTrail", "Audit Trail")}
          </div>
          <div className="mt-3 space-y-2 text-[11px]">
            <AuditRow
              label={t("memory.actor", "Actor")}
              value={packet?.audit.actor ?? "supreme_coordinator"}
            />
            <AuditRow
              label={t("memory.action", "Action")}
              value={packet?.audit.action ?? "memory.global.search"}
            />
            <AuditRow
              label={t("memory.result", "Result")}
              value={packet?.audit.result ?? t("memory.pending", "pending")}
              tone={packet?.audit.result === "ok" ? "success" : "neutral"}
            />
            <AuditRow
              label={t("memory.timestamp", "Timestamp")}
              value={
                packet?.audit.timestamp
                  ? timeAgo(packet.audit.timestamp)
                  : t("memory.notLoaded", "not loaded")
              }
            />
          </div>
          <div className="mt-4 border-t border-border/60 pt-4">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("memory.recentMemoryArtifacts", "Recent memory artifacts")}
            </div>
            <div className="mt-2 space-y-2">
              {sortNewest(state.artifacts)
                .slice(0, 5)
                .map((artifact) => (
                  <div
                    key={artifact.id}
                    className="rounded-md border border-border/60 bg-background/35 p-3"
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
                  {t("memory.noArtifactsYetShort", "No artifacts yet.")}
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
                {artifact.created ? timeAgo(artifact.created) : t("memory.created", "created")}
              </div>
            </div>
          ))}
        {state.artifacts.length === 0 ? (
          <div className="md:col-span-3">
            <EmptyState
              title={t("memory.noArtifactsYet", "No artifacts yet")}
              description={t(
                "memory.noArtifactsYetDescription",
                "Reports, briefs, dispatch packets, and GitHub signal reports will appear here.",
              )}
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
