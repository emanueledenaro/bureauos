import { describe, expect, it } from "vitest";
import { ProviderRouter, type ProviderAdapter, type ValidationResult } from "@bureauos/providers";
import { defaultConfig } from "../config/loader.js";
import { AGENT_INDEX } from "./roles.js";
import {
  configureAgentProviderRouting,
  providerChainForRole,
  selectAgentModel,
} from "./provider-routing.js";

class FakeProvider implements ProviderAdapter {
  public readonly name: string;
  public readonly defaultModel = "test-model";

  constructor(
    public readonly id: string,
    public readonly type: ProviderAdapter["type"],
    private readonly validation: ValidationResult,
  ) {
    this.name = id;
  }

  async listModels(): Promise<readonly string[]> {
    return ["test-model"];
  }

  async validateCredentials(): Promise<ValidationResult> {
    return this.validation;
  }

  async generateText(): Promise<never> {
    throw new Error("not used");
  }

  async *stream(): AsyncIterable<string> {
    yield "";
  }
}

describe("agent provider routing", () => {
  it("keeps OpenAI Codex OAuth separate from the OpenAI API provider", () => {
    const config = defaultConfig("freelancer");
    config.supreme_coordinator.provider = "openai-codex";
    const product = AGENT_INDEX.get("product");
    expect(product).toBeDefined();

    expect(providerChainForRole(config, product!)).toEqual(["openai-codex-default"]);
  });

  it("uses OpenAI API only when the owner explicitly chooses it", () => {
    const config = defaultConfig("freelancer");
    config.supreme_coordinator.provider = "openai";
    const product = AGENT_INDEX.get("product");
    expect(product).toBeDefined();

    expect(providerChainForRole(config, product!)).toEqual(["openai-default"]);
  });

  it("uses the selected provider default when only the provider changes", async () => {
    const config = defaultConfig("freelancer");
    config.supreme_coordinator.provider = "openai";
    const router = new ProviderRouter();
    router.register(new FakeProvider("openai-default", "openai", { ok: true }), {
      model: "gpt-5.5",
      capabilities: ["chat", "reasoning", "coding"],
      budgetTier: "premium",
    });

    configureAgentProviderRouting(router, config, ["product"]);

    const selected = await selectAgentModel(router, config, "product");

    expect(selected?.provider.id).toBe("openai-default");
    expect(selected?.model).toBe("gpt-5.5");
  });

  it("maps the Codex runtime preference to the Codex OAuth route without API fallback", () => {
    const config = defaultConfig("freelancer");
    config.supreme_coordinator.provider = "codex";
    const product = AGENT_INDEX.get("product");
    expect(product).toBeDefined();

    expect(providerChainForRole(config, product!)).toEqual(["openai-codex-default"]);
  });

  it("does not select the OpenAI API provider when the Codex OAuth route is unavailable", async () => {
    const config = defaultConfig("freelancer");
    config.supreme_coordinator.provider = "openai-codex";
    const router = new ProviderRouter();
    router.register(
      new FakeProvider("openai-codex-default", "openai-codex", {
        ok: false,
        reason: "OAuth token is missing",
      }),
    );
    router.register(new FakeProvider("openai-default", "openai", { ok: true }));

    configureAgentProviderRouting(router, config, ["product"]);

    await expect(selectAgentModel(router, config, "product")).resolves.toBeUndefined();
  });

  it("applies per-agent capability and budget criteria during model selection", async () => {
    const config = defaultConfig("freelancer");
    config.agents.development = {
      provider: "local",
      model: "local-model",
      capabilities: [],
      required_model_capabilities: [],
      max_budget_tier: "low",
      prefer_low_cost: true,
    };
    const router = new ProviderRouter();
    router.register(new FakeProvider("local-default", "local", { ok: true }), {
      model: "local-model",
      capabilities: ["chat", "coding", "low-cost"],
      budgetTier: "free",
    });

    configureAgentProviderRouting(router, config, ["development"]);

    const selected = await selectAgentModel(router, config, "development");

    expect(selected?.provider.id).toBe("local-default");
    expect(selected?.model).toBe("local-model");
  });

  it("returns no model when the chosen provider exceeds the agent budget cap", async () => {
    const config = defaultConfig("freelancer");
    config.agents.pricing = {
      provider: "anthropic",
      model: "claude-opus-4-7",
      capabilities: [],
      required_model_capabilities: [],
      max_budget_tier: "standard",
      prefer_low_cost: false,
    };
    const router = new ProviderRouter();
    router.register(new FakeProvider("anthropic-default", "anthropic", { ok: true }), {
      model: "claude-opus-4-7",
      capabilities: ["chat", "reasoning"],
      budgetTier: "premium",
    });

    configureAgentProviderRouting(router, config, ["pricing"]);

    await expect(selectAgentModel(router, config, "pricing")).resolves.toBeUndefined();
  });

  it("evaluates the role-selected model metadata instead of the provider default", async () => {
    const config = defaultConfig("freelancer");
    config.agents.content = {
      provider: "openai",
      model: "gpt-5.4-nano",
      capabilities: [],
      required_model_capabilities: ["chat"],
      max_budget_tier: "low",
      prefer_low_cost: true,
    };
    const router = new ProviderRouter();
    router.register(new FakeProvider("openai-default", "openai", { ok: true }), {
      model: "gpt-5.5",
      capabilities: ["chat", "reasoning", "coding"],
      budgetTier: "high",
    });

    configureAgentProviderRouting(router, config, ["content"]);

    const selected = await selectAgentModel(router, config, "content");

    expect(selected?.provider.id).toBe("openai-default");
    expect(selected?.model).toBe("gpt-5.4-nano");
  });
});
