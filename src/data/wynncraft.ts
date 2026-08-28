import type {
  WynncraftAbilityTree,
  WynncraftCacheRoute,
  WynncraftCharacter,
  WynncraftCharacterAbilities,
  WynncraftClient,
  WynncraftClientOptions,
  WynncraftItem,
  WynncraftPublicProfile,
} from './types.js';
import type { ToolOutcome, ToolTrace, ToolTraceMetadata } from './types.js';

const DEFAULT_BASE_URL = 'https://api.wynncraft.com/v3';
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_CACHE_ENTRIES = 64;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const SENSITIVE_VALUE_PATTERN =
  /(?:authorization|bearer|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|session)|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

// Wynncraft documents these route cache lifetimes. Player routes are assigned
// zero here and also bypass the cache at the call site because their payloads
// may contain account or character identifiers. Shared static data remains
// bounded and cacheable.
const DEFAULT_CACHE_TTL_MS: Record<WynncraftCacheRoute, number> = {
  profile: 0,
  character: 0,
  characterAbilities: 0,
  abilityTree: 60 * 60_000,
  items: 60 * 60_000,
};

const SOURCE_ID = 'wynncraft-api';

type CacheEntry = {
  value: unknown;
  expiresAt: number;
  lastUsedAt: number;
  metadata?: ToolTraceMetadata;
};

type ResponseHeaders = {
  get?: (name: string) => string | null;
};

type ResponseLike = {
  status: number;
  ok?: boolean;
  headers?: ResponseHeaders;
  body?: {
    getReader: () => {
      read: () => Promise<{ done: boolean; value?: Uint8Array }>;
      cancel?: () => Promise<unknown>;
    };
  } | null;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<ResponseLike>;

class RequestTimeoutError extends Error {
  constructor() {
    super('request timed out');
    this.name = 'RequestTimeoutError';
  }
}

let traceCounter = 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const cloneIfPossible = <T>(value: T): T => {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Some test doubles and host objects are not cloneable.  They are still
      // safe to retain in this private, bounded cache.
    }
  }
  return value;
};

const clampTimeout = (value: number | undefined): number => {
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1, Math.min(MAX_TIMEOUT_MS, Math.floor(value as number)));
};

const clampCacheSize = (value: number | undefined): number => {
  if (!Number.isFinite(value)) return DEFAULT_MAX_CACHE_ENTRIES;
  return Math.max(0, Math.min(256, Math.floor(value as number)));
};

const clampTtl = (value: number | undefined, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(24 * 60 * 60_000, Math.floor(value as number)));
};

const safeHeader = (headers: ResponseHeaders | undefined, name: string): string | undefined => {
  try {
    const value = headers?.get?.(name);
    if (!value || /[\r\n]/.test(value) || SENSITIVE_VALUE_PATTERN.test(value)) return undefined;
    return value.slice(0, 128);
  } catch {
    return undefined;
  }
};

const responseMetadata = (headers: ResponseHeaders | undefined): ToolTraceMetadata | undefined => {
  const version =
    safeHeader(headers, 'version') ??
    safeHeader(headers, 'x-api-version') ??
    safeHeader(headers, 'x-wynncraft-api-version');
  const cache = safeHeader(headers, 'cache-control') ?? safeHeader(headers, 'x-cache');
  const limit = safeHeader(headers, 'x-ratelimit-limit') ?? safeHeader(headers, 'ratelimit-limit');
  const remaining =
    safeHeader(headers, 'x-ratelimit-remaining') ?? safeHeader(headers, 'ratelimit-remaining');
  const reset = safeHeader(headers, 'x-ratelimit-reset') ?? safeHeader(headers, 'ratelimit-reset');
  const retryAfter = safeHeader(headers, 'retry-after');
  const rateLimit =
    limit || remaining || reset || retryAfter ? { limit, remaining, reset, retryAfter } : undefined;

  if (!version && !cache && !rateLimit) return undefined;
  return { version, cache, rateLimit };
};

