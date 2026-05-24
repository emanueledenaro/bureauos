import type {
  GenerateTextOptions,
  GenerateTextResult,
  ProviderAdapter,
  ValidationResult,
} from "../types.js";

export class OAuthBridgeNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthBridgeNotConfiguredError";
  }
}

export interface OpenAICodexOAuthOptions {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  defaultModel?: string;
}

/**
 * OpenAI Codex OAuth provider.
 *
 * This is intentionally separate from the OpenAI API-key adapter. It never
 * falls back to `OPENAI_API_KEY`; if the OAuth route cannot run, callers must
 * either stop or produce an explicitly marked deterministic local draft.
 */
export class OpenAICodexOAuthAdapter implements ProviderAdapter {
  public readonly id: string;
  public readonly type = "openai-codex" as const;
  public readonly name = "OpenAI Codex OAuth";
  public readonly defaultModel?: string;

  constructor(
    id: string,
    private readonly options: OpenAICodexOAuthOptions = {},
  ) {
    this.id = id;
    this.defaultModel = options.defaultModel;
  }

  async listModels(): Promise<readonly string[]> {
    return [this.defaultModel ?? "gpt-5"];
  }

  async validateCredentials(): Promise<ValidationResult> {
    if (!this.options.accessToken && !this.options.refreshToken) {
      return { ok: false, reason: "OpenAI Codex OAuth token is not connected" };
    }
    return { ok: true };
  }

  async generateText(_options: GenerateTextOptions): Promise<GenerateTextResult> {
    throw new OAuthBridgeNotConfiguredError(
      "OpenAI Codex OAuth route is separate from OpenAI API keys and is not bridged yet",
    );
  }

  async *stream(_options: GenerateTextOptions): AsyncIterable<string> {
    throw new OAuthBridgeNotConfiguredError(
      "OpenAI Codex OAuth route is separate from OpenAI API keys and is not bridged yet",
    );
  }
}
