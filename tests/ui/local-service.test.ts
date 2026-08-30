// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { demoBuild, demoGoals } from '../../src/fixtures/datasets';
import {
  isLocalServiceAllowed,
  readLocalServiceStatus,
  requestLocalRecommendation,
} from '../../src/ui/local-service';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('local service browser boundary', () => {
  it('allows only loopback hosts and reads readiness without making a provider request', async () => {
    expect(isLocalServiceAllowed('127.0.0.1')).toBe(true);
    expect(isLocalServiceAllowed('ronaldoj24.github.io')).toBe(false);
    const fetcher = vi.fn(async () =>
      jsonResponse({
        status: 'ok',
        service: 'loadout-atelier',
        mode: 'live',
        dataMode: 'live',
        provider: 'available',
      }),
    );

    await expect(readLocalServiceStatus({ fetcher: fetcher as typeof fetch })).resolves.toEqual({
      mode: 'live',
      providerAvailable: true,
    });
    expect(fetcher).toHaveBeenCalledWith('/api/health', expect.objectContaining({ method: 'GET' }));
  });

  it('rejects an invalid recommendation response and sends only validated build and goals', async () => {
    let sentBody: unknown;
    const fetcher = vi.fn(async (_path: string | URL | Request, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return jsonResponse({ status: 'recommended', origin: 'ai-assisted' });
    });

    await expect(
      requestLocalRecommendation(demoBuild, demoGoals, { fetcher: fetcher as typeof fetch }),
    ).rejects.toThrow('invalid recommendation');
    expect(sentBody).toEqual({ build: demoBuild, goals: demoGoals });
  });
});
