import { describe, expect, it } from "vitest";
import { AnthropicAdapter } from "./anthropic.js";
import { NotConfiguredError } from "./openai.js";

describe("AnthropicAdapter", () => {
  it("reports missing credentials gracefully", async () => {
    const a = new AnthropicAdapter("anthropic-test", {});
    const v = await a.validateCredentials();
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("ANTHROPIC_API_KEY");
  });

  it("reports OK when an API key is configured", async () => {
    const a = new AnthropicAdapter("anthropic-test", { apiKey: "sk-test" });
    const v = await a.validateCredentials();
    expect(v.ok).toBe(true);
  });

  it("throws NotConfiguredError when generating without a key", async () => {
    const a = new AnthropicAdapter("anthropic-test", {});
    await expect(
      a.generateText({ model: "claude-opus-4-7", prompt: "hello" }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("lists default model identifiers", async () => {
    const a = new AnthropicAdapter("anthropic-test", {});
    const models = await a.listModels();
    expect(models).toContain("claude-opus-4-7");
  });
});
