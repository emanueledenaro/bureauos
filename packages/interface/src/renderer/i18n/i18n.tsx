import { createContext, useContext, useMemo } from "react";
import { catalog } from "./catalog";
import type { AppLang } from "./types";

export type TFunction = (key: string, fallback?: string) => string;

interface I18nContextValue {
  lang: AppLang;
  t: TFunction;
}

const I18nContext = createContext<I18nContextValue>({
  lang: "en",
  // Default resolver used when no provider is mounted (e.g. isolated tests).
  t: (key, fallback) => catalog.en[key] ?? fallback ?? key,
});

export function I18nProvider({
  lang,
  children,
}: {
  lang: AppLang;
  children: React.ReactNode;
}): React.ReactElement {
  // useMemo keyed on `lang` so consumers re-render when the language changes,
  // while a stable identity avoids needless re-renders when it does not.
  const value = useMemo<I18nContextValue>(() => {
    const t: TFunction = (key, fallback) =>
      catalog[lang][key] ?? catalog.en[key] ?? fallback ?? key;
    return { lang, t };
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): TFunction {
  return useContext(I18nContext).t;
}

export function useLang(): AppLang {
  return useContext(I18nContext).lang;
}
