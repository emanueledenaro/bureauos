import type { AppLang, CatalogNamespace } from "./types";

// Every namespace file under ./namespaces/*.ts is auto-loaded via Vite's glob
// import. Page agents only ever create / edit their own namespace file — they
// never touch this shared loader, so two agents working on two pages can never
// produce a merge conflict in the i18n layer.
// Exclude *.test.ts / *.spec.ts files: they import vitest, which crashes the
// app when loaded outside vitest's test runtime (e.g. under Vite dev server or
// in Playwright e2e). Vite 6 supports negation patterns in glob arrays.
const modules = import.meta.glob<{ default?: CatalogNamespace }>(
  ["./namespaces/*.ts", "!./namespaces/*.test.ts", "!./namespaces/*.spec.ts"],
  { eager: true },
);

function isCatalogNamespace(value: unknown): value is CatalogNamespace {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { en?: unknown; it?: unknown };
  return (
    typeof candidate.en === "object" &&
    candidate.en !== null &&
    typeof candidate.it === "object" &&
    candidate.it !== null
  );
}

export const catalog: Record<AppLang, Record<string, string>> = {
  en: {},
  it: {},
};

for (const mod of Object.values(modules)) {
  const ns = mod?.default;
  // Be defensive: skip anything that isn't a valid CatalogNamespace so a
  // malformed namespace file can never crash the whole renderer at boot.
  if (!isCatalogNamespace(ns)) continue;
  Object.assign(catalog.en, ns.en);
  Object.assign(catalog.it, ns.it);
}