const selectorIsSafe = (value: string): boolean => {
  const hasControlCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  const hasPathDelimiter = ['/', '\\', '?', '#'].some((character) => value.includes(character));
  return value.length > 0 && value.length <= 128 && !hasControlCharacter && !hasPathDelimiter;
};

const isLoopbackHostname = (hostname: string): boolean =>
  ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname.toLowerCase());

const normalizeBaseUrl = (value: string | undefined): { value: string; error?: string } => {
  const raw = (typeof value === 'string' ? value : DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(raw);
    const allowed =
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname));
    if (!allowed || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return {
        value: DEFAULT_BASE_URL,
        error: 'Wynncraft base URL must be an HTTPS URL without credentials or query parameters.',
      };
    }
    return { value: parsed.toString().replace(/\/+$/, '') };
  } catch {
    return {
      value: DEFAULT_BASE_URL,
      error: 'Wynncraft base URL is invalid; live data is unavailable.',
    };
  }
};

const classIsSafe = (value: string): boolean =>
  ['archer', 'warrior', 'assassin', 'mage', 'shaman'].includes(value);

const makeTrace = (
  tool: string,
  status: ToolTrace['status'],
  startedAt: number,
  message: string,
  mode: ToolTrace['mode'] = 'live',
  metadata?: ToolTraceMetadata,
  cache?: ToolTrace['cache'],
): ToolTrace => ({
  id: `wynncraft-${++traceCounter}`,
  tool,
  status,
  mode,
  startedAt: new Date(startedAt).toISOString(),
  durationMs: Math.max(0, Date.now() - startedAt),
  sourceIds: [SOURCE_ID],
  message,
  ...(metadata ? { metadata } : {}),
  ...(cache ? { cache } : {}),
});

const invalidArgument = <T>(tool: string, startedAt: number, message: string): ToolOutcome<T> => ({
  ok: false,
  error: message,
  trace: makeTrace(tool, 'error', startedAt, message),
});

const classifyHttpError = (status: number): string => {
  if (status === 300) {
    return 'Wynncraft returned 300 MultipleObjectsReturned; use a UUID selector.';
  }
  if (status === 400) return 'Wynncraft rejected the request (400 Bad Request).';
  if (status === 401) return 'Wynncraft rejected the request (401 Unauthorized).';
  if (status === 403) {
    return 'Wynncraft denied access (403); this data is restricted by the profile access rules.';
  }
  if (status === 404) return 'Wynncraft could not find that resource (404 Not Found).';
  if (status === 408) return 'Wynncraft request timed out (408 Request Timeout).';
  if (status === 429) return 'Wynncraft rate limit reached (429); try again later.';
  if (status >= 500) return `Wynncraft service unavailable (${status}).`;
  return `Wynncraft request failed (${status}).`;
};

const hasRestrictedFields = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const restrictions = value.restrictions;
  if (!isRecord(restrictions)) return false;
  return Object.values(restrictions).some((restriction) => {
    if (typeof restriction === 'boolean') return restriction;
    if (typeof restriction === 'string') return restriction.toLowerCase() !== 'public';
    return restriction != null;
  });
};

const readablePayload = <T>(
  payload: unknown,
  isValid: (value: unknown) => value is T,
): { value?: T; error?: string } => {
  if (isValid(payload)) return { value: payload };
  return { error: 'Wynncraft returned an incomplete or invalid JSON payload.' };
};

const readJsonBounded = async (response: ResponseLike, maximumBytes: number): Promise<unknown> => {
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel?.().catch(() => undefined);
        throw new RangeError('response too large');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  if (typeof response.text === 'function') {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes) {
      throw new RangeError('response too large');
    }
    return JSON.parse(text);
  }
  if (typeof response.json === 'function') return response.json();
  throw new SyntaxError('response has no readable JSON body');
};

const asObject = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && Object.keys(value).length > 0;

const asItem = (value: unknown): value is WynncraftItem =>
  isRecord(value) &&
  (typeof value.displayName === 'string' ||
    typeof value.internalName === 'string' ||
    typeof value.id === 'string');

const asItems = (value: unknown): value is WynncraftItem[] =>
  Array.isArray(value) && value.length > 0 && value.every(asItem);

