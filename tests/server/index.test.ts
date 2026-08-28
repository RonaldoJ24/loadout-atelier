import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, startServer } from '../../server/index';

const servers: Array<ReturnType<ReturnType<typeof createApp>['listen']>> = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function start() {
  const server = createApp({ mode: 'fixture' }).listen(0, '127.0.0.1');
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

  it('returns only the synthetic profile in fixture mode', async () => {
    const baseUrl = await start();
    const response = await fetch(`${baseUrl}/api/profile/SyntheticTester`);
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ mode: 'fixture' });
    expect(JSON.stringify(body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
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
