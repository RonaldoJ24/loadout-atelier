import { describe, expect, it, vi } from 'vitest';
import { createWynncraftClient } from '../../src/data/wynncraft';

const response = (status: number, payload: unknown, headers: Record<string, string> = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  json: async () => payload,
});

describe('Wynncraft boundary client', () => {
  it('uses one bounded cache and sends presence-only fullResult', async () => {
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      urls.push(url);
      return response(200, [{ id: 'item-1' }], {
        'cache-control': 'max-age=3600',
        version: 'v3.7.2',
      });
    });
    const client = createWynncraftClient({ fetch: fetch as never, cacheTtlMs: { items: 1_000 } });

    const first = await client.getItems();
    const second = await client.getItems();

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(urls).toEqual(['https://api.wynncraft.com/v3/item/database?fullResult']);
    expect(second.ok && second.trace.mode).toBe('cached');
    expect(first.ok && first.trace.metadata?.version).toBe('v3.7.2');
  });

  it.each([
    [300, 'MultipleObjectsReturned'],
    [403, 'restricted'],
    [404, 'Not Found'],
  ])('returns a readable non-retryable %s error', async (status, expected) => {
    const fetch = vi.fn(async () => response(status, { secret: 'do not copy' }));
    const client = createWynncraftClient({ fetch: fetch as never });

    const result = await client.getPublicProfile('Alice');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(expected);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('do not copy');
  });

  it('returns restricted fields directly without persisting identifiers in traces', async () => {
    const uuid = '98bc2236-ada5-4039-b560-8aaa4cc50384';
    const fetch = vi.fn(async () =>
      response(200, { username: 'Alice', uuid, restrictions: { characterDataAccess: true } }),
    );
    const client = createWynncraftClient({ fetch: fetch as never });

    const result = await client.getPublicProfile('Alice');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.uuid).toBe(uuid);
      expect(result.trace.message).toContain('restricted');
      expect(JSON.stringify(result.trace)).not.toContain(uuid);
    }
  });

  it('never caches player or character payloads that may contain identifiers', async () => {
    const fetch = vi.fn(async (url: string) =>
      response(200, url.includes('/abilities') ? { selected: [] } : { level: 106 }),
    );
    const client = createWynncraftClient({ fetch: fetch as never });

    await client.getPublicProfile('Alice');
    await client.getPublicProfile('Alice');
    await client.getCharacter('Alice', 'character-id');
    await client.getCharacter('Alice', 'character-id');
    await client.getCharacterAbilities('Alice', 'character-id');
    await client.getCharacterAbilities('Alice', 'character-id');

    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('times out once and aborts the injected request', async () => {
    vi.useFakeTimers();
    try {
      const abort = vi.fn();
      const fetch = vi.fn((_url: string, init?: RequestInit) => {
        init?.signal?.addEventListener('abort', abort);
        return new Promise<never>(() => undefined);
      });
      const client = createWynncraftClient({ fetch: fetch as never, timeoutMs: 25 });
      const pending = client.getAbilityTree('mage');
      await vi.advanceTimersByTimeAsync(25);
      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('timed out');
      expect(abort).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('also bounds a response whose JSON body never resolves', async () => {
    vi.useFakeTimers();
    try {
      const abort = vi.fn();
      const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
        init?.signal?.addEventListener('abort', abort);
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: () => new Promise<never>(() => undefined),
        };
      });
      const client = createWynncraftClient({ fetch: fetch as never, timeoutMs: 25 });
      const pending = client.getAbilityTree('mage');
      await vi.advanceTimersByTimeAsync(25);
      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('timed out');
      expect(abort).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
