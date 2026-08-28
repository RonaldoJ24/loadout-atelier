import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWynncraftClient } from '../../src/data/wynncraft';
import { createApp, startServer, type ServerOptions } from '../../server/index';

const servers: Array<ReturnType<ReturnType<typeof createApp>['listen']>> = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function start(options: ServerOptions = { mode: 'fixture' }) {
  const server = createApp(options).listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe('local service contract', () => {
  it('binds the embeddable server to loopback by default', async () => {
    const server = startServer({ mode: 'fixture', port: 0 });
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    expect(address.address).toBe('127.0.0.1');
  });

  it('reports fixture/provider state without exposing configuration', async () => {
    const baseUrl = await start();
    const response = await fetch(`${baseUrl}/api/health`);
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 'ok',
      service: 'loadout-atelier',
      mode: 'fixture',
      provider: 'unavailable',
    });
    expect(JSON.stringify(body)).not.toContain('DEEPSEEK');
  });

  it('reports profile lookup as unavailable in fixture mode without synthetic data', async () => {
    const baseUrl = await start();
    const response = await fetch(`${baseUrl}/api/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'SyntheticTester' }),
    });
    const body = (await response.json()) as Record<string, unknown> & {
      trace?: Record<string, unknown>;
    };
    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      mode: 'fixture',
      error: 'Live profile lookup is unavailable in fixture mode.',
    });
    expect(body.trace).toMatchObject({
      tool: 'wynncraft.getPublicProfile',
      mode: 'fixture',
      cache: 'bypass',
    });
    expect(JSON.stringify(body)).not.toContain('SyntheticTester');
    expect(JSON.stringify(body)).not.toContain('uuid');
  });

  it('rejects malformed profile names before any live request', async () => {
    const fetcher = vi.fn(async () => ({
      status: 200,
      ok: true,
      headers: { get: () => null },
      text: async () => JSON.stringify({ online: true }),
    }));
    const client = createWynncraftClient({ fetch: fetcher as never });
    const baseUrl = await start({ mode: 'live', client });

    const response = await fetch(`${baseUrl}/api/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'not a valid name' }),
    });
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    expect(body).not.toContain('not a valid name');
  });

  it('returns an identity-free normalized profile summary in live mode', async () => {
    const rawIdentifier = 'synthetic-server-private-marker';
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.wynncraft.com/v3/player/SyntheticTester');
      return {
        status: 200,
        ok: true,
        headers: {
          get: (name: string) =>
            ({ version: 'v3.7.2', 'x-ratelimit-remaining': '49' })[name.toLowerCase()] ?? null,
        },
        text: async () =>
          JSON.stringify({
            username: 'SyntheticTester',
            online: true,
            uuid: rawIdentifier,
            characters: { [rawIdentifier]: { id: rawIdentifier } },
            restrictions: { characterDataAccess: 'public' },
            guild: { name: 'synthetic-server-unreturned-field' },
          }),
      };
    });
    const client = createWynncraftClient({ fetch: fetcher as never });
    const baseUrl = await start({ mode: 'live', client });

    const response = await fetch(`${baseUrl}/api/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'SyntheticTester' }),
    });
    const body = (await response.json()) as Record<string, unknown> & {
      data?: Record<string, unknown>;
      trace?: Record<string, unknown> & { metadata?: Record<string, unknown> };
    };

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      status: 'public',
      online: true,
      characterCount: 1,
      characterData: 'available',
    });
    expect(body.trace).toMatchObject({
      tool: 'wynncraft.getPublicProfile',
      mode: 'live',
      cache: 'bypass',
      metadata: { version: 'v3.7.2' },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('SyntheticTester');
    expect(serialized).not.toContain(rawIdentifier);
    expect(serialized).not.toContain('synthetic-server-unreturned-field');
  });

  it('rejects malformed and oversized recommendation requests', async () => {
    const baseUrl = await start();
    const malformed = await fetch(`${baseUrl}/api/recommend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'missing build' }),
    });
    expect(malformed.status).toBe(400);

    const oversized = await fetch(`${baseUrl}/api/recommend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ build: 'x'.repeat(70_000), goals: {} }),
    });
    expect(oversized.status).toBe(413);
  });

  it('does not accept a caller-supplied dataset or remote CORS origin', async () => {
    const baseUrl = await start();
    const unknownField = await fetch(`${baseUrl}/api/recommend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ build: {}, goals: {}, dataset: { injected: true } }),
    });
    expect(unknownField.status).toBe(400);

    const remote = await fetch(`${baseUrl}/api/health`, {
      headers: { origin: 'https://attacker.example' },
    });
    expect(remote.status).toBe(400);
    expect(await remote.text()).not.toContain('attacker.example');
  });
});
