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
});
