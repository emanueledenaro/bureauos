import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderAdapter } from "@bureauos/providers";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/loader.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { ClientRegistry } from "../registries/client.js";
import { OpportunityRegistry } from "../registries/opportunity.js";
import { ProjectRegistry } from "../registries/project.js";
import { ArtifactStore } from "../artifacts/store.js";
import { CoordinatorChatService, type CoordinatorChatStreamEvent } from "./chat.js";
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

  it("saves client-only owner requests without inventing project scope", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    const service = new CoordinatorChatService(dir, { config: defaultConfig("freelancer") });

    const result = await service.process({
      source: "test",
      message: "abbiamo un cliente si chiama Pizzeria Amodeo lo puoi salvare?",
    });

    expect(result.mode).toBe("answer");
    expect(result.result).toBeUndefined();
    expect(result.provider.reason).toBe("client_only_save_fallback");
    expect(result.coordinatorMessage.meta?.tool).toMatchObject({
      name: "save_client",
      source: "safety_fallback",
    });
    expect(result.coordinatorMessage.meta?.planningProvider).toMatchObject({
      reason: "no_valid_provider_route",
    });
    expect(result.coordinatorMessage.text).toBe(
      "Ho salvato il cliente Pizzeria Amodeo. Non ho creato progetti, opportunità o approvazioni perché mi hai chiesto solo l'anagrafica cliente.",
    );

    const clients = await new ClientRegistry(dir).list();
    expect(clients.map((client) => client.name)).toEqual(["Pizzeria Amodeo"]);
    await expect(new ProjectRegistry(dir).list()).resolves.toEqual([]);
    await expect(new OpportunityRegistry(dir).list()).resolves.toEqual([]);
    await expect(new ApprovalRegistry(dir).listPending()).resolves.toEqual([]);
    await expect(new ArtifactStore(dir).list()).resolves.toEqual([]);
  });

  it("lets the provider choose the save_client tool before executing it", async () => {
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
          text: JSON.stringify({
            action: "save_client",
            clientName: "Pizzeria Amodeo",
            industry: "food_and_beverage",
            confidence: 0.94,
          }),
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
      message: "puoi registrare questo lead: Pizzeria Amodeo?",
    });

    expect(providerWasAsked).toBe(true);
    expect(result.provider.reason).toBe("coordinator_tool_plan");
    expect(result.coordinatorMessage.meta?.tool).toMatchObject({ name: "save_client" });
    expect(result.coordinatorMessage.text).toContain("Ho salvato il cliente Pizzeria Amodeo.");
    const clients = await new ClientRegistry(dir).list();
    expect(clients.map((client) => client.name)).toEqual(["Pizzeria Amodeo"]);
    await expect(new ProjectRegistry(dir).list()).resolves.toEqual([]);
    await expect(new OpportunityRegistry(dir).list()).resolves.toEqual([]);
  });

  it("lets the provider choose the list_clients tool before answering registry questions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    const clients = new ClientRegistry(dir);
    await clients.create({ name: "Pizzeria Amodeo" });
    await clients.create({ name: "Acme Labs" });
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
          text: JSON.stringify({
            action: "list_clients",
            confidence: 0.91,
          }),
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
      message: "quanti clienti abbiamo?",
    });

    expect(providerWasAsked).toBe(true);
    expect(result.provider.reason).toBe("coordinator_tool_plan");
    expect(result.coordinatorMessage.meta?.tool).toMatchObject({ name: "list_clients" });
    expect(result.coordinatorMessage.meta?.clients).toMatchObject({ count: 2 });
    expect(result.coordinatorMessage.text).toBe(
      "Abbiamo 2 clienti salvati: Acme Labs, Pizzeria Amodeo.",
    );
    await expect(new ProjectRegistry(dir).list()).resolves.toEqual([]);
    await expect(new OpportunityRegistry(dir).list()).resolves.toEqual([]);
    await expect(new ApprovalRegistry(dir).listPending()).resolves.toEqual([]);
  });

  it("answers obvious client registry questions from local tools when the provider is unavailable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    const clients = new ClientRegistry(dir);
    await clients.create({ name: "Pizzeria Amodeo" });
    await clients.create({ name: "BureauOS" });
    const service = new CoordinatorChatService(dir, { config: defaultConfig("freelancer") });

    const result = await service.process({
      source: "test",
      message: "quanti clienti abbiamo?",
    });

    expect(result.provider.reason).toBe("client_registry_fallback");
    expect(result.coordinatorMessage.meta?.planningProvider).toMatchObject({
      reason: "no_valid_provider_route",
    });
    expect(result.coordinatorMessage.meta?.tool).toMatchObject({
      name: "list_clients",
      source: "safety_fallback",
    });
    expect(result.coordinatorMessage.meta?.clients).toMatchObject({ count: 2 });
    expect(result.coordinatorMessage.text).toBe(
      "Abbiamo 2 clienti salvati: BureauOS, Pizzeria Amodeo.",
    );
    await expect(new ProjectRegistry(dir).list()).resolves.toEqual([]);
    await expect(new OpportunityRegistry(dir).list()).resolves.toEqual([]);
    await expect(new ApprovalRegistry(dir).listPending()).resolves.toEqual([]);
  });

  it("skips repeated slow tool-planning calls while a provider is degraded", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    const clients = new ClientRegistry(dir);
    await clients.create({ name: "Pizzeria Amodeo" });
    let generateCalls = 0;
    const fakeProvider: ProviderAdapter = {
      id: "degraded-tool-planner",
      type: "custom",
      name: "Degraded Tool Planner",
      async listModels() {
        return ["fake-model"];
      },
      async validateCredentials() {
        return { ok: true };
      },
      async generateText() {
        generateCalls += 1;
        return new Promise(() => {});
      },
      async *stream() {
        yield "unused";
      },
    };
    const deps = {
      config: defaultConfig("freelancer"),
      providerSelector: async () => ({ provider: fakeProvider, model: "fake-model" }),
      toolPlanningTimeoutMs: 1,
      toolPlanningDegradedTtlMs: 60_000,
    };

    const first = await new CoordinatorChatService(dir, deps).process({
      source: "test",
      message: "quanti clienti abbiamo?",
    });
    const second = await new CoordinatorChatService(dir, deps).process({
      source: "test",
      message: "quanti clienti abbiamo?",
    });

    expect(generateCalls).toBe(1);
    expect(first.coordinatorMessage.meta?.planningProvider).toMatchObject({
      reason: "provider tool planning timed out after 1ms",
    });
    expect(second.coordinatorMessage.meta?.planningProvider).toMatchObject({
      reason: expect.stringContaining("provider tool planning skipped while degraded"),
    });
    expect(second.coordinatorMessage.text).toBe("Abbiamo 1 cliente salvato: Pizzeria Amodeo.");
  });

  it("retries and clears degraded tool-planning state after the cooldown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    const clients = new ClientRegistry(dir);
    await clients.create({ name: "Pizzeria Amodeo" });
    let generateCalls = 0;
    let shouldHang = true;
    const fakeProvider: ProviderAdapter = {
      id: "recovering-tool-planner",
      type: "custom",
      name: "Recovering Tool Planner",
      async listModels() {
        return ["fake-model"];
      },
      async validateCredentials() {
        return { ok: true };
      },
      async generateText() {
        generateCalls += 1;
        if (shouldHang) return new Promise(() => {});
        return {
          model: "fake-model",
          text: JSON.stringify({ action: "list_clients", confidence: 0.88 }),
        };
      },
      async *stream() {
        yield "unused";
      },
    };
    const deps = {
      config: defaultConfig("freelancer"),
      providerSelector: async () => ({ provider: fakeProvider, model: "fake-model" }),
      toolPlanningTimeoutMs: 1,
      toolPlanningDegradedTtlMs: 1,
    };

    await new CoordinatorChatService(dir, deps).process({
      source: "test",
      message: "quanti clienti abbiamo?",
    });
    shouldHang = false;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const recovered = await new CoordinatorChatService(dir, deps).process({
      source: "test",
      message: "quanti clienti abbiamo?",
    });

    expect(generateCalls).toBe(2);
    expect(recovered.provider.reason).toBe("coordinator_tool_plan");
    expect(recovered.coordinatorMessage.meta?.tool).toMatchObject({
      name: "list_clients",
      confidence: 0.88,
    });
  });

  it("streams client-only saves as plain confirmations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    const service = new CoordinatorChatService(dir, { config: defaultConfig("freelancer") });

    const events: CoordinatorChatStreamEvent[] = [];
    for await (const event of service.stream({
      source: "test",
      message: "abbiamo un cliente si chiama Pizzeria Amodeo lo puoi salvare?",
    })) {
      events.push(event);
    }

    const final = events.find((event) => event.type === "final");
    const text = final?.type === "final" ? final.result.coordinatorMessage.text : "";
    expect(text).toContain("Ho salvato il cliente Pizzeria Amodeo.");
    expect(text).not.toContain("project");
    expect(text).not.toContain("opportunity");
    expect(text).not.toContain("artifacts");
    await expect(new ProjectRegistry(dir).list()).resolves.toEqual([]);
  });

  it("keeps full intake behavior when the owner includes project scope", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    const service = new CoordinatorChatService(dir, { config: defaultConfig("freelancer") });

    const result = await service.process({
      source: "test",
      message: "cliente si chiama Pizzeria Amodeo vuole un sito con prenotazioni e una proposta",
    });

    expect(result.mode).toBe("intake");
    expect(result.result?.client.name).toBe("Pizzeria Amodeo");
    expect(result.result?.project.name).toBe("Pizzeria Amodeo Booking Website");
    expect(result.result?.opportunity.title).toBe("Booking Website for Pizzeria Amodeo");
    expect(result.result?.artifacts.length).toBeGreaterThan(0);
    expect(result.result?.approvals.length).toBeGreaterThan(0);
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
    expect(result.coordinatorMessage.text).toBe("Ciao Emanuele, ci sono.");
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
    expect(result.coordinatorMessage.text).toBe("Ciao Emanuele, ci sono.");
    expect(result.coordinatorMessage.text.toLowerCase()).not.toContain("postura attiva");
    expect(result.coordinatorMessage.text.toLowerCase()).not.toContain("memoria storica");
    expect(result.coordinatorMessage.text.toLowerCase()).not.toContain("i need to");
    expect(result.coordinatorMessage.text.toLowerCase()).not.toContain("crafting");
  });

  it("answers low-context identity prompts without provider or fallback mechanics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    let providerWasAsked = false;
    const service = new CoordinatorChatService(dir, {
      config: defaultConfig("freelancer"),
      providerSelector: async () => {
        providerWasAsked = true;
        throw new Error("provider should not be asked for identity prompts");
      },
    });

    for (const message of ["chi sei?", "ciao chi sei?", "presentati"]) {
      const result = await service.process({ source: "test", message });

      expect(result.provider.reason).toBe("low_context_current_message");
      expect(result.coordinatorMessage.text).toBe(
        "Ciao Emanuele, sono il Supreme Coordinator di BureauOS. Tengo insieme clienti, progetti, consegne, priorita e rischi; quando mi dai un obiettivo operativo, lo trasformo in prossimi passi verificabili.",
      );
      expect(result.coordinatorMessage.text.toLowerCase()).not.toContain("provider");
      expect(result.coordinatorMessage.text.toLowerCase()).not.toContain("memoria locale");
      expect(result.coordinatorMessage.text.toLowerCase()).not.toContain("fallback");
    }

    expect(providerWasAsked).toBe(false);
  });

  it("streams low-context identity answers directly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    const service = new CoordinatorChatService(dir, {
      config: defaultConfig("freelancer"),
      providerSelector: async () => {
        throw new Error("provider should not be asked for identity prompts");
      },
    });

    const events: CoordinatorChatStreamEvent[] = [];
    for await (const event of service.stream({ source: "test", message: "ciao chi sei?" })) {
      events.push(event);
    }

    const final = events.find((event) => event.type === "final");
    const text = final?.type === "final" ? final.result.coordinatorMessage.text.toLowerCase() : "";
    expect(text).toContain("supreme coordinator di bureauos");
    expect(text).not.toContain("provider");
    expect(text).not.toContain("memoria locale");
    expect(text).not.toContain("fallback");
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

  it("streams sanitized provider answers and persists the final message once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    let generateTextWasCalled = false;
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
        generateTextWasCalled = true;
        return { model: "fake-model", text: "unused" };
      },
      async *stream() {
        yield "Analysis:\nI need to think.\n\n";
        yield "Final answer:\nOk, controllo lo stato operativo.";
      },
    };
    const messages = new CoordinatorMessageStore(dir);
    const service = new CoordinatorChatService(dir, {
      config: defaultConfig("freelancer"),
      messages,
      providerSelector: async () => ({ provider: fakeProvider, model: "fake-model" }),
    });

    const events: CoordinatorChatStreamEvent[] = [];
    for await (const event of service.stream({
      source: "test",
      message: "controlla provider e memoria",
    })) {
      events.push(event);
    }

    const deltas = events.filter((event) => event.type === "delta").map((event) => event.text);
    const final = events.find((event) => event.type === "final");
    expect(generateTextWasCalled).toBe(false);
    expect(deltas.join("")).toBe("Ok, controllo lo stato operativo.");
    expect(JSON.stringify(events).toLowerCase()).not.toContain("i need to");
    expect(final?.type === "final" ? final.result.provider.status : undefined).toBe("used");
    const history = await messages.list();
    expect(history.map((message) => message.role)).toEqual(["owner", "coordinator"]);
    expect(history[1]?.text).toBe("Ok, controllo lo stato operativo.");
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
