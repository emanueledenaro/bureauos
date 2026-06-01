import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Globe, KeyRound, Loader2, Plug, Shield } from "lucide-react";
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
import { useT } from "../i18n/i18n";
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
  const t = useT();
  const [provider, setProvider] = useState("openai-codex");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [oauthCode, setOauthCode] = useState("");
  const [oauthAuthorization, setOauthAuthorization] = useState<
    ProviderAuthAuthorization | undefined
  >();
  const [oauthStatus, setOauthStatus] = useState<string | undefined>();
  const [connectError, setConnectError] = useState<string | undefined>();
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
    setOauthStatus(t("settings.openingAuthorization", "Opening OpenAI authorization…"));
    const authorization = await Api.providerOAuthAuthorize("openai-codex");
    setOauthAuthorization(authorization);
    await openAuthorizationUrl(authorization.url);

    if (authorization.method === "code") {
      setOauthStatus(authorization.instructions);
      return;
    }

    setOauthStatus(t("settings.waitingForAuthorization", "Waiting for browser authorization…"));
    const result = await Api.providerOAuthCallback("openai-codex", {
      method: "auto",
      ...(defaultModel.trim() ? { defaultModel: defaultModel.trim() } : {}),
    });
    if (result.status !== "connected") {
      setOauthStatus(
        t(
          "settings.authorizationPendingPaste",
          "Authorization is still pending. Paste the final redirect URL to complete.",
        ),
      );
      return;
    }
    setOauthStatus(t("settings.oauthConnected", "OpenAI Codex OAuth connected."));
    setOauthAuthorization(undefined);
    setOauthCode("");
    setDefaultModel("");
    await onRefresh();
  };

  const completeOpenAICodexOAuth = async (): Promise<void> => {
    const code = extractOAuthCode(oauthCode);
    if (!code || busy) return;
    setBusy(true);
    setConnectError(undefined);
    setOauthStatus(t("settings.completingOauth", "Completing OpenAI Codex OAuth…"));
    try {
      const result = await Api.providerOAuthCallback("openai-codex", {
        method: "code",
        code,
        ...(defaultModel.trim() ? { defaultModel: defaultModel.trim() } : {}),
      });
      if (result.status !== "connected") {
        setOauthStatus(t("settings.authorizationPending", "Authorization is still pending."));
        return;
      }
      setOauthStatus(t("settings.oauthConnected", "OpenAI Codex OAuth connected."));
      setOauthAuthorization(undefined);
      setOauthCode("");
      setDefaultModel("");
      await onRefresh();
    } catch (error) {
      setConnectError(
        error instanceof Error
          ? error.message
          : t("settings.failedCompleteOauth", "Failed to complete OAuth."),
      );
      setOauthStatus(undefined);
    } finally {
      setBusy(false);
    }
  };

  const saveModel = async (): Promise<void> => {
    if (savingModel || !connectedProvider || connectedProvider.source !== "auth") return;
    const next = defaultModel.trim();
    if (!next) {
      setModelStatus(t("settings.pickModelBeforeSaving", "Pick a model before saving."));
      return;
    }
    setSavingModel(true);
    setModelStatus(t("settings.savingModel", "Saving model…"));
    try {
      await Api.providerSetDefaultModel({
        provider,
        id: connectedProvider.id,
        defaultModel: next,
      });
      modelTouched.current = false;
      setModelStatus(`${t("settings.defaultModelSetTo", "Default model set to")} ${next}.`);
      await onRefresh();
    } catch (error) {
      setModelStatus(
        error instanceof Error
          ? error.message
          : t("settings.failedUpdateModel", "Failed to update model."),
      );
    } finally {
      setSavingModel(false);
    }
  };

  // Owner edits to autonomy / growth-policy / limits go through one guarded
  // write path (`POST /settings/autonomy`). We track an in-flight key so its
  // control disables while saving, and surface any rejection inline.
  const [savingSetting, setSavingSetting] = useState<string | undefined>();
  const [settingsError, setSettingsError] = useState<string | undefined>();

  const updateSettings = async (
    key: string,
    input: {
      autonomy?: Record<string, boolean>;
      growth_autonomy?: Record<string, boolean>;
      limits?: Record<string, number | boolean>;
      interface?: { language?: "en" | "it" };
    },
  ): Promise<void> => {
    if (savingSetting) return;
    setSavingSetting(key);
    setSettingsError(undefined);
    try {
      await Api.updateSettings(input);
      await onRefresh();
    } catch (error) {
      setSettingsError(
        error instanceof Error
          ? error.message
          : t("settings.failedUpdateSettings", "Failed to update settings."),
      );
    } finally {
      setSavingSetting(undefined);
    }
  };

  const connect = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setConnectError(undefined);
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
    } catch (error) {
      // A rejected authorize/callback/login left the owner staring at a frozen
      // "in progress" status with no error and no retry (SER-205). Surface the
      // failure, clear the fake progress message, and re-enable the buttons.
      setConnectError(
        error instanceof Error
          ? error.message
          : t("settings.failedConnectProvider", "Failed to connect provider."),
      );
      setOauthStatus(undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionShell
      title={t("settings.title", "Settings")}
      description={t(
        "settings.description",
        "Provider authentication, autonomy policy, and routing.",
      )}
    >
      <div className="grid gap-3 rounded-lg border border-border/70 bg-surface-subtle/60 p-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("settings.providerLabel", "Provider")}
          </label>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger>
              <SelectValue placeholder={t("settings.selectProvider", "Select provider")} />
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
              {t("settings.apiKey", "API key")}
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
              {t("settings.baseUrl", "Base URL")}
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
            {t("settings.defaultModel", "Default model")}
          </label>
          <Select value={defaultModel} onValueChange={selectModel}>
            <SelectTrigger>
              <SelectValue placeholder={t("settings.auto", "Auto")} />
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
              ? t("settings.reconnectOauth", "Reconnect OAuth")
              : t("settings.connectOauth", "Connect OAuth")
            : connectedProvider?.source === "auth"
              ? t("settings.reconnect", "Reconnect")
              : t("settings.connect", "Connect")}
        </Button>
      </div>

      {connectError ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-danger/40 bg-danger-subtle/30 p-3 text-[11px] text-danger"
        >
          {connectError}
        </div>
      ) : null}

      {connectedProvider?.source === "auth" ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border/70 bg-surface-subtle/40 px-4 py-3">
          <Badge variant="success">{t("settings.connected", "Connected")}</Badge>
          <span className="text-[11px] text-muted-foreground">
            {t("settings.currentModel", "Current model")}{" "}
            <span className="font-mono text-foreground">
              {connectedProvider.default_model || t("settings.autoLower", "auto")}
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
            {connectedProvider.default_model
              ? t("settings.updateModel", "Update model")
              : t("settings.saveModelButton", "Save model")}
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
                  {connector.source === "config"
                    ? t("settings.configOverride", "Config override")
                    : t("settings.builtInConnector", "Built-in connector")}
                </Badge>
                <Badge variant="outline">
                  {t("settings.default", "Default")} {connector.defaultModel}
                </Badge>
                <Badge variant="outline">
                  {connector.models.length} {t("settings.models", "models")}
                </Badge>
                {modelList ? (
                  <Badge variant="outline">
                    {t("settings.modelsFrom", "Models from")} {modelList.source}
                  </Badge>
                ) : null}
                {selectedModel ? (
                  <Badge variant="info">
                    {formatLabel(selectedModel.budgetTier)} {t("settings.budget", "budget")}
                  </Badge>
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
              {t(
                "settings.connectorIsolated",
                "This connector is isolated from API-key providers and never falls back to API auth.",
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {provider === "openai-codex" ? (
        <div className="mt-4 rounded-lg border border-border/70 bg-surface-subtle/60 p-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="text-[12px] font-semibold text-foreground">
              {t("settings.codexOauthOnly", "OpenAI Codex uses browser OAuth only")}
            </div>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {t(
              "settings.codexSeparate",
              "This connection is separate from OpenAI API keys and never falls back to API auth.",
            )}
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
                placeholder={t(
                  "settings.redirectUrlPlaceholder",
                  "Final redirect URL or authorization code",
                )}
              />
              <Button
                variant="outline"
                onClick={() => void completeOpenAICodexOAuth()}
                disabled={busy || !oauthCode.trim()}
              >
                {t("settings.complete", "Complete")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {settings ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <SettingsCard
            icon={Building2}
            label={t("settings.workspace", "Workspace")}
            title={settings.organization.name}
          >
            <Grid2>
              <Cell label={t("settings.preset", "Preset")} value={settings.setup.preset} />
              <Cell label={t("settings.mode", "Mode")} value={settings.setup.mode} />
              <Cell label={t("settings.interface", "Interface")} value={settings.interface.mode} />
              <Cell
                label={t("settings.orientation", "Orientation")}
                value={
                  settings.interface.mobile_first
                    ? t("settings.mobileFirst", "Mobile-first")
                    : t("settings.desktopFirst", "Desktop-first")
                }
              />
            </Grid2>
            <div className="mt-3 truncate font-mono text-[10px] text-muted-foreground">
              {settings.config_path}
            </div>
          </SettingsCard>

          <SettingsCard
            icon={Plug}
            label={t("settings.supremeCoordinator", "Supreme Coordinator")}
            title={settings.supreme_coordinator.provider}
          >
            <div className="text-[11px] text-muted-foreground">
              {t("settings.model", "Model")}{" "}
              <span className="font-mono text-foreground">
                {settings.supreme_coordinator.model}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge variant="outline">
                {settings.supreme_coordinator.user_facing
                  ? t("settings.ownerFacing", "Owner-facing")
                  : t("settings.internalOnly", "Internal only")}
              </Badge>
              <Badge variant={settings.supreme_coordinator.always_on ? "success" : "outline"}>
                {settings.supreme_coordinator.always_on
                  ? t("settings.alwaysOn", "Always-on")
                  : t("settings.manual", "Manual")}
              </Badge>
            </div>
          </SettingsCard>

          <SettingsCard
            icon={Plug}
            label={t("settings.organization", "Organization")}
            title={t("settings.rolesCapabilities", "Roles & capabilities")}
          >
            <Grid2>
              <Cell
                label={t("settings.agentRoles", "Agent roles")}
                value={String(settings.agents.roles)}
              />
              <Cell
                label={t("settings.configured", "Configured")}
                value={String(settings.agents.configured)}
              />
              <Cell
                label={t("settings.capabilities", "Capabilities")}
                value={String(settings.capabilities.catalog)}
              />
              <Cell
                label={t("settings.providers", "Providers")}
                value={String(settings.providers.connectors)}
              />
            </Grid2>
            <div className="mt-3 text-[10px] text-muted-foreground">
              {t("settings.overrides", "Overrides")}:{" "}
              {settings.providers.configured_overrides.join(", ") || t("settings.none", "none")}
            </div>
          </SettingsCard>

          <SettingsCard
            icon={Globe}
            label={t("settings.language", "Language")}
            title={settings.interface.language === "it" ? "Italiano" : "English"}
          >
            <div className="flex gap-2">
              {(
                [
                  ["en", "English"],
                  ["it", "Italiano"],
                ] as const
              ).map(([code, label]) => {
                const active = settings.interface.language === code;
                return (
                  <button
                    key={code}
                    type="button"
                    disabled={savingSetting !== undefined || active}
                    onClick={() =>
                      void updateSettings("interface.language", { interface: { language: code } })
                    }
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors focus-ring disabled:cursor-default",
                      active
                        ? "border-primary/60 bg-primary/15 text-foreground"
                        : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              {t(
                "settings.languageHelp",
                "Saved to your workspace and applied on next load. English is the complete base; Italian translation of the interface is rolling out.",
              )}
            </div>
          </SettingsCard>

          <SettingsCard
            icon={Shield}
            label={t("settings.autonomy", "Autonomy")}
            title={`${t("settings.level", "Level")} ${settings.autonomy.level ?? 2} · ${enabledCount(settings.autonomy)} ${t("settings.enabled", "enabled")}`}
          >
            <ToggleList
              values={settings.autonomy}
              limit={12}
              savingKey={savingSetting}
              onToggle={(key, next) =>
                void updateSettings(`autonomy.${key}`, { autonomy: { [key]: next } })
              }
            />
          </SettingsCard>

          <SettingsCard
            icon={Shield}
            label={t("settings.growthPolicy", "Growth Policy")}
            title={`${enabledCount(settings.growth_autonomy)} / ${Object.keys(settings.growth_autonomy).length} ${t("settings.enabled", "enabled")}`}
          >
            <ToggleList
              values={settings.growth_autonomy}
              limit={12}
              savingKey={savingSetting}
              onToggle={(key, next) =>
                void updateSettings(`growth_autonomy.${key}`, {
                  growth_autonomy: { [key]: next },
                })
              }
            />
          </SettingsCard>

          <SettingsCard
            icon={Shield}
            label={t("settings.limitsSignals", "Limits & Signals")}
            title={t("settings.operationalGuards", "Operational guards")}
          >
            <div className="space-y-1.5 text-[11px]">
              <NumberRow
                label={t("settings.maxRetries", "Max retries")}
                value={settings.limits.max_retries_per_task as number}
                savingKey={savingSetting}
                fieldKey="limits.max_retries_per_task"
                onSave={(next) =>
                  void updateSettings("limits.max_retries_per_task", {
                    limits: { max_retries_per_task: next },
                  })
                }
              />
              <NumberRow
                label={t("settings.filesBeforeReview", "Files before review")}
                value={settings.limits.max_files_changed_without_human_review as number}
                savingKey={savingSetting}
                fieldKey="limits.max_files_changed_without_human_review"
                onSave={(next) =>
                  void updateSettings("limits.max_files_changed_without_human_review", {
                    limits: { max_files_changed_without_human_review: next },
                  })
                }
              />
              <Row
                label={t("settings.stalePrHours", "Stale PR hours")}
                value={settings.triggers.thresholds.stale_pr_hours}
              />
              <Row
                label={t("settings.blockedIssueHours", "Blocked issue hours")}
                value={settings.triggers.thresholds.blocked_issue_hours}
              />
              <Row
                label={t("settings.memoryGlobalAccess", "Memory global access")}
                value={
                  settings.memory.coordinator_has_global_access === true
                    ? t("settings.on", "on")
                    : t("settings.off", "off")
                }
                tone={
                  settings.memory.coordinator_has_global_access === true ? "success" : "neutral"
                }
              />
            </div>
          </SettingsCard>
        </div>
      ) : null}

      {settingsError ? (
        <div className="mt-3 rounded-md border border-warning/40 bg-warning-subtle/30 p-3 text-[11px] text-foreground">
          {settingsError}
        </div>
      ) : null}

      <ResponsiveTable className="mt-5" minWidth={780}>
        <div className="grid grid-cols-[140px_100px_minmax(0,1fr)_80px_90px_100px] bg-surface-subtle/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>{t("settings.colProvider", "Provider")}</span>
          <span>{t("settings.colMode", "Mode")}</span>
          <span>{t("settings.colCredential", "Credential")}</span>
          <span>{t("settings.colSource", "Source")}</span>
          <span>{t("settings.colStatus", "Status")}</span>
          <span />
        </div>
        {providers.length === 0 ? (
          <div className="border-t border-border/60 px-4 py-6 text-center text-[11px] text-muted-foreground">
            {t("settings.noProviderConnected", "No provider connected yet.")}
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
                {t("settings.disconnect", "Disconnect")}
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

/**
 * Interactive list of boolean policy switches. Each row is a real toggle that
 * persists through `onToggle`; the matching control disables while its write is
 * in flight (`savingKey` carries the group-qualified key, e.g.
 * `autonomy.create_issues`). The `level` key is presentational and skipped.
 */
function ToggleList({
  values,
  limit,
  savingKey,
  onToggle,
}: {
  values: Record<string, boolean | number>;
  limit: number;
  savingKey?: string;
  onToggle: (key: string, next: boolean) => void;
}) {
  const entries = Object.entries(values).filter(
    ([key, value]) => key !== "level" && typeof value === "boolean",
  );
  return (
    <div className="space-y-1 text-[11px]">
      {entries.slice(0, limit).map(([key, value]) => {
        const on = value === true;
        return (
          <div key={key} className="flex items-center justify-between gap-2">
            <span className="truncate text-muted-foreground">{formatLabel(key)}</span>
            <PolicyToggle
              on={on}
              saving={savingKey !== undefined}
              onClick={() => onToggle(key, !on)}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Single on/off control styled as the prior read-only pill so the card layout is
 * unchanged, but now clickable. Disabled while any settings write is in flight to
 * avoid racing concurrent edits against the single config file.
 */
function PolicyToggle({
  on,
  saving,
  onClick,
}: {
  on: boolean;
  saving: boolean;
  onClick: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      aria-pressed={on}
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-60",
        on
          ? "bg-success-subtle/40 text-success hover:bg-success-subtle/60"
          : "bg-surface-subtle/60 text-muted-foreground/70 hover:bg-surface-subtle",
      )}
    >
      {on ? t("settings.on", "on") : t("settings.off", "off")}
    </button>
  );
}

/**
 * Editable positive-integer limit. The owner edits a small inline field and
 * commits on blur or Enter; the value is reset to the persisted prop whenever it
 * changes so a rejected or refreshed update reverts cleanly. Only commits when
 * the parsed value is a positive integer different from the current one.
 */
function NumberRow({
  label,
  value,
  fieldKey,
  savingKey,
  onSave,
}: {
  label: string;
  value: number;
  fieldKey: string;
  savingKey?: string;
  onSave: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (): void => {
    const next = Number(draft);
    if (!Number.isInteger(next) || next < 1 || next === value) {
      setDraft(String(value));
      return;
    }
    onSave(next);
  };

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type="number"
        min={1}
        step={1}
        value={draft}
        disabled={savingKey === fieldKey}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="h-6 w-16 px-2 text-right text-[11px]"
      />
    </div>
  );
}
