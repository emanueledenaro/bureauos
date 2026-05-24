import { describe, expect, it } from "vitest";
import { OAuthBridgeNotConfiguredError, OpenAICodexOAuthAdapter } from "./openai-codex.js";

describe("OpenAICodexOAuthAdapter", () => {
  it("reports missing OAuth credentials gracefully", async () => {
    const adapter = new OpenAICodexOAuthAdapter("openai-codex-test", {});
    const validation = await adapter.validateCredentials();
    expect(validation.ok).toBe(false);
    expect(validation.reason).toContain("OAuth token");
  });

  it("reports OK when an OAuth token is configured", async () => {
    const adapter = new OpenAICodexOAuthAdapter("openai-codex-test", {
      accessToken: "oauth-access-token",
    });
    const validation = await adapter.validateCredentials();
    expect(validation.ok).toBe(true);
  });

  it("does not fall back to the OpenAI API-key route", async () => {
    const adapter = new OpenAICodexOAuthAdapter("openai-codex-test", {
      accessToken: "oauth-access-token",
    });
    await expect(adapter.generateText({ model: "gpt-5", prompt: "hello" })).rejects.toThrow(
      OAuthBridgeNotConfiguredError,
    );
  });
});
