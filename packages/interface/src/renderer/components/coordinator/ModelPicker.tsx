import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ProviderConnection } from "../../lib/api";
import { activeModelLabel, buildModelOptions } from "../../lib/model-options";
import { Dropdownish } from "./_dropdownish";
import { useT } from "../../i18n/i18n";

/**
 * Compact provider/model selector for the composer footer. Choosing a model
 * sets a session-level override via the `onSelect` callback — it is NOT
 * persisted as the global default. The active label reflects the chosen
 * override until the providers list changes externally.
 */
export function ModelPicker({
  providers,
  onSelect,
  onChanged,
}: {
  providers: ProviderConnection[];
  /** Called with the chosen {provider,model} pair (session override) or undefined on reset. */
  onSelect?: (override: { provider: string; model: string } | undefined) => void;
  /** @deprecated Legacy callback kept for compatibility; prefer onSelect. */
  onChanged?: () => void;
}) {
  const t = useT();
  const [label, setLabel] = useState(() => activeModelLabel(providers));
  const options = buildModelOptions(providers);

  // Re-sync the displayed label after an external provider refresh (e.g. a connect in Settings),
  // but only when no session override has been chosen (label still matches the default).
  useEffect(() => {
    const defaultLabel = activeModelLabel(providers);
    // Only reset if the label is currently showing the old default (not a chosen override).
    setLabel((current) => {
      // If options still contain an option with exactly the current label, keep it.
      const stillValid = options.some((o) => `${o.providerName} · ${o.model}` === current);
      return stillValid ? current : defaultLabel;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers]);

  const choose = (provider: string, model: string, optionLabel: string): void => {
    setLabel(optionLabel);
    onSelect?.({ provider, model });
    onChanged?.();
  };

  return (
    <Dropdownish
      disabled={options.length === 0}
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
              choose(o.provider, o.model, `${o.providerName} · ${o.model}`);
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
