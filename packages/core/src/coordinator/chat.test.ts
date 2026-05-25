import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/loader.js";
import { ClientRegistry } from "../registries/client.js";
import { CoordinatorChatService } from "./chat.js";

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
});
