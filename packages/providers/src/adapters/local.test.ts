import { describe, expect, it } from "vitest";
import { LocalAdapter } from "./local.js";
import { NotConfiguredError } from "./openai.js";

describe("LocalAdapter", () => {
  it("reports missing base URL gracefully", async () => {
    const adapter = new LocalAdapter("local-test", {});
    const validation = await adapter.validateCredentials();
    expect(validation.ok).toBe(false);
    expect(validation.reason).toContain("baseUrl");
  });

  it("reports OK when a base URL is configured", async () => {
    const adapter = new LocalAdapter("local-test", { baseUrl: "http://localhost:11434" });
    const validation = await adapter.validateCredentials();
    expect(validation.ok).toBe(true);
  });

  it("throws NotConfiguredError when generating without a base URL", async () => {
    const adapter = new LocalAdapter("local-test", {});
    await expect(
      adapter.generateText({ model: "qwen3-coder", prompt: "hello" }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("lists local OpenAI-compatible models when available", async () => {
    const adapter = new LocalAdapter("local-test", {
      baseUrl: "http://localhost:11434",
      fetch: (async () =>
        new Response(JSON.stringify({ data: [{ id: "qwen3-coder" }] }), {
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    });

    await expect(adapter.listModels()).resolves.toEqual(["qwen3-coder"]);
  });

  it("generates text through a local OpenAI-compatible endpoint", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const adapter = new LocalAdapter("local-test", {
      baseUrl: "http://localhost:11434",
      fetch: (async (input, init) => {
        calls.push({ input, init });
        return new Response(
          JSON.stringify({
            model: "qwen3-coder",
            choices: [{ message: { content: "local response" } }],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    });

    const result = await adapter.generateText({ model: "qwen3-coder", prompt: "hello" });

    expect(result.text).toBe("local response");
    expect(result.model).toBe("qwen3-coder");
    expect(String(calls[0]?.input)).toBe("http://localhost:11434/v1/chat/completions");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBeNull();
  });

  it("does not duplicate /v1 when the local base URL already includes it", async () => {
    const calls: string[] = [];
    const adapter = new LocalAdapter("local-test", {
      baseUrl: "http://localhost:11434/v1",
      fetch: (async (input) => {
        calls.push(String(input));
        return new Response(
          JSON.stringify({
            model: "qwen3-coder",
            choices: [{ message: { content: "local response" } }],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    });

    await adapter.generateText({ model: "qwen3-coder", prompt: "hello" });

    expect(calls[0]).toBe("http://localhost:11434/v1/chat/completions");
  });

  it("streams local SSE chunks", async () => {
    const adapter = new LocalAdapter("local-test", {
      baseUrl: "http://localhost:11434",
      fetch: (async () =>
        new Response(
          [
            `data: ${JSON.stringify({ choices: [{ delta: { content: "Lo" } }] })}`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: "cal" } }] })}`,
            "data: [DONE]",
            "",
          ].join("\n\n"),
          { headers: { "content-type": "text/event-stream" } },
        )) as typeof fetch,
    });

    const chunks: string[] = [];
    for await (const chunk of adapter.stream({ model: "qwen3-coder", prompt: "hi" })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Lo", "cal"]);
  });
});
