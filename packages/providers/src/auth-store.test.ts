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
      defaultModel: "gpt-5.5",
    });

    expect(record.id).toBe("openai-default");
    expect(record.mode).toBe("api-key");
    expect(record.defaultModel).toBe("gpt-5.5");
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

  it("stores OpenAI Codex OAuth separately from OpenAI API keys", async () => {
    const store = ProviderAuthStore.forWorkspace(dir);
    const oauth = await store.upsert({
      provider: "openai-codex",
      accessToken: "oauth-access-token-123456",
      refreshToken: "oauth-refresh-token-123456",
      defaultModel: "gpt-5.3-codex",
    });
    const api = await store.upsert({
      provider: "openai",
      apiKey: "sk-openai-api-key",
      defaultModel: "gpt-5.5",
    });

    expect(oauth.id).toBe("openai-codex-default");
    expect(oauth.mode).toBe("oauth");
    expect(oauth.apiKey).toBe("");
    expect(api.id).toBe("openai-default");
    expect(api.mode).toBe("api-key");
    expect(api.accessToken).toBe("");

    const records = await store.list();
    expect(records.map((record) => `${record.provider}:${record.mode}`).sort()).toEqual([
      "openai-codex:oauth",
      "openai:api-key",
    ]);
  });

  it("rejects OAuth on the OpenAI API provider", async () => {
    const store = ProviderAuthStore.forWorkspace(dir);
    await expect(
      store.upsert({
        provider: "openai",
        mode: "oauth",
        accessToken: "oauth-access-token-123456",
      }),
    ).rejects.toThrow("openai-codex");
  });

  it("updates the default model on an OAuth credential while keeping its tokens", async () => {
    const store = ProviderAuthStore.forWorkspace(dir);
    await store.upsert({
      provider: "openai-codex",
      accessToken: "oauth-access-token-123456",
      refreshToken: "oauth-refresh-token-123456",
      defaultModel: "gpt-5.3-codex",
    });

    const updated = await store.setDefaultModel("openai-codex", "gpt-5.4-codex");
    expect(updated?.defaultModel).toBe("gpt-5.4-codex");
    expect(updated?.accessToken).toBe("oauth-access-token-123456");
    expect(updated?.refreshToken).toBe("oauth-refresh-token-123456");
    expect(updated?.mode).toBe("oauth");

    const records = await store.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.defaultModel).toBe("gpt-5.4-codex");
  });

  it("does not create a credential when updating a model for an unconnected provider", async () => {
    const store = ProviderAuthStore.forWorkspace(dir);
    const result = await store.setDefaultModel("anthropic", "claude-x");
    expect(result).toBeUndefined();
    expect(await store.list()).toHaveLength(0);
  });
});
