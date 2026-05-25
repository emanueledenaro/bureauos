import { describe, expect, it } from "vitest";
import { NotConfiguredError } from "./openai.js";
import { OpenRouterAdapter } from "./openrouter.js";

function completionResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      model: "openai/gpt-5.4-mini",
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    }),
    { headers: { "content-type": "application/json" } },
  );
}

describe("OpenRouterAdapter", () => {
  it("reports missing credentials gracefully", async () => {
    const adapter = new OpenRouterAdapter("openrouter-test", {});
    const validation = await adapter.validateCredentials();
    expect(validation.ok).toBe(false);
    expect(validation.reason).toContain("OPENROUTER_API_KEY");
  });

  it("reports OK when an API key is configured", async () => {
    const adapter = new OpenRouterAdapter("openrouter-test", { apiKey: "sk-test" });
    const validation = await adapter.validateCredentials();
    expect(validation.ok).toBe(true);
  });

  it("throws NotConfiguredError when generating without a key", async () => {
    const adapter = new OpenRouterAdapter("openrouter-test", {});
    await expect(
      adapter.generateText({ model: "openai/gpt-5.4-mini", prompt: "hello" }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("lists models from OpenRouter when available", async () => {
    const adapter = new OpenRouterAdapter("openrouter-test", {
      apiKey: "or-key",
      baseUrl: "https://openrouter.test/api",
      fetch: (async () =>
        new Response(
          JSON.stringify({ data: [{ id: "openai/gpt-5.4-mini" }, { id: "anthropic/claude" }] }),
          {
            headers: { "content-type": "application/json" },
          },
        )) as typeof fetch,
    });

    await expect(adapter.listModels()).resolves.toEqual([
      "openai/gpt-5.4-mini",
      "anthropic/claude",
    ]);
  });

  it("generates text through the OpenAI-compatible chat API", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const adapter = new OpenRouterAdapter("openrouter-test", {
      apiKey: "or-key",
      baseUrl: "https://openrouter.test/api",
      fetch: (async (input, init) => {
        calls.push({ input, init });
        return completionResponse("hello openrouter");
      }) as typeof fetch,
    });

    const result = await adapter.generateText({
      model: "openai/gpt-5.4-mini",
      system: "You are BureauOS.",
      prompt: "Plan work.",
    });

    expect(result).toEqual({
      text: "hello openrouter",
      model: "openai/gpt-5.4-mini",
      usage: { inputTokens: 5, outputTokens: 3 },
    });
    expect(String(calls[0]?.input)).toBe("https://openrouter.test/api/v1/chat/completions");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer or-key");
    expect(headers.get("x-title")).toBe("BureauOS");
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("openai/gpt-5.4-mini");
    expect(body.messages).toEqual([
      { role: "system", content: "You are BureauOS." },
      { role: "user", content: "Plan work." },
    ]);
  });

  it("streams OpenRouter SSE chunks", async () => {
    const adapter = new OpenRouterAdapter("openrouter-test", {
      apiKey: "or-key",
      baseUrl: "https://openrouter.test/api",
      fetch: (async () =>
        new Response(
          [
            `data: ${JSON.stringify({ choices: [{ delta: { content: "Hel" } }] })}`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: "lo" } }] })}`,
            "data: [DONE]",
            "",
          ].join("\n\n"),
          { headers: { "content-type": "text/event-stream" } },
        )) as typeof fetch,
    });

    const chunks: string[] = [];
    for await (const chunk of adapter.stream({ model: "openai/gpt-5.4-mini", prompt: "hi" })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Hel", "lo"]);
  });
});
