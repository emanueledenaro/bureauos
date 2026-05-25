import { describe, expect, it } from "vitest";
import { ProviderRouter } from "./router.js";
import type {
  GenerateTextOptions,
  GenerateTextResult,
  ProviderAdapter,
  ProviderType,
  ValidationResult,
} from "./types.js";

class FakeProvider implements ProviderAdapter {
  public readonly name: string;

  constructor(
    public readonly id: string,
    public readonly type: ProviderType,
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

  async generateText(_options: GenerateTextOptions): Promise<GenerateTextResult> {
    return { text: "", model: "test-model" };
  }

  async *stream(_options: GenerateTextOptions): AsyncIterable<string> {
    yield "";
  }
}

describe("ProviderRouter", () => {
  it("does not fall back from OpenAI Codex OAuth to the OpenAI API provider", async () => {
    const router = new ProviderRouter();
    router.register(
      new FakeProvider("openai-codex-default", "openai-codex", {
        ok: false,
        reason: "OAuth token is missing",
      }),
    );
    router.register(new FakeProvider("openai-default", "openai", { ok: true }));
    router.assign("product", ["openai-codex-default", "openai-default"]);

    await expect(router.selectForAgent("product")).resolves.toBeUndefined();
  });

  it("selects the first explicit provider route that satisfies required capabilities", async () => {
    const router = new ProviderRouter();
    router.register(new FakeProvider("fast", "openai", { ok: true }), {
      capabilities: ["chat", "low-cost"],
      budgetTier: "low",
    });
    router.register(new FakeProvider("reasoning", "anthropic", { ok: true }), {
      capabilities: ["chat", "reasoning"],
      budgetTier: "high",
    });
    router.assign("security", ["fast", "reasoning"]);

    const selected = await router.selectForAgent("security", {
      requiredCapabilities: ["reasoning"],
    });

    expect(selected?.adapter.id).toBe("reasoning");
  });

  it("rejects routes above the owner-configured budget tier", async () => {
    const router = new ProviderRouter();
    router.register(new FakeProvider("premium", "anthropic", { ok: true }), {
      capabilities: ["chat", "reasoning"],
      budgetTier: "premium",
    });
    router.assign("product", ["premium"]);

    await expect(
      router.selectForAgent("product", {
        requiredCapabilities: ["chat"],
        maxBudgetTier: "standard",
      }),
    ).resolves.toBeUndefined();
  });

  it("can prefer lower-cost routes inside an explicit owner-approved chain", async () => {
    const router = new ProviderRouter();
    router.register(new FakeProvider("high", "openai", { ok: true }), {
      capabilities: ["chat"],
      budgetTier: "high",
    });
    router.register(new FakeProvider("low", "local", { ok: true }), {
      capabilities: ["chat"],
      budgetTier: "free",
    });
    router.assign("content", ["high", "low"]);

    const selected = await router.selectForAgent("content", {
      requiredCapabilities: ["chat"],
      preferLowCost: true,
    });

    expect(selected?.adapter.id).toBe("low");
  });

  it("still keeps OpenAI API out of a Codex OAuth route when criteria reject Codex", async () => {
    const router = new ProviderRouter();
    router.register(new FakeProvider("openai-codex-default", "openai-codex", { ok: true }), {
      capabilities: ["chat", "oauth"],
      budgetTier: "standard",
    });
    router.register(new FakeProvider("openai-default", "openai", { ok: true }), {
      capabilities: ["chat", "vision"],
      budgetTier: "high",
    });
    router.assign("creative", ["openai-codex-default", "openai-default"]);

    await expect(
      router.selectForAgent("creative", { requiredCapabilities: ["vision"] }),
    ).resolves.toBeUndefined();
  });

  it("uses route-specific profile overrides for model-level budget checks", async () => {
    const router = new ProviderRouter();
    router.register(new FakeProvider("openai-default", "openai", { ok: true }), {
      model: "gpt-5",
      capabilities: ["chat", "reasoning"],
      budgetTier: "high",
    });
    router.assign("social", ["openai-default"]);

    const selected = await router.selectForAgent("social", {
      requiredCapabilities: ["chat"],
      maxBudgetTier: "low",
      routeProfiles: {
        "openai-default": {
          model: "gpt-4o-mini",
          capabilities: ["chat", "low-cost"],
          budgetTier: "low",
        },
      },
    });

    expect(selected?.profile).toMatchObject({
      model: "gpt-4o-mini",
      budgetTier: "low",
    });
  });
});
