import type { SourceMode, ToolTrace as DomainToolTrace } from '../domain/contracts.js';

/**
 * The small subset of response headers that is useful for diagnostics.  In
 * particular, this intentionally excludes arbitrary response headers: a
 * proxy must not accidentally put a credential or a player identifier into a
 * trace.
 */
export type ToolTraceMetadata = {
  version?: string;
  cache?: string;
  rateLimit?: {
    limit?: string;
    remaining?: string;
    reset?: string;
    retryAfter?: string;
  };
};

/** A domain trace with explicitly bounded, non-sensitive metadata. */
export type ToolTrace = Omit<DomainToolTrace, 'mode'> & {
  mode: SourceMode | 'provider';
  metadata?: ToolTraceMetadata;
  cache?: 'hit' | 'miss';
};

/**
 * All boundary calls use a discriminated result.  Callers can therefore
 * handle an unavailable live source without catching an implementation error
 * or inspecting an untrusted provider payload.
 */
export type ToolOutcome<T> =
  | {
      ok: true;
      data: T;
      trace: ToolTrace;
    }
  | {
      ok: false;
      error: string;
      trace: ToolTrace;
    };

export type WynncraftPublicProfile = Record<string, unknown>;
export type WynncraftCharacter = Record<string, unknown>;
export type WynncraftCharacterAbilities = Record<string, unknown>;
export type WynncraftAbilityTree = Record<string, unknown>;
export type WynncraftItem = Record<string, unknown>;

export type WynncraftFetch = typeof globalThis.fetch;

export type WynncraftCacheRoute =
  'profile' | 'character' | 'characterAbilities' | 'abilityTree' | 'items';

export type WynncraftClientOptions = {
  baseUrl?: string;
  fetch?: WynncraftFetch;
  timeoutMs?: number;
  /** Maximum successful responses retained by this client instance. */
  maxCacheEntries?: number;
  /** Override route TTLs in milliseconds, primarily useful for tests. */
  cacheTtlMs?: Partial<Record<WynncraftCacheRoute, number>>;
  now?: () => number;
};

export type PublicProfileOptions = {
  /** The API recognizes a presence-only `?fullResult` flag. */
  fullResult?: boolean;
};

export type WynncraftClient = {
  getPublicProfile(
    selector: string,
    options?: PublicProfileOptions,
  ): Promise<ToolOutcome<WynncraftPublicProfile>>;
  getCharacter(selector: string, characterId: string): Promise<ToolOutcome<WynncraftCharacter>>;
  getCharacterAbilities(
    selector: string,
    characterId: string,
  ): Promise<ToolOutcome<WynncraftCharacterAbilities>>;
  getAbilityTree(classId: string): Promise<ToolOutcome<WynncraftAbilityTree>>;
  getItems(): Promise<ToolOutcome<WynncraftItem[]>>;
  clearCache(): void;
};
