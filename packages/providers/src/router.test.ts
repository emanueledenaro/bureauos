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
});
