import { describe, expect, it } from "vitest";
import {
  defaultProviderAuthMode,
  defaultProviderCredentialId,
  getProviderConnector,
  listProviderConnectors,
  providerAuthMethods,
} from "./catalog.js";

describe("provider connector catalog", () => {
  it("exposes OpenCode-style provider auth methods from a single catalog", () => {
    const methods = providerAuthMethods();

    expect(methods["openai-codex"]).toEqual([
      { type: "oauth", label: "ChatGPT Plus/Pro (browser)" },
    ]);
    expect(methods["openai"]).toEqual([{ type: "api", label: "API key" }]);
    expect(methods["local"]).toEqual([{ type: "local", label: "Local endpoint" }]);
  });

  it("keeps OpenAI Codex OAuth isolated from OpenAI API credentials", () => {
    const codex = getProviderConnector("openai-codex");
    const openai = getProviderConnector("openai");

    expect(codex.noApiFallback).toBe(true);
    expect(codex.defaultAuthMode).toBe("oauth");
    expect(openai.noApiFallback).toBe(false);
    expect(openai.defaultAuthMode).toBe("api-key");
  });

  it("lists connector metadata without needing stored credentials", () => {
    const connectors = listProviderConnectors();

    expect(connectors.map((connector) => connector.id)).toContain("anthropic");
    expect(connectors.find((connector) => connector.id === "openai")?.defaultModel).toBe("gpt-5");
    expect(defaultProviderCredentialId("anthropic")).toBe("anthropic-default");
    expect(defaultProviderAuthMode("local")).toBe("local");
  });

  it("applies OpenCode-style enabled, disabled, and provider model overrides", () => {
    const connectors = listProviderConnectors({
      enabled_providers: ["openai", "anthropic"],
      disabled_providers: ["anthropic"],
      provider: {
        openai: {
          name: "OpenAI Enterprise",
          env: ["OPENAI_ENTERPRISE_KEY"],
          options: { defaultModel: "gpt-5-enterprise" },
          models: {
            "gpt-5-enterprise": {
              name: "GPT-5 Enterprise",
              capabilities: ["chat", "reasoning"],
              budgetTier: "premium",
            },
            "gpt-4o-mini": { disabled: true },
          },
        },
      },
    });

    expect(connectors.map((connector) => connector.id)).toEqual(["openai"]);
    expect(connectors[0]).toMatchObject({
      name: "OpenAI Enterprise",
      source: "config",
      defaultModel: "gpt-5-enterprise",
      env: { apiKey: ["OPENAI_ENTERPRISE_KEY"] },
    });
    expect(connectors[0]?.models.map((model) => model.id)).toContain("gpt-5-enterprise");
    expect(connectors[0]?.models.map((model) => model.id)).not.toContain("gpt-4o-mini");
    expect(connectors[0]?.models.find((model) => model.id === "gpt-5-enterprise")).toMatchObject({
      capabilities: ["chat", "reasoning"],
      budgetTier: "premium",
    });
  });
});
