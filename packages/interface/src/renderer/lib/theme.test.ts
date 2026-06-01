import { describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY, applyTheme, persistTheme, readStoredTheme, type Theme } from "./theme";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    data,
  };
}

/** Minimal stand-in for an element's classList that records `light` state. */
function fakeRoot(hasLight = false) {
  let on = hasLight;
  return {
    classList: {
      toggle: (token: string, force?: boolean) => {
        if (token !== "light") return on;
        on = force ?? !on;
        return on;
      },
    },
    get isLight() {
      return on;
    },
  };
}

describe("readStoredTheme", () => {
  it("defaults to dark when nothing is stored", () => {
    expect(readStoredTheme(fakeStorage())).toBe("dark");
  });

  it("defaults to dark for an unrecognized value", () => {
    expect(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: "neon" }))).toBe("dark");
  });

  it("reads a valid persisted theme", () => {
    expect(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: "light" }))).toBe("light");
  });
});

describe("applyTheme", () => {
  it("adds the light class for the light theme", () => {
    const root = fakeRoot();
    applyTheme("light", root);
    expect(root.isLight).toBe(true);
  });

  it("removes the light class for the dark theme", () => {
    const root = fakeRoot(true);
    applyTheme("dark", root);
    expect(root.isLight).toBe(false);
  });
});

describe("persistTheme", () => {
  it("writes the theme to storage", () => {
    const storage = fakeStorage();
    const next: Theme = "light";
    persistTheme(next, storage);
    expect(storage.data.get(THEME_STORAGE_KEY)).toBe("light");
  });
});