const normalizeItems = (payload: unknown): WynncraftItem[] | undefined => {
  if (asItems(payload)) return payload;
  if (!isRecord(payload)) return undefined;
  const results = payload.results;
  if (asItems(results)) return results;
  if (isRecord(results)) {
    const values = Object.values(results);
    return values.length > 0 && values.every(asItem) ? values : undefined;
  }
  // Some API deployments return the full result as a map keyed by item name.
  // Keep only object values; primitive metadata fields are not item records.
  const values = Object.values(payload);
  if (values.length > 0 && values.every(asItem)) return values;
  return undefined;
};

export const createWynncraftClient = (options: WynncraftClientOptions = {}): WynncraftClient => {
  const normalizedBaseUrl = normalizeBaseUrl(options.baseUrl);
  const baseUrl = normalizedBaseUrl.value;
  const baseUrlError = normalizedBaseUrl.error;
  const timeoutMs = clampTimeout(options.timeoutMs);
  const maxCacheEntries = clampCacheSize(options.maxCacheEntries);
  const now = options.now ?? (() => Date.now());
  const fetcher = (options.fetch ?? globalThis.fetch) as unknown as FetchLike;
  const cacheTtlMs = {
    ...DEFAULT_CACHE_TTL_MS,
    ...Object.fromEntries(
      Object.entries(options.cacheTtlMs ?? {}).map(([key, value]) => [
        key,
        clampTtl(
          value as number | undefined,
          DEFAULT_CACHE_TTL_MS[key as WynncraftCacheRoute] ?? DEFAULT_TIMEOUT_MS,
        ),
      ]),
    ),
  } as Record<WynncraftCacheRoute, number>;
  const cache = new Map<string, CacheEntry>();

  const clearCache = (): void => cache.clear();

  const readCache = <T>(key: string, route: WynncraftCacheRoute): ToolOutcome<T> | undefined => {
    const entry = cache.get(key);
    if (!entry) return undefined;
    const currentTime = now();
    if (entry.expiresAt <= currentTime) {
      cache.delete(key);
      return undefined;
    }
    entry.lastUsedAt = currentTime;
    // Reinsert to make the map's iteration order LRU order.
    cache.delete(key);
    cache.set(key, entry);
    const startedAt = Date.now();
    return {
      ok: true,
      data: cloneIfPossible(entry.value) as T,
      trace: makeTrace(
        `wynncraft.${route}`,
        'ok',
        startedAt,
        'cache hit',
        'cached',
        cloneIfPossible(entry.metadata),
        'hit',
      ),
    };
  };

  const writeCache = (
    key: string,
    value: unknown,
    route: WynncraftCacheRoute,
    metadata?: ToolTraceMetadata,
  ): void => {
    if ((cacheTtlMs[route] ?? 0) <= 0 || maxCacheEntries <= 0) return;
    const currentTime = now();
    cache.set(key, {
      value: cloneIfPossible(value),
      expiresAt: currentTime + (cacheTtlMs[route] ?? 0),
      lastUsedAt: currentTime,
      ...(metadata ? { metadata: cloneIfPossible(metadata) } : {}),
    });
    while (cache.size > maxCacheEntries) {
      const oldest = [...cache.entries()].sort(
        ([, left], [, right]) => left.lastUsedAt - right.lastUsedAt,
      )[0];
      if (!oldest) break;
      cache.delete(oldest[0]);
    }
  };

  const request = async <T>(
    route: WynncraftCacheRoute,
    tool: string,
    path: string,
    validator: (value: unknown) => value is T,
    key = path,
    cacheResponse = true,
  ): Promise<ToolOutcome<T>> => {
    const startedAt = Date.now();
    const cached = cacheResponse ? readCache<T>(key, route) : undefined;
    if (cached) return cached;

    if (baseUrlError) {
      return {
        ok: false,
        error: baseUrlError,
        trace: makeTrace(tool, 'fallback', startedAt, baseUrlError, 'live', undefined, 'miss'),
      };
    }
    if (typeof fetcher !== 'function') {
      const message = 'Wynncraft live data is unavailable: fetch is not configured.';
      return {
        ok: false,
        error: message,
        trace: makeTrace(tool, 'fallback', startedAt, message, 'live', undefined, 'miss'),
      };
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const fetchPromise = Promise.resolve().then(() =>
      fetcher(`${baseUrl}${path}`, controller ? { signal: controller.signal } : undefined),
    );
    const timeoutPromise = new Promise<ResponseLike>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          controller?.abort();
        } catch {
          // A custom AbortController may throw; timeout still remains bounded.
        }
        reject(new RequestTimeoutError());
      }, timeoutMs);
    });

    let response: ResponseLike;
    let payload: unknown;
    try {
      response = await Promise.race([fetchPromise, timeoutPromise]);
      if (
        !response ||
        !Number.isInteger(response.status) ||
        response.status < 100 ||
        response.status > 599
      ) {
        throw new Error('invalid response');
      }
    } catch (cause) {
      if (timer) clearTimeout(timer);
      const message =
        timedOut || cause instanceof RequestTimeoutError
          ? 'Wynncraft request timed out; live data is unavailable.'
          : 'Wynncraft request failed before a response was received.';
      return {
        ok: false,
        error: message,
        trace: makeTrace(tool, 'fallback', startedAt, message, 'live', undefined, 'miss'),
      };
    }

    const metadata = responseMetadata(response.headers);
    if (response.status < 200 || response.status >= 300 || response.ok === false) {
      if (timer) clearTimeout(timer);
      const message = classifyHttpError(response.status);
      return {
        ok: false,
        error: message,
        trace: makeTrace(tool, 'error', startedAt, message, 'live', metadata, 'miss'),
      };
    }

    try {
      const contentLength = safeHeader(response.headers, 'content-length');
      if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
        throw new RangeError('response too large');
      }
      payload = await Promise.race([
        Promise.resolve().then(() => readJsonBounded(response, MAX_RESPONSE_BYTES)),
        timeoutPromise,
      ]);
    } catch (cause) {
      const timedOutResponse = timedOut || cause instanceof RequestTimeoutError;
      const message = timedOutResponse
        ? 'Wynncraft request timed out; live data is unavailable.'
        : cause instanceof RangeError
          ? 'Wynncraft response was too large to process safely.'
          : 'Wynncraft returned an invalid JSON payload.';
      return {
        ok: false,
        error: message,
        trace: makeTrace(
          tool,
          timedOutResponse ? 'fallback' : 'error',
          startedAt,
          message,
          'live',
          metadata,
          'miss',
        ),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
    const checked = readablePayload(payload, validator);
    if (checked.error) {
      return {
        ok: false,
        error: checked.error,
        trace: makeTrace(tool, 'error', startedAt, checked.error, 'live', metadata, 'miss'),
      };
    }
    const value = checked.value as T;
    const restricted = hasRestrictedFields(value);
    // A restricted response is useful to the direct caller as an explicit
    // partial result, but it must not become shared process state.
    if (cacheResponse && !restricted) writeCache(key, value, route, metadata);
    const message = restricted ? 'ok; the API reports restricted or incomplete fields' : 'ok';
    return {
      ok: true,
      data: value,
      trace: makeTrace(tool, 'ok', startedAt, message, 'live', metadata, 'miss'),
    };
  };

  const getPublicProfile = (
    selector: string,
    profileOptions: { fullResult?: boolean } = {},
  ): Promise<ToolOutcome<WynncraftPublicProfile>> => {
    const startedAt = Date.now();
    if (typeof selector !== 'string' || !selectorIsSafe(selector)) {
      return Promise.resolve(
        invalidArgument(
          'wynncraft.getPublicProfile',
          startedAt,
          'Profile selector must be a non-empty safe username or UUID.',
        ),
      );
    }
    const encodedSelector = encodeURIComponent(selector);
    const suffix = profileOptions.fullResult ? '?fullResult' : '';
    // Do not cache profiles: profile payloads can contain UUIDs, character
    // identifiers, and account metadata. They are returned directly but never
    // retained in process memory or copied into traces.
    return request<WynncraftPublicProfile>(
      'profile',
      'wynncraft.getPublicProfile',
      `/player/${encodedSelector}${suffix}`,
      asObject,
      `profile:${encodedSelector}:${profileOptions.fullResult ? 'full' : 'summary'}`,
      false,
    );
  };

  const getCharacter = (
    selector: string,
    characterId: string,
  ): Promise<ToolOutcome<WynncraftCharacter>> => {
    const startedAt = Date.now();
    if (typeof selector !== 'string' || !selectorIsSafe(selector)) {
      return Promise.resolve(
        invalidArgument(
          'wynncraft.getCharacter',
          startedAt,
          'Profile selector must be a non-empty safe username or UUID.',
        ),
      );
    }
    if (typeof characterId !== 'string' || !selectorIsSafe(characterId)) {
      return Promise.resolve(
        invalidArgument(
          'wynncraft.getCharacter',
          startedAt,
          'Character identifier must be a non-empty safe identifier.',
        ),
      );
    }
    const path = `/player/${encodeURIComponent(selector)}/characters/${encodeURIComponent(characterId)}`;
    return request<WynncraftCharacter>(
      'character',
      'wynncraft.getCharacter',
      path,
      asObject,
      path,
      false,
    );
  };

  const getCharacterAbilities = (
    selector: string,
    characterId: string,
  ): Promise<ToolOutcome<WynncraftCharacterAbilities>> => {
    const startedAt = Date.now();
    if (typeof selector !== 'string' || !selectorIsSafe(selector)) {
      return Promise.resolve(
        invalidArgument(
          'wynncraft.getCharacterAbilities',
          startedAt,
          'Profile selector must be a non-empty safe username or UUID.',
        ),
      );
    }
    if (typeof characterId !== 'string' || !selectorIsSafe(characterId)) {
      return Promise.resolve(
        invalidArgument(
          'wynncraft.getCharacterAbilities',
          startedAt,
          'Character identifier must be a non-empty safe identifier.',
        ),
      );
    }
    const path = `/player/${encodeURIComponent(selector)}/characters/${encodeURIComponent(characterId)}/abilities`;
    return request<WynncraftCharacterAbilities>(
      'characterAbilities',
      'wynncraft.getCharacterAbilities',
      path,
      asObject,
      path,
      false,
    );
  };

  const getAbilityTree = (classId: string): Promise<ToolOutcome<WynncraftAbilityTree>> => {
    const startedAt = Date.now();
    if (typeof classId !== 'string' || !classIsSafe(classId)) {
      return Promise.resolve(
        invalidArgument(
          'wynncraft.getAbilityTree',
          startedAt,
          'Class must be one of archer, warrior, assassin, mage, or shaman.',
        ),
      );
    }
    const path = `/ability/tree/${encodeURIComponent(classId)}`;
    return request<WynncraftAbilityTree>('abilityTree', 'wynncraft.getAbilityTree', path, asObject);
  };

  const getItems = (): Promise<ToolOutcome<WynncraftItem[]>> =>
    request<WynncraftItem[]>(
      'items',
      'wynncraft.getItems',
      '/item/database?fullResult',
      (value): value is WynncraftItem[] => normalizeItems(value) !== undefined,
      'items:full',
    ).then((outcome) => {
      if (!outcome.ok) return outcome;
      const normalized = normalizeItems(outcome.data);
      // The validator above guarantees this branch, but retain a safe
      // fallback in case a future validator is changed independently.
      return normalized
        ? { ...outcome, data: normalized }
        : {
            ok: false,
            error: 'Wynncraft returned an incomplete or invalid item payload.',
            trace: {
              ...outcome.trace,
              status: 'error' as const,
              message: 'Wynncraft returned an incomplete or invalid item payload.',
            },
          };
    });

  return {
    getPublicProfile,
    getCharacter,
    getCharacterAbilities,
    getAbilityTree,
    getItems,
    clearCache,
  };
};

export { DEFAULT_BASE_URL, DEFAULT_CACHE_TTL_MS, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS };
