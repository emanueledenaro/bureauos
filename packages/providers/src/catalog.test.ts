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
    expect(defaultProviderCredentialId("anthropic")).toBe("anthropic-default");
    expect(defaultProviderAuthMode("local")).toBe("local");
  });
});
