import { recommendationCandidateSchema } from '../domain/schemas.js';
import type { RecommendationCandidate } from '../domain/contracts.js';
import type { ToolOutcome, ToolTrace, ToolTraceMetadata } from '../data/types.js';
import type {
  DeepSeekCompletionRequest,
  DeepSeekMessage,
  DeepSeekProvider,
  DeepSeekProviderOptions,
} from './types.js';

export const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';
export const DEFAULT_DEEPSEEK_TIMEOUT_MS = 10_000;
export const MAX_DEEPSEEK_TIMEOUT_MS = 12_000;
const MAX_PROVIDER_RESPONSE_BYTES = 1 * 1024 * 1024;
const MAX_PROVIDER_MESSAGES = 16;
const MAX_PROVIDER_PROMPT_CHARS = 50_000;
const SENSITIVE_VALUE_PATTERN =
  /(?:authorization|bearer|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|session)|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const MAX_API_KEY_CHARS = 512;

type ResponseLike = {
  status: number;
  ok?: boolean;
  headers?: {
    get?: (name: string) => string | null;
  };
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

let traceCounter = 0;

class ProviderTimeoutError extends Error {
  constructor() {
    super('provider timed out');
    this.name = 'ProviderTimeoutError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

const clampTimeout = (value: number | undefined): number => {
  if (!Number.isFinite(value)) return DEFAULT_DEEPSEEK_TIMEOUT_MS;
  return Math.max(1, Math.min(MAX_DEEPSEEK_TIMEOUT_MS, Math.floor(value as number)));
};

const safeHeader = (headers: ResponseLike['headers'], name: string): string | undefined => {
  try {
    const value = headers?.get?.(name);
    if (!value || /[\r\n]/.test(value) || SENSITIVE_VALUE_PATTERN.test(value)) return undefined;
    return value.slice(0, 128);
  } catch {
    return undefined;
  }
};

const responseMetadata = (headers: ResponseLike['headers']): ToolTraceMetadata | undefined => {
  const version =
    safeHeader(headers, 'version') ??
    safeHeader(headers, 'x-api-version') ??
    safeHeader(headers, 'x-deepseek-api-version');
  const rateLimit = {
    limit: safeHeader(headers, 'x-ratelimit-limit') ?? safeHeader(headers, 'ratelimit-limit'),
    remaining:
      safeHeader(headers, 'x-ratelimit-remaining') ?? safeHeader(headers, 'ratelimit-remaining'),
    reset: safeHeader(headers, 'x-ratelimit-reset') ?? safeHeader(headers, 'ratelimit-reset'),
    retryAfter: safeHeader(headers, 'retry-after'),
  };
  if (!version && !Object.values(rateLimit).some(Boolean)) return undefined;
  return { ...(version ? { version } : {}), rateLimit };
};

const makeTrace = (
  status: ToolTrace['status'],
  startedAt: number,
  message: string,
  metadata?: ToolTraceMetadata,
): ToolTrace => ({
  id: `deepseek-${++traceCounter}`,
  tool: 'deepseek.chat.completions',
  status,
  mode: 'provider',
  startedAt: new Date(startedAt).toISOString(),
  durationMs: Math.max(0, Date.now() - startedAt),
  sourceIds: ['deepseek-provider'],
  message,
  ...(metadata ? { metadata } : {}),
});

const httpMessage = (status: number): string => {
  if (status === 401 || status === 403)
    return 'DeepSeek authorization failed; check the server API key.';
  if (status === 408) return 'DeepSeek request timed out.';
  if (status === 429) return 'DeepSeek rate limit reached; try again later.';
  if (status >= 500) return `DeepSeek service unavailable (${status}).`;
  return `DeepSeek request failed (${status}).`;
};

const normalizeRequest = (
  request: DeepSeekCompletionRequest | string,
): DeepSeekCompletionRequest | undefined => {
  if (typeof request === 'string') {
    if (request.length === 0 || request.length > MAX_PROVIDER_PROMPT_CHARS) return undefined;
    return { messages: [{ role: 'user', content: request }] };
  }
  if (
    !isRecord(request) ||
    !Array.isArray(request.messages) ||
    request.messages.length === 0 ||
    request.messages.length > MAX_PROVIDER_MESSAGES
  ) {
    return undefined;
  }
  const messages: DeepSeekMessage[] = [];
  let totalChars = 0;
  for (const message of request.messages) {
    if (!isRecord(message)) return undefined;
    const role = message.role;
    const content = message.content;
    if (
      (role !== 'system' && role !== 'user' && role !== 'assistant') ||
      typeof content !== 'string' ||
      content.length === 0 ||
      content.length > 50_000
    ) {
      return undefined;
    }
    totalChars += content.length;
    if (totalChars > MAX_PROVIDER_PROMPT_CHARS) return undefined;
    messages.push({ role, content });
  }
  const model = request.model;
  return {
    messages,
    ...(typeof model === 'string' && model.trim().length > 0
      ? { model: model.trim().slice(0, 128) }
      : {}),
  };
};

const isLoopbackHostname = (hostname: string): boolean =>
  ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname.toLowerCase());

const normalizeEndpoint = (value: string | undefined): { value: string; error?: string } => {
  const raw = (typeof value === 'string' ? value : DEEPSEEK_ENDPOINT).trim();
  try {
    const parsed = new URL(raw);
    const allowed =
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname));
    if (!allowed || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return {
        value: DEEPSEEK_ENDPOINT,
        error: 'DeepSeek endpoint must be an HTTPS URL without credentials or query parameters.',
      };
    }
    return { value: parsed.toString().replace(/\/+$/, '') };
  } catch {
    return { value: DEEPSEEK_ENDPOINT, error: 'DeepSeek endpoint is invalid.' };
  }
};

