import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderAdapter } from "@bureauos/providers";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/loader.js";
import { ClientRegistry } from "../registries/client.js";
import { CoordinatorChatService } from "./chat.js";
import { CoordinatorMessageStore } from "./messages.js";

describe("CoordinatorChatService", () => {
  it("does not create intake records when the owner asks for analysis only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    const service = new CoordinatorChatService(dir, { config: defaultConfig("freelancer") });

    const result = await service.process({
      source: "test",
      message:
        "Ho un cliente pizzeria che vuole un sito con prenotazioni. Dimmi il prossimo passo operativo concreto, senza creare nulla.",
    });

    expect(result.mode).toBe("answer");
    expect(result.result).toBeUndefined();
    await expect(new ClientRegistry(dir).list()).resolves.toEqual([]);
  });

  it("does not turn historical pizzeria context into a current request", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    const messages = new CoordinatorMessageStore(dir);
    await messages.appendMany([
      {
        role: "owner",
        text: "Ho parlato con una pizzeria che vuole un sito con prenotazioni.",
      },
      {
        role: "coordinator",
        text: "Creo il brief per il lead pizzeria.",
      },
    ]);

    let providerWasAsked = false;
    const fakeProvider: ProviderAdapter = {
      id: "fake-provider",
      type: "custom",
      name: "Fake Provider",
      async listModels() {
        return ["fake-model"];
      },
      async validateCredentials() {
        return { ok: true };
      },
      async generateText() {
        return {
          model: "fake-model",
          text: "C'e un lead pizzeria interessato a un sito con prenotazioni.",
        };
      },
      async *stream() {
        yield "unused";
      },
    };
    const service = new CoordinatorChatService(dir, {
      config: defaultConfig("freelancer"),
      messages,
      providerSelector: async () => {
        providerWasAsked = true;
        return { provider: fakeProvider, model: "fake-model" };
      },
    });

    const result = await service.process({
      source: "test",
      message: "Ciao 👋",
    });

    expect(result.mode).toBe("answer");
    expect(providerWasAsked).toBe(false);
    expect(result.provider.reason).toBe("low_context_current_message");
    expect(result.coordinatorMessage.text.toLowerCase()).not.toContain("pizzeria");
    expect(result.coordinatorMessage.text.toLowerCase()).not.toContain("prenotazioni");
  });

  it("treats small talk as low context and does not ask a provider to improvise", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    let providerWasAsked = false;
    const fakeProvider: ProviderAdapter = {
      id: "fake-provider",
      type: "custom",
      name: "Fake Provider",
      async listModels() {
        return ["fake-model"];
      },
      async validateCredentials() {
        return { ok: true };
      },
      async generateText() {
        providerWasAsked = true;
        return {
          model: "fake-model",
          text: "**Crafting a friendly Italian reply**\n\nI need to respond to the user. Ciao. Sono operativo.",
        };
      },
      async *stream() {
        yield "unused";
      },
    };
    const service = new CoordinatorChatService(dir, {
      config: defaultConfig("freelancer"),
      providerSelector: async () => ({ provider: fakeProvider, model: "fake-model" }),
    });

    const result = await service.process({
      source: "test",
      message: "ciao come stai?",
    });

    expect(result.provider.reason).toBe("low_context_current_message");
    expect(providerWasAsked).toBe(false);
    expect(result.coordinatorMessage.text).toContain("Sono operativo");
    expect(result.coordinatorMessage.text.toLowerCase()).not.toContain("i need to");
    expect(result.coordinatorMessage.text.toLowerCase()).not.toContain("crafting");
  });

  it("strips provider drafting commentary from owner-facing answers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    const fakeProvider: ProviderAdapter = {
      id: "fake-provider",
      type: "custom",
      name: "Fake Provider",
      async listModels() {
        return ["fake-model"];
      },
      async validateCredentials() {
        return { ok: true };
      },
      async generateText() {
        return {
          model: "fake-model",
          text: "**Crafting an operational answer**\n\nI need to explain the status. Ok, lavoro sullo stato dei provider.",
        };
      },
      async *stream() {
        yield "unused";
      },
    };
    const service = new CoordinatorChatService(dir, {
      config: defaultConfig("freelancer"),
      providerSelector: async () => ({ provider: fakeProvider, model: "fake-model" }),
    });

    const result = await service.process({
      source: "test",
      message: "controlla provider e memoria",
    });

    expect(result.provider.status).toBe("used");
    expect(result.coordinatorMessage.text).toBe("Ok, lavoro sullo stato dei provider.");
  });

  it("does not persist provider prompts, traces, or hidden reasoning in chat replies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    const fakeProvider: ProviderAdapter = {
      id: "fake-provider",
      type: "custom",
      name: "Fake Provider",
      async listModels() {
        return ["fake-model"];
      },
      async validateCredentials() {
        return { ok: true };
      },
      async generateText() {
        return {
          model: "fake-model",
          text: [
            "<analysis>I need to reason through the user request.</analysis>",
            "",
            "System prompt:",
            "You are the Supreme Coordinator.",
            "",
            "Tool trace:",
            '{"prompt":"Current owner message: controlla la chat"}',
            "",
            "Final answer:",
            "Ok, controllo la chat e tengo visibile solo la risposta operativa.",
          ].join("\n"),
        };
      },
      async *stream() {
        yield "unused";
      },
    };
    const messages = new CoordinatorMessageStore(dir);
    const service = new CoordinatorChatService(dir, {
      config: defaultConfig("freelancer"),
      messages,
      providerSelector: async () => ({ provider: fakeProvider, model: "fake-model" }),
    });

    const result = await service.process({
      source: "test",
      message: "controlla la chat del coordinatore",
    });

    expect(result.provider.status).toBe("used");
    expect(result.coordinatorMessage.text).toBe(
      "Ok, controllo la chat e tengo visibile solo la risposta operativa.",
    );
    const history = await messages.list();
    expect(history.at(-1)?.text).toBe(
      "Ok, controllo la chat e tengo visibile solo la risposta operativa.",
    );
    const visible = JSON.stringify(result);
    expect(visible.toLowerCase()).not.toContain("system prompt");
    expect(visible.toLowerCase()).not.toContain("tool trace");
    expect(visible.toLowerCase()).not.toContain("i need to");
    expect(visible.toLowerCase()).not.toContain("current owner message");
  });

  it("falls back when provider generation hangs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    const fakeProvider: ProviderAdapter = {
      id: "fake-provider",
      type: "custom",
      name: "Fake Provider",
      async listModels() {
        return ["fake-model"];
      },
      async validateCredentials() {
        return { ok: true };
      },
      async generateText() {
        return new Promise<never>(() => {
          // Simulates a provider request that never settles.
        });
      },
      async *stream() {
        yield "unused";
      },
    };
    const service = new CoordinatorChatService(dir, {
      config: defaultConfig("freelancer"),
      providerTimeoutMs: 5,
      providerSelector: async () => ({ provider: fakeProvider, model: "fake-model" }),
    });

    const result = await service.process({
      source: "test",
      message: "controlla provider e memoria",
    });

    expect(result.provider.status).toBe("failed");
    expect(result.provider.reason).toContain("timed out");
    expect(result.coordinatorMessage.text).toContain("memoria locale");
    expect(result.coordinatorMessage.text.toLowerCase()).not.toContain("coordinator working");
  });
});
