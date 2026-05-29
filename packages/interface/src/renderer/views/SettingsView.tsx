import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, KeyRound, Loader2, Lock, Plug, Shield } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { ResponsiveTable } from "../components/dashboard/ResponsiveTable";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { cn } from "../lib/utils";
import { enabledCount } from "../lib/builders";
import { formatLabel } from "../lib/format";
import {
  Api,
  type ProviderAuthAuthorization,
  type ProviderConnection,
  type ProviderConnector,
  type ProviderModelList,
  type SettingsSummary,
} from "../lib/api";

/**
 * Normalize a pasted OAuth value into something the callback endpoint accepts.
 *
 * The owner may paste either a bare authorization code or the full redirect URL
 * from the browser. When a URL is pasted we extract its `code` query parameter
 * and keep the `state` in the compact `code#state` form so the server can still
 * validate it against the pending session. Non-URL input is passed through.
 */
function extractOAuthCode(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    if (code) {
      const state = url.searchParams.get("state");
      return state ? `${code}#${state}` : code;
    }
  } catch {
    // Not a URL; treat the value as a raw code or compact code#state token.
  }
  return trimmed;
}

export function SettingsView({
  settings,
  providers,
  providerConnectors,
  onProviderLogin,
  onProviderLogout,
  onRefresh,
}: {
  settings?: SettingsSummary;
  providers: ProviderConnection[];
  providerConnectors: ProviderConnector[];
  onProviderLogin: (input: {
    provider: string;
    mode?: "oauth" | "api-key" | "local";
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    baseUrl?: string;
    defaultModel?: string;
  }) => Promise<void>;
  onProviderLogout: (provider: string, id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [provider, setProvider] = useState("openai-codex");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [oauthCode, setOauthCode] = useState("");
  const [oauthAuthorization, setOauthAuthorization] = useState<
    ProviderAuthAuthorization | undefined
  >();
  const [oauthStatus, setOauthStatus] = useState<string | undefined>();
  const [modelList, setModelList] = useState<ProviderModelList | undefined>();
  const [busy, setBusy] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [modelStatus, setModelStatus] = useState<string | undefined>();
  // Tracks whether the owner manually picked a model for the current provider.
  // While true, async model-list resolution must not clobber their choice.
  const modelTouched = useRef(false);

  const selectModel = (value: string): void => {
    modelTouched.current = true;
    setModelStatus(undefined);
    setDefaultModel(value);
  };

  const connector = providerConnectors.find((item) => item.id === provider);
  const connectedProvider = providers.find((item) => item.provider === provider);
  const mode =
    connector?.defaultAuthMode ??
    (provider === "openai-codex" ? "oauth" : provider === "local" ? "local" : "api-key");
  const authMethod = connector?.authMethods[0];
  const requiresApiKey = authMethod?.type === "api";
  const requiresBaseUrl = connector?.requiresBaseUrl || provider === "custom";

  const modelChoices = useMemo(() => {
    const seen = new Set<string>();
    return [
      ...(modelList?.models ?? []),
      ...(connector?.models ?? []),
      ...(connectedProvider?.default_model
        ? [
            {
              id: connectedProvider.default_model,
              name: connectedProvider.default_model,
              capabilities: [],
              budgetTier: "standard" as const,
            },
          ]
        : []),
    ].filter((model) => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });
  }, [connector?.models, connectedProvider?.default_model, modelList?.models]);
  const selectedModel = modelChoices.find((model) => model.id === defaultModel);

  useEffect(() => {
    let cancelled = false;
    // Switching provider (or its connected model) starts a fresh selection, so
    // forget any prior manual pick before we seed defaults.
    modelTouched.current = false;
    setModelStatus(undefined);
    const fallback = connector
      ? {
          provider,
          source: "connector" as const,
          defaultModel: connectedProvider?.default_model || connector.defaultModel,
          models: connector.models,
        }
      : undefined;
    setModelList(fallback);
    const nextDefault = connectedProvider?.default_model || fallback?.defaultModel || "";
    setDefaultModel(nextDefault);

    Api.providerModels(provider)
      .then((models) => {
        if (cancelled) return;
        setModelList(models);
        // Never override a model the owner just selected while this resolved.
        if (modelTouched.current) return;
        setDefaultModel(connectedProvider?.default_model || models.defaultModel || nextDefault);
      })
      .catch(() => {
        if (cancelled || !fallback) return;
        setModelList(fallback);
      });

    return () => {
      cancelled = true;
    };
  }, [connector, connectedProvider?.default_model, provider]);

  const openAuthorizationUrl = async (url: string): Promise<void> => {
    if (window.bureau) {
      await window.bureau.openExternal(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const startOpenAICodexOAuth = async (): Promise<void> => {
    setOauthStatus("Opening OpenAI authorization…");
    const authorization = await Api.providerOAuthAuthorize("openai-codex");
    setOauthAuthorization(authorization);
    await openAuthorizationUrl(authorization.url);

    if (authorization.method === "code") {
      setOauthStatus(authorization.instructions);
      return;
    }

    setOauthStatus("Waiting for browser authorization…");
    const result = await Api.providerOAuthCallback("openai-codex", {
      method: "auto",
      ...(defaultModel.trim() ? { defaultModel: defaultModel.trim() } : {}),
    });
    if (result.status !== "connected") {
      setOauthStatus("Authorization is still pending. Paste the final redirect URL to complete.");
      return;
    }
    setOauthStatus("OpenAI Codex OAuth connected.");
    setOauthAuthorization(undefined);
    setOauthCode("");
    setDefaultModel("");
    await onRefresh();
  };

  const completeOpenAICodexOAuth = async (): Promise<void> => {
    const code = extractOAuthCode(oauthCode);
    if (!code) return;
    setOauthStatus("Completing OpenAI Codex OAuth…");
    const result = await Api.providerOAuthCallback("openai-codex", {
      method: "code",
      code,
      ...(defaultModel.trim() ? { defaultModel: defaultModel.trim() } : {}),
    });
    if (result.status !== "connected") {
      setOauthStatus("Authorization is still pending.");
      return;
    }
    setOauthStatus("OpenAI Codex OAuth connected.");
    setOauthAuthorization(undefined);
    setOauthCode("");
    setDefaultModel("");
    await onRefresh();
  };

  const saveModel = async (): Promise<void> => {
    if (savingModel || !connectedProvider || connectedProvider.source !== "auth") return;
    const next = defaultModel.trim();
    if (!next) {
      setModelStatus("Pick a model before saving.");
      return;
    }
    setSavingModel(true);
    setModelStatus("Saving model…");
    try {
      await Api.providerSetDefaultModel({
        provider,
        id: connectedProvider.id,
        defaultModel: next,
      });
      modelTouched.current = false;
      setModelStatus(`Default model set to ${next}.`);
      await onRefresh();
    } catch (error) {
      setModelStatus(error instanceof Error ? error.message : "Failed to update model.");
    } finally {
      setSavingModel(false);
    }
  };

  const connect = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      if (provider === "openai-codex") {
        await startOpenAICodexOAuth();
        return;
      }
      await onProviderLogin({
        provider,
        mode,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(defaultModel.trim() ? { defaultModel: defaultModel.trim() } : {}),
      });
      setApiKey("");
      setBaseUrl("");
      setDefaultModel("");
      setOauthStatus(undefined);
      setOauthAuthorization(undefined);
      setOauthCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionShell
      title="Settings"
      description="Provider authentication, autonomy policy, and routing."
    >
      <div className="grid gap-3 rounded-lg border border-border/70 bg-surface-subtle/60 p-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Provider
          </label>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger>
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              {providerConnectors.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {requiresApiKey ? (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              API key
            </label>
            <Input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk-…"
            />
          </div>
        ) : null}

        {requiresBaseUrl ? (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Base URL
            </label>
            <Input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com"
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Default model
          </label>
          <Select value={defaultModel} onValueChange={selectModel}>
            <SelectTrigger>
              <SelectValue placeholder="Auto" />
            </SelectTrigger>
            <SelectContent>
              {modelChoices.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name || model.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button onClick={() => void connect()} disabled={busy} className="md:col-start-4">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />}
          {mode === "oauth"
            ? connectedProvider?.source === "auth"
              ? "Reconnect OAuth"
              : "Connect OAuth"
            : connectedProvider?.source === "auth"
              ? "Reconnect"
              : "Connect"}
        </Button>
      </div>

      {connectedProvider?.source === "auth" ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border/70 bg-surface-subtle/40 px-4 py-3">
          <Badge variant="success">Connected</Badge>
          <span className="text-[11px] text-muted-foreground">
            Current model{" "}
            <span className="font-mono text-foreground">
              {connectedProvider.default_model || "auto"}
            </span>
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void saveModel()}
            disabled={
              savingModel ||
              !defaultModel.trim() ||
              defaultModel === connectedProvider.default_model
            }
            className="ml-auto"
          >
            {savingModel ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {connectedProvider.default_model ? "Update model" : "Save model"}
          </Button>
          {modelStatus ? (
            <span className="w-full text-[11px] text-muted-foreground">{modelStatus}</span>
          ) : null}
        </div>
      ) : null}

      {connector ? (
        <div className="mt-4 rounded-lg border border-border/70 bg-surface-subtle/60 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[12px] font-semibold text-foreground">{connector.name}</div>
              <div className="mt-1 max-w-xl text-[11px] text-muted-foreground">
                {connector.description}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge variant="outline">
                  {connector.source === "config" ? "Config override" : "Built-in connector"}
                </Badge>
                <Badge variant="outline">Default {connector.defaultModel}</Badge>
                <Badge variant="outline">{connector.models.length} models</Badge>
                {modelList ? <Badge variant="outline">Models from {modelList.source}</Badge> : null}
                {selectedModel ? (
                  <Badge variant="info">{formatLabel(selectedModel.budgetTier)} budget</Badge>
                ) : null}
              </div>
              {selectedModel?.capabilities.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedModel.capabilities.slice(0, 8).map((capability) => (
                    <Badge key={capability} variant="muted">
                      {formatLabel(capability)}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="text-right text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {connector.authMethods.map((method) => method.label).join(" / ")}
            </div>
          </div>
          {connector.noApiFallback ? (
            <div className="mt-3 text-[11px] text-muted-foreground">
              This connector is isolated from API-key providers and never falls back to API auth.
            </div>
          ) : null}
        </div>
      ) : null}

      {provider === "openai-codex" ? (
        <div className="mt-4 rounded-lg border border-border/70 bg-surface-subtle/60 p-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="text-[12px] font-semibold text-foreground">
              OpenAI Codex uses browser OAuth only
            </div>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            This connection is separate from OpenAI API keys and never falls back to API auth.
          </div>
          {oauthStatus ? (
            <div className="mt-3 rounded-md border border-info/40 bg-info-subtle/30 p-3 text-[11px] text-foreground">
              {oauthStatus}
            </div>
          ) : null}
          {oauthAuthorization ? (
            <div className="mt-3 flex gap-2">
              <Input
                value={oauthCode}
                onChange={(event) => setOauthCode(event.target.value)}
                placeholder="Final redirect URL or authorization code"
              />
              <Button
                variant="outline"
                onClick={() => void completeOpenAICodexOAuth()}
                disabled={busy || !oauthCode.trim()}
              >
                Complete
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {settings ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <SettingsCard icon={Building2} label="Workspace" title={settings.organization.name}>
            <Grid2>
              <Cell label="Preset" value={settings.setup.preset} />
              <Cell label="Mode" value={settings.setup.mode} />
              <Cell label="Interface" value={settings.interface.mode} />
              <Cell
                label="Orientation"
                value={settings.interface.mobile_first ? "Mobile-first" : "Desktop-first"}
              />
            </Grid2>
            <div className="mt-3 truncate font-mono text-[10px] text-muted-foreground">
              {settings.config_path}
            </div>
          </SettingsCard>

          <SettingsCard
            icon={Plug}
            label="Supreme Coordinator"
            title={settings.supreme_coordinator.provider}
          >
            <div className="text-[11px] text-muted-foreground">
              Model{" "}
              <span className="font-mono text-foreground">
                {settings.supreme_coordinator.model}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge variant="outline">
                {settings.supreme_coordinator.user_facing ? "Owner-facing" : "Internal only"}
              </Badge>
              <Badge variant={settings.supreme_coordinator.always_on ? "success" : "outline"}>
                {settings.supreme_coordinator.always_on ? "Always-on" : "Manual"}
              </Badge>
            </div>
          </SettingsCard>

          <SettingsCard icon={Plug} label="Organization" title="Roles & capabilities">
            <Grid2>
              <Cell label="Agent roles" value={String(settings.agents.roles)} />
              <Cell label="Configured" value={String(settings.agents.configured)} />
              <Cell label="Capabilities" value={String(settings.capabilities.catalog)} />
              <Cell label="Providers" value={String(settings.providers.connectors)} />
            </Grid2>
            <div className="mt-3 text-[10px] text-muted-foreground">
              Overrides: {settings.providers.configured_overrides.join(", ") || "none"}
            </div>
          </SettingsCard>

          <SettingsCard
            icon={Shield}
            label="Autonomy"
            title={`Level ${settings.autonomy.level ?? 2} · ${enabledCount(settings.autonomy)} enabled`}
          >
            <ToggleList values={settings.autonomy} limit={8} />
            <ReadOnlyNote />
          </SettingsCard>

          <SettingsCard
            icon={Shield}
            label="Growth Policy"
            title={`${enabledCount(settings.growth_autonomy)} / ${Object.keys(settings.growth_autonomy).length} enabled`}
          >
            <ToggleList values={settings.growth_autonomy} limit={8} />
            <ReadOnlyNote />
          </SettingsCard>

          <SettingsCard icon={Shield} label="Limits & Signals" title="Operational guards">
            <div className="select-none space-y-1.5 text-[11px]">
              <Row label="Max retries" value={settings.limits.max_retries_per_task as number} />
              <Row
                label="Files before review"
                value={settings.limits.max_files_changed_without_human_review as number}
              />
              <Row label="Stale PR hours" value={settings.triggers.thresholds.stale_pr_hours} />
              <Row
                label="Blocked issue hours"
                value={settings.triggers.thresholds.blocked_issue_hours}
              />
              <Row
                label="Memory global access"
                value={settings.memory.coordinator_has_global_access === true ? "on" : "off"}
                tone={
                  settings.memory.coordinator_has_global_access === true ? "success" : "neutral"
                }
              />
            </div>
            <ReadOnlyNote />
          </SettingsCard>
        </div>
      ) : null}

      <ResponsiveTable className="mt-5" minWidth={780}>
        <div className="grid grid-cols-[140px_100px_minmax(0,1fr)_80px_90px_100px] bg-surface-subtle/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Provider</span>
          <span>Mode</span>
          <span>Credential</span>
          <span>Source</span>
          <span>Status</span>
          <span />
        </div>
        {providers.length === 0 ? (
          <div className="border-t border-border/60 px-4 py-6 text-center text-[11px] text-muted-foreground">
            No provider connected yet.
          </div>
        ) : null}
        {providers.map((item) => (
          <div
            key={`${item.provider}:${item.id}`}
            className="grid grid-cols-[140px_100px_minmax(0,1fr)_80px_90px_100px] items-center gap-3 border-t border-border/60 px-4 py-3 text-[11px]"
          >
            <span className="truncate font-medium text-foreground">
              {item.provider_name || item.provider}
            </span>
            <span className="text-muted-foreground">{item.auth_mode}</span>
            <span className="truncate text-muted-foreground">
              {item.id}{" "}
              {item.oauth_token_masked
                ? `· ${item.oauth_token_masked}`
                : item.api_key_masked
                  ? `· ${item.api_key_masked}`
                  : ""}
            </span>
            <span className="text-muted-foreground">{item.source}</span>
            <Badge variant={item.status === "ok" ? "success" : "warning"}>{item.status}</Badge>
            {item.source === "auth" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onProviderLogout(item.provider, item.id)}
              >
                Disconnect
              </Button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </ResponsiveTable>
    </SectionShell>
  );
}

function SettingsCard({
  icon: Icon,
  label,
  title,
  children,
}: {
  icon: typeof Shield;
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-surface-subtle/60 p-4">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="truncate text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="mt-1 truncate text-[13px] font-semibold text-foreground">{title}</div>
      <div className="mt-3 min-w-0">{children}</div>
    </div>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 text-[11px] sm:grid-cols-2">{children}</div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate text-foreground">{value}</div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "success" | "neutral";
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", tone === "success" ? "text-success" : "text-foreground")}>
        {value}
      </span>
    </div>
  );
}

function ToggleList({
  values,
  limit,
}: {
  values: Record<string, boolean | number>;
  limit: number;
}) {
  const entries = Object.entries(values).filter(
    ([key, value]) => key !== "level" && typeof value === "boolean",
  );
  return (
    <div className="select-none space-y-1 text-[11px]">
      {entries.slice(0, limit).map(([key, value]) => (
        <div key={key} className="flex items-center justify-between gap-2">
          <span className="truncate text-muted-foreground">{formatLabel(key)}</span>
          <span
            className={cn(
              "cursor-default rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              value
                ? "bg-success-subtle/40 text-success"
                : "bg-surface-subtle/60 text-muted-foreground/70",
            )}
          >
            {value ? "on" : "off"}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Inline notice that a settings card is display-only. Editing autonomy, growth
 * policy, and limits requires a config write path that does not exist yet
 * (tracked in SER-148); these cards visualize `bureauos.yaml` and must not look
 * like live controls until that backend exists.
 */
function ReadOnlyNote() {
  return (
    <div className="mt-3 flex items-center gap-1.5 border-t border-border/50 pt-2 text-[10px] text-muted-foreground/80">
      <Lock className="h-3 w-3" />
      <span>Read-only. Edit in bureauos.yaml.</span>
    </div>
  );
}
