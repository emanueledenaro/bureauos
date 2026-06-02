import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderAdapter } from "@bureauos/providers";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/loader.js";
import { workspacePaths } from "../paths.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { ClientRegistry } from "../registries/client.js";
import { OpportunityRegistry } from "../registries/opportunity.js";
import { ProjectRegistry } from "../registries/project.js";
import { ArtifactStore } from "../artifacts/store.js";
import { CoordinatorChatService, type CoordinatorChatStreamEvent } from "./chat.js";
import { CoordinatorMessageStore } from "./messages.js";

async function auditText(workspaceRoot: string): Promise<string> {
  return readFile(workspacePaths(workspaceRoot).auditLog, "utf8");
}

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
    expect(result.coordinatorMessage.text).toBe("Ho salvato il cliente Pizzeria Amodeo.");
    expect(result.coordinatorMessage.text).not.toContain("Non ho creato");

    const clients = await new ClientRegistry(dir).list();
    expect(clients.map((client) => client.name)).toEqual(["Pizzeria Amodeo"]);
    await expect(auditText(dir)).resolves.toContain("coordinator_tool.save_client");
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
    expect(result.coordinatorMessage.meta?.tool).toMatchObject({
      name: "save_client",
      source: "provider_plan",
    });
    expect(result.coordinatorMessage.text).toContain("Ho salvato il cliente Pizzeria Amodeo.");
    const clients = await new ClientRegistry(dir).list();
    expect(clients.map((client) => client.name)).toEqual(["Pizzeria Amodeo"]);
    await expect(auditText(dir)).resolves.toContain("coordinator_tool.save_client");
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
    expect(result.coordinatorMessage.meta?.tool).toMatchObject({
      name: "list_clients",
      source: "provider_plan",
    });
    expect(result.coordinatorMessage.meta?.clients).toMatchObject({ count: 2 });
    expect(result.coordinatorMessage.text).toBe(
      "Abbiamo 2 clienti salvati: Acme Labs, Pizzeria Amodeo.",
    );
    await expect(auditText(dir)).resolves.toContain("coordinator_tool.list_clients");
    await expect(new ProjectRegistry(dir).list()).resolves.toEqual([]);
    await expect(new OpportunityRegistry(dir).list()).resolves.toEqual([]);
    await expect(new ApprovalRegistry(dir).listPending()).resolves.toEqual([]);
  });

  it("rejects unsupported provider-selected tools without executing mutations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    await new ClientRegistry(dir).create({ name: "Pizzeria Amodeo" });
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
          text: JSON.stringify({
            action: "wire_money",
            clientName: "Pizzeria Amodeo",
            confidence: 0.99,
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
      message: "manda un bonifico al cliente Pizzeria Amodeo",
    });

    expect(result.mode).toBe("answer");
    expect(result.coordinatorMessage.meta?.tool).toMatchObject({
      status: "rejected",
      allowed: ["save_client", "create_intake", "list_clients", "delete_client", "answer"],
    });
    expect(result.coordinatorMessage.text).toContain("Non ho eseguito azioni");
    await expect(new ClientRegistry(dir).list()).resolves.toHaveLength(1);
    await expect(auditText(dir)).resolves.toContain("coordinator.tool.rejected");
  });

  it("does not delete a client from the free chat flow even when the provider proposes delete_client", async () => {
    // Safety property: delete_client is a real executive tool, but the chat
    // free-flow never auto-routes a destructive deletion. A provider plan that
    // chooses delete_client is refused here; deletion only happens through the
    // explicit, confirmation-gated executeDeleteClient runtime path.
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    await new ClientRegistry(dir).create({ name: "Pizzeria Amodeo" });
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
          text: JSON.stringify({
            action: "delete_client",
            clientName: "Pizzeria Amodeo",
            confirmed: true,
            confidence: 0.99,
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
      message: "cancella il cliente Pizzeria Amodeo",
    });

    expect(result.mode).toBe("answer");
    // Nothing was deleted: the client is still present and no executed-delete
    // audit event was written from the chat flow.
    await expect(new ClientRegistry(dir).list()).resolves.toHaveLength(1);
    await expect(auditText(dir)).resolves.not.toContain("coordinator_tool.delete_client");
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
    await expect(auditText(dir)).resolves.toContain("coordinator_tool.list_clients");
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
    expect(result.result?.approvals).toEqual([]);
    await expect(new ApprovalRegistry(dir).listPending()).resolves.toEqual([]);
    expect(result.coordinatorMessage.meta?.tool).toMatchObject({
      name: "create_intake",
      source: "safety_fallback",
    });
    await expect(auditText(dir)).resolves.toContain("coordinator_tool.create_intake");
  });

  it("answers existing project status questions without creating new intake records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    const clients = new ClientRegistry(dir);
    const projects = new ProjectRegistry(dir);
    const opportunities = new OpportunityRegistry(dir);
    const approvals = new ApprovalRegistry(dir);
    const artifacts = new ArtifactStore(dir);
    const client = await clients.create({ name: "Pizzeria Amodeo" });
    const project = await projects.create({
      name: "Pizzeria Amodeo Website",
      clientId: client.id,
      status: "intake",
      stack: "HTML CSS",
    });
    const opportunity = await opportunities.create({
      title: "Website for Pizzeria Amodeo",
      source: "owner_chat",
      clientId: client.id,
    });
    await artifacts.write({
      type: "project-brief",
      createdBy: "supreme_coordinator",
      clientId: client.id,
      projectId: project.id,
      body: "Draft landing page for pizza Margherita.",
    });
    await approvals.request({
      action: "send_final_proposals",
      actor: "supreme_coordinator",
      target: opportunity.id,
      scope: "Send final proposal for Website for Pizzeria Amodeo",
      riskLevel: "high",
    });
    const service = new CoordinatorChatService(dir, { config: defaultConfig("freelancer") });

    const result = await service.process({
      source: "test",
      message: "il sito di amodeo che ho richiesto?",
    });

    expect(result.mode).toBe("answer");
    expect(result.result).toBeUndefined();
    expect(result.provider.reason).toBe("project_status_lookup");
    expect(result.coordinatorMessage.text).toContain("Pizzeria Amodeo Website");
    expect(result.coordinatorMessage.text).toContain("Website for Pizzeria Amodeo");
    expect(result.coordinatorMessage.text).toContain("1 approvazioni pending");
    expect(result.coordinatorMessage.text).not.toContain("Non ho creato");
    expect(result.coordinatorMessage.text).not.toContain("ho solo letto");
    expect(result.coordinatorMessage.meta?.statusLookup).toMatchObject({
      clientId: client.id,
      projectId: project.id,
      opportunityId: opportunity.id,
      pendingApprovals: 1,
      artifacts: 1,
    });
    await expect(clients.list()).resolves.toHaveLength(1);
    await expect(projects.list()).resolves.toHaveLength(1);
    await expect(opportunities.list()).resolves.toHaveLength(1);
    await expect(approvals.listPending()).resolves.toHaveLength(1);
    await expect(auditText(dir)).resolves.toContain("coordinator.status_lookup");
    await expect(auditText(dir)).resolves.not.toContain("coordinator_tool.create_intake");
  });

  it("asks for clarification instead of creating fallback leads for unmatched status questions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    const service = new CoordinatorChatService(dir, { config: defaultConfig("freelancer") });

    const result = await service.process({
      source: "test",
      message: "il sito di amodeo che ho richiesto?",
    });

    expect(result.mode).toBe("answer");
    expect(result.result).toBeUndefined();
    expect(result.provider.reason).toBe("project_status_lookup_no_match");
    expect(result.coordinatorMessage.text).toContain("Non trovo un lavoro salvato");
    expect(result.coordinatorMessage.text).toContain("ti do lo stato operativo");
    expect(result.coordinatorMessage.text).not.toContain("Non ho creato");
    await expect(new ClientRegistry(dir).list()).resolves.toEqual([]);
    await expect(new ProjectRegistry(dir).list()).resolves.toEqual([]);
    await expect(new OpportunityRegistry(dir).list()).resolves.toEqual([]);
    await expect(new ApprovalRegistry(dir).listPending()).resolves.toEqual([]);
    await expect(auditText(dir)).resolves.toContain("coordinator.status_lookup");
    await expect(auditText(dir)).resolves.not.toContain("coordinator_tool.create_intake");
  });

  it("answers generic company status questions from BOS registries without creating intake", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    const clients = new ClientRegistry(dir);
    const projects = new ProjectRegistry(dir);
    const opportunities = new OpportunityRegistry(dir);
    const approvals = new ApprovalRegistry(dir);
    const client = await clients.create({ name: "Pizzeria Amodeo" });
    await projects.create({
      name: "Pizzeria Amodeo Website",
      clientId: client.id,
      status: "intake",
      stack: "HTML CSS",
    });
    const opportunity = await opportunities.create({
      title: "Website for Pizzeria Amodeo",
      source: "owner_chat",
      clientId: client.id,
      expectedValue: 4_500,
    });
    await approvals.request({
      action: "send_final_proposals",
      actor: "supreme_coordinator",
      target: opportunity.id,
      scope: "Send final proposal for Website for Pizzeria Amodeo",
      riskLevel: "high",
    });
    const service = new CoordinatorChatService(dir, { config: defaultConfig("freelancer") });

    const result = await service.process({
      source: "test",
      message: "come siamo messi?",
    });

    expect(result.mode).toBe("answer");
    expect(result.result).toBeUndefined();
    expect(result.provider.reason).toBe("company_status_lookup");
    expect(result.coordinatorMessage.text).toContain("1 clienti attivi/lead");
    expect(result.coordinatorMessage.text).toContain("1 progetti aperti");
    expect(result.coordinatorMessage.text).toContain("1 opportunità aperte");
    expect(result.coordinatorMessage.text).toContain("€4.500");
    expect(result.coordinatorMessage.text).toContain("1 decisioni owner pending");
    expect(result.coordinatorMessage.text).toContain("Prossima mossa");
    expect(result.coordinatorMessage.text).not.toContain("Non trovo un lavoro salvato");
    expect(result.coordinatorMessage.text).not.toContain("Non ho creato");
    expect(result.coordinatorMessage.meta?.companyStatus).toMatchObject({
      clients: 1,
      projects: 1,
      opportunities: 1,
      approvals: 1,
    });
    await expect(clients.list()).resolves.toHaveLength(1);
    await expect(projects.list()).resolves.toHaveLength(1);
    await expect(opportunities.list()).resolves.toHaveLength(1);
    await expect(approvals.listPending()).resolves.toHaveLength(1);
    await expect(auditText(dir)).resolves.toContain("coordinator.company_status_lookup");
    await expect(auditText(dir)).resolves.not.toContain("coordinator_tool.create_intake");
  });

  it("lets the provider choose the create_intake tool before opening project scope", async () => {
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
            action: "create_intake",
            clientName: "Pizzeria Amodeo",
            confidence: 0.93,
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
      message: "Pizzeria Amodeo vuole un sito con prenotazioni e una proposta",
    });

    expect(providerWasAsked).toBe(true);
    expect(result.mode).toBe("intake");
    expect(result.provider.reason).toBe("coordinator_tool_plan");
    expect(result.coordinatorMessage.meta?.tool).toMatchObject({
      name: "create_intake",
      source: "provider_plan",
    });
    expect(result.result?.client.name).toBe("Pizzeria Amodeo");
    await expect(auditText(dir)).resolves.toContain("coordinator_tool.create_intake");
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
    expect(result.coordinatorMessage.text).toBe(
      "Ciao! Sono operativo — dimmi da dove partiamo: priorità di oggi, un cliente o una proposta.",
    );
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
    expect(result.coordinatorMessage.text).toBe(
      "Tutto operativo da questa parte. Su cosa vuoi che mi concentri?",
    );
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
        "Sono il Supreme Coordinator di BureauOS: tengo insieme clienti, progetti, consegne, priorità e rischi, e trasformo i tuoi obiettivi in prossimi passi verificabili.",
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

  it("strips defensive no-mutation filler from provider answers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    const messages = new CoordinatorMessageStore(dir);
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
            "Non ho creato nuovi clienti, progetti o opportunita: ho solo letto lo stato esistente.",
            "Pizzeria Amodeo Website e in intake.",
            "Prossima mossa: preparo lo scope operativo.",
          ].join("\n"),
        };
      },
      async *stream() {
        yield "unused";
      },
    };
    const service = new CoordinatorChatService(dir, {
      config: defaultConfig("freelancer"),
      messages,
      providerSelector: async () => ({ provider: fakeProvider, model: "fake-model" }),
    });

    const result = await service.process({
      source: "test",
      message: "controlla provider e memoria",
    });

    expect(result.provider.status).toBe("used");
    expect(result.coordinatorMessage.text).toBe(
      "Pizzeria Amodeo Website e in intake.\nProssima mossa: preparo lo scope operativo.",
    );
    expect(result.coordinatorMessage.text).not.toContain("Non ho creato");
    expect(result.coordinatorMessage.text).not.toContain("ho solo letto");
    const history = await messages.list();
    expect(history.at(-1)?.text).toBe(result.coordinatorMessage.text);
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

  it("emits live reasoning events during a streamed answer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    const service = new CoordinatorChatService(dir, { config: defaultConfig("freelancer") });

    const events: CoordinatorChatStreamEvent[] = [];
    for await (const event of service.stream({ message: "What's our operating focus today?" })) {
      events.push(event);
    }

    const reasoning = events
      .filter((e) => e.type === "reasoning")
      .map((e) => (e.type === "reasoning" ? e.text : ""));
    expect(reasoning[0]).toBe("Reading company context");
    expect(reasoning).toContain("Drafting the reply");
    // reasoning must precede the final event
    const finalIdx = events.findIndex((e) => e.type === "final");
    const firstReasoningIdx = events.findIndex((e) => e.type === "reasoning");
    expect(firstReasoningIdx).toBeLessThan(finalIdx);
  });

  it("emits delegation/run_status/artifact events for an intake turn", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-chat-"));
    const service = new CoordinatorChatService(dir, { config: defaultConfig("freelancer") });

    const events: CoordinatorChatStreamEvent[] = [];
    // Use a message that triggers intake mode (hasIntakeIntent returns true)
    for await (const event of service.stream({
      message: "Il cliente Acme vuole un nuovo sito web",
    })) {
      events.push(event);
    }

    const final = events.find((e) => e.type === "final");
    if (final?.type === "final" && final.result.result) {
      expect(events.some((e) => e.type === "delegation")).toBe(true);
      expect(events.some((e) => e.type === "run_status")).toBe(true);
      // every delegation/run_status/artifact event precedes final
      const finalIdx = events.findIndex((e) => e.type === "final");
      for (const e of events.filter((x) =>
        ["delegation", "run_status", "artifact"].includes(x.type),
      )) {
        expect(events.indexOf(e)).toBeLessThan(finalIdx);
      }
    }
  });
});
