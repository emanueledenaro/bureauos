import { describe, expect, it } from "vitest";
import { OpenAIAdapter, NotConfiguredError } from "./openai.js";

describe("OpenAIAdapter", () => {
  it("reports missing credentials gracefully", async () => {
    const a = new OpenAIAdapter("openai-test", {});
    const v = await a.validateCredentials();
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("OPENAI_API_KEY");
  });

  it("reports OK when an API key is configured", async () => {
    const a = new OpenAIAdapter("openai-test", { apiKey: "sk-test" });
    const v = await a.validateCredentials();
    expect(v.ok).toBe(true);
  });

  it("throws NotConfiguredError when generating without a key", async () => {
    const a = new OpenAIAdapter("openai-test", {});
    await expect(a.generateText({ model: "gpt-5.5", prompt: "hello" })).rejects.toBeInstanceOf(
      NotConfiguredError,
    );
  });

  it("lists default model identifiers", async () => {
    const a = new OpenAIAdapter("openai-test", {});
    const models = await a.listModels();
    expect(models).toContain("gpt-5.5");
  });
});
