export interface SemanticMemoryHit {
  path: string;
  snippet: string;
  score: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface SemanticMemoryDocument {
  path: string;
  body: string;
  title?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface SemanticMemorySearchOptions {
  limit?: number;
  minScore?: number;
  paths?: readonly string[];
}

export interface SemanticMemoryIndex {
  readonly kind: string;
  readonly enabled: boolean;
  search(query: string, options?: SemanticMemorySearchOptions): Promise<SemanticMemoryHit[]>;
  upsert?(documents: readonly SemanticMemoryDocument[]): Promise<void>;
  remove?(paths: readonly string[]): Promise<void>;
}

export class NoopSemanticMemoryIndex implements SemanticMemoryIndex {
  readonly kind = "noop";
  readonly enabled: boolean;

  constructor(options: { enabled?: boolean } = {}) {
    this.enabled = options.enabled ?? false;
  }

  async search(): Promise<SemanticMemoryHit[]> {
    return [];
  }

  async upsert(): Promise<void> {
    return;
  }

  async remove(): Promise<void> {
    return;
  }
}

export const noopSemanticMemoryIndex = new NoopSemanticMemoryIndex();
