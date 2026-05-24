import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ProviderType } from "./types.js";

export interface ProviderCredentialInput {
  provider: ProviderType;
  id?: string;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}

export interface ProviderCredentialRecord {
  provider: ProviderType;
  id: string;
  apiKey: string;
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
    if (!input.apiKey?.trim() && !input.baseUrl?.trim()) {
      throw new Error("provider auth requires --api-key or --base-url");
    }
    const file = await this.load();
    const now = new Date().toISOString();
    const existing = file.credentials.find(
      (record) => record.provider === input.provider && record.id === id,
    );
    const record: ProviderCredentialRecord = {
      provider: input.provider,
      id,
      apiKey: input.apiKey?.trim() ?? existing?.apiKey ?? "",
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
        credentials: Array.isArray(parsed.credentials) ? parsed.credentials : [],
      };
    } catch {
      return emptyAuthFile();
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
