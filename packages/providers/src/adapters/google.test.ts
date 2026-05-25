import { describe, expect, it } from "vitest";
import { GoogleAdapter } from "./google.js";
import { NotConfiguredError } from "./openai.js";

describe("GoogleAdapter", () => {
  it("reports missing credentials gracefully", async () => {
    const adapter = new GoogleAdapter("google-test", {});
    const validation = await adapter.validateCredentials();
    expect(validation.ok).toBe(false);
    expect(validation.reason).toContain("GOOGLE_API_KEY");
  });

  it("reports OK when an API key is configured", async () => {
    const adapter = new GoogleAdapter("google-test", { apiKey: "sk-test" });
    const validation = await adapter.validateCredentials();
    expect(validation.ok).toBe(true);
  });

  it("throws NotConfiguredError when generating without a key", async () => {
    const adapter = new GoogleAdapter("google-test", {});
    await expect(
      adapter.generateText({ model: "gemini-2.5-pro", prompt: "hello" }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("lists default model identifiers", async () => {
    const adapter = new GoogleAdapter("google-test", {});
    const models = await adapter.listModels();
    expect(models).toContain("gemini-2.5-pro");
  });

  it("generates text through the Gemini REST API", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const adapter = new GoogleAdapter("google-test", {
      apiKey: "google-key",
      baseUrl: "https://gemini.test/v1beta",
      fetch: (async (input, init) => {
        calls.push({ input, init });
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "hello gemini" }] } }],
            usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    });

    const result = await adapter.generateText({
      model: "gemini-2.5-pro",
      system: "You are BureauOS.",
      prompt: "Plan work.",
      temperature: 0.2,
      maxTokens: 120,
    });

    expect(result).toEqual({
      text: "hello gemini",
      model: "gemini-2.5-pro",
      usage: { inputTokens: 4, outputTokens: 2 },
    });
    expect(String(calls[0]?.input)).toBe(
      "https://gemini.test/v1beta/models/gemini-2.5-pro:generateContent?key=google-key",
    );
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      systemInstruction: { parts: Array<{ text: string }> };
      generationConfig: { temperature: number; maxOutputTokens: number };
    };
    expect(body.contents[0]?.parts[0]?.text).toBe("Plan work.");
    expect(body.systemInstruction.parts[0]?.text).toBe("You are BureauOS.");
    expect(body.generationConfig).toEqual({ temperature: 0.2, maxOutputTokens: 120 });
  });

  it("streams Gemini SSE text chunks", async () => {
    const adapter = new GoogleAdapter("google-test", {
      apiKey: "google-key",
      baseUrl: "https://gemini.test/v1beta",
      fetch: (async () =>
        new Response(
          [
            `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hel" }] } }] })}`,
            `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "lo" }] } }] })}`,
            "",
          ].join("\n\n"),
          { headers: { "content-type": "text/event-stream" } },
        )) as typeof fetch,
    });

    const chunks: string[] = [];
    for await (const chunk of adapter.stream({ model: "gemini-2.5-pro", prompt: "hi" })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Hel", "lo"]);
  });
});
