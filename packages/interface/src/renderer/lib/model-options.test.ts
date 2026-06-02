import { describe, expect, it } from "vitest";
import type { ProviderConnection } from "./api";
import { activeModelLabel, buildModelOptions } from "./model-options";

const conn = (overrides: Partial<ProviderConnection>): ProviderConnection => ({
  provider: "anthropic",
  provider_name: "Anthropic",
  id: "anthropic:default",
  source: "auth",
  auth_mode: "api-key",
  has_api_key: true,
  api_key_masked: "sk-***",
  oauth_token_masked: "",
  base_url: "",
  default_model: "claude-sonnet",
  no_api_fallback: false,
  status: "ok",
  ...overrides,
});

describe("model-options", () => {
  it("builds options only from connected providers", () => {
    const options = buildModelOptions([
      conn({}),
      conn({ provider: "openai", provider_name: "OpenAI", default_model: "gpt-x", status: "missing" }),
    ]);
    expect(options).toEqual([{ provider: "anthropic", providerName: "Anthropic", model: "claude-sonnet" }]);
  });

  it("labels the first connected provider, with a fallback when none", () => {
    expect(activeModelLabel([conn({})])).toBe("Anthropic · claude-sonnet");
    expect(activeModelLabel([conn({ status: "missing" })])).toBe("No model connected");
  });
});