const extractContent = (payload: unknown): string | undefined => {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    return undefined;
  }
  const first = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== 'string') {
    return undefined;
  }
  if (
    first.message.content.length === 0 ||
    first.message.content.length > MAX_PROVIDER_RESPONSE_BYTES
  )
    return undefined;
  return first.message.content;
};

const jsonCandidate = (content: string): unknown => {
  // Strict JSON-only mode intentionally rejects markdown fences and any prose
  // surrounding the object. This keeps provider output from smuggling claims
  // into the deterministic explanation path.
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
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

export const createDeepSeekProvider = (options: DeepSeekProviderOptions = {}): DeepSeekProvider => {
  const apiKey = typeof options.apiKey === 'string' ? options.apiKey.trim() : '';
  const model =
    typeof options.model === 'string' && options.model.trim().length > 0
      ? options.model.trim().slice(0, 128)
      : DEFAULT_DEEPSEEK_MODEL;
  const apiKeyIsSafe =
    apiKey.length > 0 && apiKey.length <= MAX_API_KEY_CHARS && !hasControlCharacter(apiKey);
  const timeoutMs = clampTimeout(options.timeoutMs);
  const normalizedEndpoint = normalizeEndpoint(options.endpoint);
  const endpoint = normalizedEndpoint.value;
  const endpointError = normalizedEndpoint.error;
  const fetcher = (options.fetch ?? globalThis.fetch) as unknown as FetchLike;
  const available = apiKeyIsSafe && typeof fetcher === 'function' && !endpointError;

  const complete = async (
    request: DeepSeekCompletionRequest | string,
  ): Promise<ToolOutcome<unknown>> => {
    const startedAt = Date.now();
    if (!apiKeyIsSafe) {
      const message = 'DeepSeek provider unavailable: server API key is not configured.';
      return {
        ok: false,
        error: message,
        trace: makeTrace('fallback', startedAt, message),
      };
    }
    if (typeof fetcher !== 'function') {
      const message = 'DeepSeek provider unavailable: fetch is not configured.';
      return {
        ok: false,
        error: message,
        trace: makeTrace('fallback', startedAt, message),
      };
    }
    if (endpointError) {
      return {
        ok: false,
        error: endpointError,
        trace: makeTrace('fallback', startedAt, endpointError),
      };
    }
    const normalized = normalizeRequest(request);
    if (!normalized) {
      const message = 'DeepSeek request was invalid or exceeded the safe prompt limit.';
      return {
        ok: false,
        error: message,
        trace: makeTrace('error', startedAt, message),
      };
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const payload = {
      model: normalized.model ?? model,
      messages: normalized.messages,
      response_format: { type: 'json_object' },
      max_tokens: 1_200,
      temperature: 0,
      stream: false,
    };
    const fetchPromise = Promise.resolve().then(() =>
      fetcher(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        ...(controller ? { signal: controller.signal } : {}),
      }),
    );
    const timeoutPromise = new Promise<ResponseLike>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          controller?.abort();
        } catch {
          // The timeout remains bounded even if a custom controller rejects.
        }
        reject(new ProviderTimeoutError());
      }, timeoutMs);
    });
    let response: ResponseLike;
    let providerPayload: unknown;
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
        timedOut || cause instanceof ProviderTimeoutError
          ? 'DeepSeek request timed out; provider output was not used.'
          : 'DeepSeek request failed before a response was received.';
      return {
        ok: false,
        error: message,
        trace: makeTrace('fallback', startedAt, message),
      };
    }
    const metadata = responseMetadata(response.headers);
    if (response.status < 200 || response.status >= 300 || response.ok === false) {
      if (timer) clearTimeout(timer);
      const message = httpMessage(response.status);
      return {
        ok: false,
        error: message,
        trace: makeTrace('error', startedAt, message, metadata),
      };
    }
    try {
      const contentLength = safeHeader(response.headers, 'content-length');
      if (contentLength && Number(contentLength) > MAX_PROVIDER_RESPONSE_BYTES) {
        throw new RangeError('response too large');
      }
      providerPayload = await Promise.race([
        Promise.resolve().then(() => readJsonBounded(response, MAX_PROVIDER_RESPONSE_BYTES)),
        timeoutPromise,
      ]);
    } catch (cause) {
      const timedOutResponse = timedOut || cause instanceof ProviderTimeoutError;
      const message = timedOutResponse
        ? 'DeepSeek request timed out; provider output was not used.'
        : cause instanceof RangeError
          ? 'DeepSeek response was too large to process safely.'
          : 'DeepSeek returned invalid JSON; provider output was not used.';
      return {
        ok: false,
        error: message,
        trace: makeTrace(timedOutResponse ? 'fallback' : 'error', startedAt, message, metadata),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
    const content = extractContent(providerPayload);
    if (typeof content !== 'string') {
      const message = 'DeepSeek response did not contain a JSON message.';
      return {
        ok: false,
        error: message,
        trace: makeTrace('error', startedAt, message, metadata),
      };
    }
    const parsed = jsonCandidate(content);
    if (parsed === undefined) {
      const message = 'DeepSeek returned malformed JSON; provider output was not used.';
      return {
        ok: false,
        error: message,
        trace: makeTrace('error', startedAt, message, metadata),
      };
    }
    return {
      ok: true,
      data: parsed,
      trace: makeTrace('ok', startedAt, 'provider response received', metadata),
    };
  };

  const recommend = async (
    request: DeepSeekCompletionRequest | string,
  ): Promise<ToolOutcome<RecommendationCandidate>> => {
    const outcome = await complete(request);
    if (!outcome.ok) return outcome;
    const parsed = recommendationCandidateSchema.safeParse(outcome.data);
    if (!parsed.success) {
      const message = 'DeepSeek recommendation did not match the required schema.';
      return {
        ok: false,
        error: message,
        trace: { ...outcome.trace, status: 'error', message },
      };
    }
    return { ...outcome, data: parsed.data };
  };

  return { available, model, complete, recommend };
};

export { clampTimeout as clampDeepSeekTimeout };
