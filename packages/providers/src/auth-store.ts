import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ProviderType } from "./types.js";

export type ProviderAuthMode = "oauth" | "api-key" | "local";

export interface ProviderCredentialInput {
  provider: ProviderType;
  id?: string;
  mode?: ProviderAuthMode;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  baseUrl?: string;
  defaultModel?: string;
}

export interface ProviderCredentialRecord {
  provider: ProviderType;
  id: string;
  mode: ProviderAuthMode;
  apiKey: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  baseUrl: string;
  defaultModel: string;
  created: string;
  updated: string;
}

interface ProviderAuthFile {
  version: 1;
  credentials: ProviderCredentialRecord[];
}

function defaultProviderId(provider: ProviderType): string {
  return `${provider}-default`;
}

function defaultAuthMode(provider: ProviderType): ProviderAuthMode {
  if (provider === "openai-codex") return "oauth";
  if (provider === "local") return "local";
  return "api-key";
}

function isAuthMode(value: unknown): value is ProviderAuthMode {
  return value === "oauth" || value === "api-key" || value === "local";
}

function emptyAuthFile(): ProviderAuthFile {
  return { version: 1, credentials: [] };
}

export function providerAuthPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".bureauos", "auth", "providers.json");
}

export function maskSecret(secret: string): string {
  if (!secret) return "";
  if (secret.length <= 8) return "********";
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

export class ProviderAuthStore {
  constructor(public readonly file: string) {}

  static forWorkspace(workspaceRoot: string): ProviderAuthStore {
    return new ProviderAuthStore(providerAuthPath(workspaceRoot));
  }

  async list(): Promise<ProviderCredentialRecord[]> {
    return (await this.load()).credentials;
  }

  async get(
    provider: ProviderType,
    id = defaultProviderId(provider),
  ): Promise<ProviderCredentialRecord | undefined> {
    const file = await this.load();
    return file.credentials.find((record) => record.provider === provider && record.id === id);
  }

  async upsert(input: ProviderCredentialInput): Promise<ProviderCredentialRecord> {
    const id = input.id?.trim() || defaultProviderId(input.provider);
    const file = await this.load();
    const now = new Date().toISOString();
    const existing = file.credentials.find(
      (record) => record.provider === input.provider && record.id === id,
    );
    const mode = this.resolveMode(input, existing);
    this.validateMode(input.provider, mode, input, existing);
    const record: ProviderCredentialRecord = {
      provider: input.provider,
      id,
      mode,
      apiKey: input.apiKey?.trim() ?? existing?.apiKey ?? "",
      accessToken: input.accessToken?.trim() ?? existing?.accessToken ?? "",
      refreshToken: input.refreshToken?.trim() ?? existing?.refreshToken ?? "",
      expiresAt: input.expiresAt?.trim() ?? existing?.expiresAt ?? "",
      baseUrl: input.baseUrl?.trim() ?? existing?.baseUrl ?? "",
      defaultModel: input.defaultModel?.trim() ?? existing?.defaultModel ?? "",
      created: existing?.created ?? now,
      updated: now,
    };
    const nextCredentials = existing
      ? file.credentials.map((item) =>
          item.provider === input.provider && item.id === id ? record : item,
        )
      : [...file.credentials, record];
    await this.save({ version: 1, credentials: nextCredentials });
    return record;
  }

  async remove(provider: ProviderType, id = defaultProviderId(provider)): Promise<boolean> {
    const file = await this.load();
    const nextCredentials = file.credentials.filter(
      (record) => !(record.provider === provider && record.id === id),
    );
    if (nextCredentials.length === file.credentials.length) return false;
    if (nextCredentials.length === 0) {
      await rm(this.file, { force: true });
      return true;
    }
    await this.save({ version: 1, credentials: nextCredentials });
    return true;
  }

  private async load(): Promise<ProviderAuthFile> {
    try {
      const raw = await readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as ProviderAuthFile;
      return {
        version: 1,
        credentials: Array.isArray(parsed.credentials)
          ? parsed.credentials.map((record) => this.normalize(record))
          : [],
      };
    } catch {
      return emptyAuthFile();
    }
  }

  private normalize(record: Partial<ProviderCredentialRecord>): ProviderCredentialRecord {
    const provider = record.provider ?? "custom";
    const now = new Date().toISOString();
    return {
      provider,
      id: record.id ?? defaultProviderId(provider),
      mode: record.mode ?? defaultAuthMode(provider),
      apiKey: record.apiKey ?? "",
      accessToken: record.accessToken ?? "",
      refreshToken: record.refreshToken ?? "",
      expiresAt: record.expiresAt ?? "",
      baseUrl: record.baseUrl ?? "",
      defaultModel: record.defaultModel ?? "",
      created: record.created ?? now,
      updated: record.updated ?? now,
    };
  }

  private resolveMode(
    input: ProviderCredentialInput,
    existing?: ProviderCredentialRecord,
  ): ProviderAuthMode {
    if (input.provider === "openai-codex") return "oauth";
    if (input.provider === "local") return "local";
    if (input.mode) {
      if (!isAuthMode(input.mode)) throw new Error(`unknown provider auth mode: ${input.mode}`);
      return input.mode;
    }
    return existing?.mode ?? defaultAuthMode(input.provider);
  }

  private validateMode(
    provider: ProviderType,
    mode: ProviderAuthMode,
    input: ProviderCredentialInput,
    existing?: ProviderCredentialRecord,
  ): void {
    if (provider === "openai-codex" && mode !== "oauth") {
      throw new Error("openai-codex only supports OAuth auth");
    }
    if (provider === "openai" && mode === "oauth") {
      throw new Error("OpenAI OAuth must use --provider openai-codex");
    }
    if (mode === "oauth") {
      const hasToken =
        Boolean(input.accessToken?.trim()) ||
        Boolean(input.refreshToken?.trim()) ||
        Boolean(existing?.accessToken) ||
        Boolean(existing?.refreshToken);
      if (!hasToken)
        throw new Error("OAuth provider auth requires --access-token or --refresh-token");
      return;
    }
    if (mode === "local") {
      const hasBaseUrl = Boolean(input.baseUrl?.trim()) || Boolean(existing?.baseUrl);
      if (!hasBaseUrl) throw new Error("local provider auth requires --base-url");
      return;
    }
    const hasApiKey = Boolean(input.apiKey?.trim()) || Boolean(existing?.apiKey);
    const hasBaseUrl = Boolean(input.baseUrl?.trim()) || Boolean(existing?.baseUrl);
    if (!hasApiKey && !hasBaseUrl) {
      throw new Error("API-key provider auth requires --api-key or --base-url");
    }
  }

  private async save(file: ProviderAuthFile): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(file, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(this.file, 0o600);
  }
}
