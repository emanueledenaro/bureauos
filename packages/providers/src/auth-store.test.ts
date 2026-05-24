import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProviderAuthStore, maskSecret, providerAuthPath } from "./auth-store.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

describe("ProviderAuthStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-provider-auth-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes provider credentials under the workspace auth file", async () => {
    const store = ProviderAuthStore.forWorkspace(dir);
    const record = await store.upsert({
      provider: "openai",
      apiKey: "sk-test-1234567890",
      defaultModel: "gpt-5",
    });

    expect(record.id).toBe("openai-default");
    expect(record.defaultModel).toBe("gpt-5");
    expect(await exists(providerAuthPath(dir))).toBe(true);
    const mode = (await stat(providerAuthPath(dir))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("updates and removes credentials without leaking through maskSecret", async () => {
    const store = ProviderAuthStore.forWorkspace(dir);
    await store.upsert({ provider: "anthropic", apiKey: "sk-ant-old" });
    await store.upsert({ provider: "anthropic", apiKey: "sk-ant-new", baseUrl: "https://a.test" });

    const records = await store.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.apiKey).toBe("sk-ant-new");
    expect(maskSecret(records[0]?.apiKey ?? "")).toBe("sk-a...-new");

    await expect(readFile(providerAuthPath(dir), "utf8")).resolves.toContain("sk-ant-new");
    expect(await store.remove("anthropic")).toBe(true);
    expect(await exists(providerAuthPath(dir))).toBe(false);
  });
});
