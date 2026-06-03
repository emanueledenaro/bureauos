import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Api, type ProviderConnection } from "../../lib/api";
import { activeModelLabel, buildModelOptions } from "../../lib/model-options";
import { Dropdownish } from "./_dropdownish";
import { useT } from "../../i18n/i18n";

/**
 * Compact provider/model selector for the composer footer. Lists connected providers
 * and their default model; choosing one persists via the existing endpoint. Non-persisted
 * per-message override is deferred to Phase 2.
 */
export function ModelPicker({
  providers,
  onChanged,
}: {
  providers: ProviderConnection[];
  onChanged?: () => void;
}) {
  const t = useT();
  const [label, setLabel] = useState(() => activeModelLabel(providers));
  const [busy, setBusy] = useState(false);
  const options = buildModelOptions(providers);

  // Re-sync the displayed label after an external provider refresh (e.g. a connect in Settings).
  useEffect(() => setLabel(activeModelLabel(providers)), [providers]);

  const choose = async (provider: string, model: string, optionLabel: string): Promise<void> => {
    setBusy(true);
    try {
      await Api.providerSetDefaultModel({ provider, defaultModel: model });
      setLabel(optionLabel);
      onChanged?.();
    } catch {
      /* surfaced by the global API error bar */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dropdownish
      disabled={busy || options.length === 0}
      trigger={
        <span className="text-meta inline-flex items-center gap-1 text-muted-foreground">
          {label}
          <ChevronDown className="h-3 w-3" />
        </span>
      }
      ariaLabel={t("composer.model", "Model")}
    >
      {(close) =>
        options.map((o) => (
          <button
            key={`${o.provider}:${o.model}`}
            type="button"
            role="menuitem"
            className="text-body-secondary block w-full rounded px-2 py-1 text-left hover:bg-surface-subtle"
            onClick={() => {
              void choose(o.provider, o.model, `${o.providerName} · ${o.model}`);
              close();
            }}
          >
            {o.providerName} · {o.model}
          </button>
        ))
      }
    </Dropdownish>
  );
}
