import type { TFunction } from "../i18n/i18n";
import { formatLabel } from "./format";

/**
 * Translate a backend status / enum value into a localized label.
 *
 * Backend status and enum strings (project/opportunity/run statuses, run types,
 * capability states, risk levels, etc.) reach the UI as raw snake_case tokens.
 * Per-page translation passes miss them because they are produced by `lib/`
 * builders and `formatLabel()` rather than written as literal JSX.
 *
 * This helper normalizes the raw value to a catalog key (`status.<token>`) and
 * returns the localized string when present, falling back to the title-cased
 * `formatLabel()` output for any value we have not mapped. That fallback keeps
 * unknown / free-text values readable instead of blank, and matches the prior
 * English behavior exactly when no translation exists.
 *
 * Only pass genuine status/enum values here — never free-text data, client or
 * project names, ids, or artifact titles.
 */
export function statusLabel(value: string, t: TFunction): string {
  if (!value) return "";
  const token = normalizeToken(value);
  return t(`status.${token}`, formatLabel(value));
}

/**
 * Translate a backend capability / autonomy / approval ACTION name.
 *
 * These are the policy action verbs the owner sees in Settings autonomy and
 * growth toggle rows ("Open Pull Requests", "Deploy Production", …) and as the
 * title of approval gates. Like {@link statusLabel}, the raw snake_case key is
 * normalized to a catalog key (`action.<token>`) and falls back to the
 * title-cased value when unmapped, so unknown actions stay readable.
 */
export function actionLabel(value: string, t: TFunction): string {
  if (!value) return "";
  const token = normalizeToken(value);
  return t(`action.${token}`, formatLabel(value));
}

function normalizeToken(value: string): string {
  return value
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .trim()
    .toLowerCase();
}
