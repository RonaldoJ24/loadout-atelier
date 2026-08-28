import { describe, expect, it, vi } from 'vitest';
import { createWynncraftClient } from '../../src/data/wynncraft';

const response = (status: number, payload: unknown, headers: Record<string, string> = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  text: async () => JSON.stringify(payload),
  json: async () => payload,
});

describe('Wynncraft boundary client', () => {
  it('uses one bounded cache and sends presence-only fullResult for static items', async () => {
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

  it('normalizes a trimmed username to an identity-free profile summary', async () => {
    const rawIdentifier = 'synthetic-private-marker';
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      urls.push(url);
      return response(
        200,
        {
          username: 'SyntheticPlayer',
          online: true,
          uuid: rawIdentifier,
          characters: { [rawIdentifier]: { id: rawIdentifier } },
          restrictions: { characterDataAccess: 'public' },
          guild: { name: 'unreturned-account-field' },
        },
        { version: 'v3.7.2', 'x-ratelimit-limit': '50' },
      );
    });
    const client = createWynncraftClient({ fetch: fetch as never });

    const result = await client.getPublicProfile('  SyntheticPlayer  ');

    expect(urls).toEqual(['https://api.wynncraft.com/v3/player/SyntheticPlayer']);
    expect(result).toMatchObject({
      ok: true,
      data: {
        status: 'public',
        online: true,
        characterCount: 1,
        characterData: 'available',
      },
    });
    if (result.ok) {
      expect(Object.keys(result.data).sort()).toEqual([
        'characterCount',
        'characterData',
        'online',
        'status',
      ]);
      expect(result.trace.cache).toBe('bypass');
      expect(result.trace.metadata?.version).toBe('v3.7.2');
      expect(JSON.stringify(result)).not.toContain(rawIdentifier);
      expect(JSON.stringify(result)).not.toContain('unreturned-account-field');
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['', 'not a valid name', 'name/with/path', '12345678901234567', 'name-with-dash'])(
    'rejects malformed username %j before making a request',
    async (username) => {
      const fetch = vi.fn(async () => response(200, { online: true }));
      const client = createWynncraftClient({ fetch: fetch as never });

      const result = await client.getPublicProfile(username);

      expect(result.ok).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
      expect(result.trace.cache).toBe('bypass');
      if (username) expect(JSON.stringify(result)).not.toContain(username);
    },
  );

  it('returns only coarse partial state when character access is restricted', async () => {
    const rawIdentifier = 'synthetic-character-marker';
    const fetch = vi.fn(async () =>
      response(200, {
        username: 'SyntheticPlayer',
        online: true,
        uuid: rawIdentifier,
        characters: { [rawIdentifier]: { id: rawIdentifier } },
        restrictions: { characterDataAccess: true, guildDataAccess: 'private' },
      }),
    );
    const client = createWynncraftClient({ fetch: fetch as never });

    const result = await client.getPublicProfile('SyntheticPlayer');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        status: 'partial',
        online: true,
        characterCount: null,
        characterData: 'restricted',
      });
      expect(result.trace.cache).toBe('bypass');
      expect(result.trace.message).toContain('restricted');
      expect(JSON.stringify(result)).not.toContain(rawIdentifier);
      expect(JSON.stringify(result)).not.toContain('characterDataAccess');
      expect(JSON.stringify(result)).not.toContain('guildDataAccess');
    }
  });

  it('represents missing profile fields as partial unknown state', async () => {
    const fetch = vi.fn(async () => response(200, { username: 'SyntheticPlayer', online: false }));
    const client = createWynncraftClient({ fetch: fetch as never });

    const result = await client.getPublicProfile('SyntheticPlayer');

    expect(result).toMatchObject({
      ok: true,
      data: {
        status: 'partial',
        online: false,
        characterCount: null,
        characterData: 'unknown',
      },
    });
  });

  it('rejects an identifier-only or malformed profile payload without copying it', async () => {
    const rawIdentifier = 'synthetic-identifier-only-marker';
    const fetch = vi.fn(async () => response(200, { uuid: rawIdentifier, guild: 'private' }));
    const client = createWynncraftClient({ fetch: fetch as never });

    const result = await client.getPublicProfile('SyntheticPlayer');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('incomplete');
    expect(result.trace.cache).toBe('bypass');
    expect(JSON.stringify(result)).not.toContain(rawIdentifier);
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it.each([
    [300, 'MultipleObjectsReturned'],
    [403, 'restricted'],
    [404, 'Not Found'],
    [429, 'rate limit'],
  ])(
    'returns a readable non-retryable %s error without response data',
    async (status, expected) => {
      const fetch = vi.fn(async () => response(status, { secret: 'synthetic-body-marker' }));
      const client = createWynncraftClient({ fetch: fetch as never });

      const result = await client.getPublicProfile('SyntheticPlayer');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.toLowerCase()).toContain(expected.toLowerCase());
        expect(result.error).not.toMatch(/uuid/i);
      }
      expect(result.trace.cache).toBe('bypass');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain('synthetic-body-marker');
    },
  );

  it('times out once, aborts, and marks profile errors as cache bypasses', async () => {
    vi.useFakeTimers();
    try {
      const abort = vi.fn();
      const fetch = vi.fn((_url: string, init?: RequestInit) => {
        init?.signal?.addEventListener('abort', abort);
        return new Promise<never>(() => undefined);
      });
      const client = createWynncraftClient({ fetch: fetch as never, timeoutMs: 25 });
      const pending = client.getPublicProfile('SyntheticPlayer');
      await vi.advanceTimersByTimeAsync(25);
      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('timed out');
      expect(result.trace.cache).toBe('bypass');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(abort).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('also bounds a profile response whose body never resolves', async () => {
    vi.useFakeTimers();
    try {
      const abort = vi.fn();
      const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
        init?.signal?.addEventListener('abort', abort);
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          text: () => new Promise<never>(() => undefined),
        };
      });
      const client = createWynncraftClient({ fetch: fetch as never, timeoutMs: 25 });
      const pending = client.getPublicProfile('SyntheticPlayer');
      await vi.advanceTimersByTimeAsync(25);
      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('timed out');
      expect(result.trace.cache).toBe('bypass');
      expect(abort).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never caches player or character payloads that may contain identifiers', async () => {
    const fetch = vi.fn(async (url: string) =>
      response(200, url.includes('/abilities') ? { selected: [] } : { level: 106 }),
    );
    const client = createWynncraftClient({ fetch: fetch as never });

    await client.getPublicProfile('SyntheticPlayer');
    await client.getPublicProfile('SyntheticPlayer');
    await client.getCharacter('SyntheticPlayer', 'character-id');
    await client.getCharacter('SyntheticPlayer', 'character-id');
    await client.getCharacterAbilities('SyntheticPlayer', 'character-id');
    await client.getCharacterAbilities('SyntheticPlayer', 'character-id');

    expect(fetch).toHaveBeenCalledTimes(6);
  });
});
