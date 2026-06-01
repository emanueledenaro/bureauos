import { useCallback, useState } from "react";

/**
 * Light/dark theme for the Operating Room.
 *
 * The dark palette is the default (`:root` in styles.css); the light palette
 * lives under `:root.light`. We switch by toggling the `light` class on
 * <html> (document.documentElement), persisting the choice in localStorage so
 * reloads keep it. `applyStoredTheme()` is called early (main.tsx) to apply the
 * saved theme before React paints, avoiding a flash of the wrong theme.
 */

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "bureauos.theme";
const DEFAULT_THEME: Theme = "dark";

function isTheme(value: string | null): value is Theme {
  return value === "dark" || value === "light";
}

/** Read the persisted theme, falling back to the dark default. */
export function readStoredTheme(storage: Pick<Storage, "getItem"> = window.localStorage): Theme {
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    // localStorage can throw (private mode, disabled storage); default safely.
    return DEFAULT_THEME;
  }
}

/** Minimal element surface needed to apply a theme (eases testing). */
interface ThemeTarget {
  classList: Pick<DOMTokenList, "toggle">;
}

/** Apply a theme to the document by toggling the `light` class on <html>. */
export function applyTheme(theme: Theme, root: ThemeTarget = document.documentElement): void {
  root.classList.toggle("light", theme === "light");
}

/** Persist a theme choice; ignores storage failures. */
export function persistTheme(
  theme: Theme,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Non-fatal: the in-memory theme still applies for this session.
  }
}

/** Apply the persisted theme to the document. Call once, as early as possible. */
export function applyStoredTheme(): Theme {
  const theme = readStoredTheme();
  applyTheme(theme);
  return theme;
}

export interface UseThemeResult {
  theme: Theme;
  toggleTheme: () => void;
}

/**
 * Theme state hook. Initializes from localStorage, and `toggleTheme` flips
 * dark<->light while applying and persisting the new value.
 */
export function useTheme(): UseThemeResult {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      applyTheme(next);
      persistTheme(next);
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
