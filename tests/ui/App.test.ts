// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluationScenarios } from '../../src/evals/harness';
import { App } from '../../src/ui/App';

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
    },
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('Loadout Atelier UI', () => {
  it('renders the seeded offline workspace and a deterministic recommendation', () => {
    render(createElement(App));

    expect(screen.getByRole('heading', { name: 'Aegis Relay' })).toBeTruthy();
    expect(screen.getByText('FIXTURE · OFFLINE')).toBeTruthy();
    expect(screen.getByText('Build is valid')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Generate recommendation/i }));

    expect(screen.getByText('RECOMMENDED')).toBeTruthy();
    expect(screen.getByText('Changed slots')).toBeTruthy();
  });

  it('surfaces an invalid equipment state and replays the shared evaluation case', async () => {
    render(createElement(App));

    fireEvent.change(screen.getByRole('combobox', { name: 'Weapon item' }), {
      target: { value: '' },
    });
    expect(screen.getByText('Build needs attention')).toBeTruthy();
    expect(screen.getByText('missing item')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Evaluation desk/i }));
    expect(screen.getByRole('heading', { name: 'Scenario replay' })).toBeTruthy();
    expect(
      screen.getAllByRole('button').filter((button) => button.classList.contains('scenario-card')),
    ).toHaveLength(evaluationScenarios.length);
    fireEvent.click(screen.getByRole('button', { name: /Missing Equipment/i }));
    fireEvent.click(screen.getByRole('button', { name: /Run selected scenario/i }));
    expect(screen.getByRole('heading', { name: /local scenario outcome/i })).toBeTruthy();
    expect(await screen.findByText('Missing weapon rejected.')).toBeTruthy();
    expect(screen.getByText('PASSED')).toBeTruthy();
    expect(screen.getByText(/not a claim about production accuracy/i)).toBeTruthy();
  });

  it('drops hidden abilities when the selected class changes', () => {
    render(createElement(App));

    expect(screen.getByText('4 selected')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'archer' } });
    expect(screen.getByText('0 selected')).toBeTruthy();
  });

  it('ignores malformed browser saves at the schema boundary', () => {
    window.localStorage.setItem(
      'loadout-atelier.saved-builds.v1',
      JSON.stringify([{ id: 'bad', savedAt: 'not-a-date', build: { name: 'unsafe' }, goals: {} }]),
    );
    render(createElement(App));

    expect(screen.getByRole('alert').textContent).toContain('invalid local saves were ignored');
    expect(screen.queryByText('unsafe')).toBeNull();
  });

  it('clears a stale recommendation when a control changes and reports save validation errors', () => {
    render(createElement(App));

    fireEvent.click(screen.getByRole('button', { name: /Generate recommendation/i }));
    expect(screen.getByText('Changed slots')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Weapon item' }), {
      target: { value: 'bastion-rod' },
    });
    expect(screen.queryByText('Changed slots')).toBeNull();

    fireEvent.change(screen.getByLabelText('Build name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Save current/i }));
    expect(screen.getByRole('alert').textContent).toContain('Could not save');
  });

  it('round-trips a schema-valid build through local storage', () => {
    render(createElement(App));

    fireEvent.click(screen.getByRole('button', { name: /Save current/i }));
    const savedBuildButton = screen
      .getAllByRole('button', { name: /Aegis Relay/ })
      .find((button) => !button.classList.contains('delete-button'));
    expect(savedBuildButton).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'archer' } });
    expect((screen.getByLabelText('Class') as HTMLSelectElement).value).toBe('archer');
    fireEvent.click(savedBuildButton!);
    expect((screen.getByLabelText('Class') as HTMLSelectElement).value).toBe('mage');
  });

  it('keeps hosted profile names ephemeral and never sends or exports them', async () => {
    const profileFetch = vi.fn();
    let exportBlob: Blob | null = null;
    const previousCreateObjectURL = URL.createObjectURL;
    const previousRevokeObjectURL = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: (blob: Blob) => {
        exportBlob = blob;
        return 'blob:loadout-atelier-test';
      },
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: () => undefined,
    });

    try {
      render(
        createElement(App, {
          profileImportEnabled: false,
          profileFetch: profileFetch as typeof fetch,
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Import public profile' }));
      const input = screen.getByLabelText('Public player name') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'Example_1' } });
      fireEvent.submit(screen.getByRole('form', { name: 'Import public profile' }));

      expect(await screen.findByText('Fixture-only mode')).toBeTruthy();
      expect(profileFetch).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: /Save current/i }));
      expect(window.localStorage.getItem('loadout-atelier.saved-builds.v1')).not.toContain(
        'Example_1',
      );
      fireEvent.click(screen.getByRole('button', { name: /Export build summary/i }));
      expect(exportBlob).toBeTruthy();
      expect(await exportBlob!.text()).not.toContain('Example_1');

      fireEvent.click(screen.getByRole('button', { name: 'Clear name and result' }));
      expect(input.value).toBe('');
    } finally {
      if (previousCreateObjectURL) {
        Object.defineProperty(URL, 'createObjectURL', {
          configurable: true,
          value: previousCreateObjectURL,
        });
      } else {
        delete (URL as { createObjectURL?: typeof URL.createObjectURL }).createObjectURL;
      }
      if (previousRevokeObjectURL) {
        Object.defineProperty(URL, 'revokeObjectURL', {
          configurable: true,
          value: previousRevokeObjectURL,
        });
      } else {
        delete (URL as { revokeObjectURL?: typeof URL.revokeObjectURL }).revokeObjectURL;
      }
    }
  });

  it('previews identity-free live metadata without mutating the manual build', async () => {
    const profileFetch = vi.fn<typeof fetch>(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            mode: 'live',
            data: {
              status: 'public',
              online: true,
              characterCount: 2,
              characterData: 'available',
              characters: [
                { classId: 'mage', level: 90 },
                { classId: 'warrior', level: 80 },
              ],
            },
            trace: { mode: 'live', status: 'ok', durationMs: 12 },
          }),
        }) as Response,
    );
    render(
      createElement(App, {
        profileImportEnabled: true,
        profileFetch: profileFetch as typeof fetch,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Import public profile' }));
    fireEvent.change(screen.getByLabelText('Public player name'), {
      target: { value: ' Example_1 ' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Import public profile' }));

    expect(await screen.findByText('Complete public metadata')).toBeTruthy();
    expect(
      screen.getByText(
        'Preview only. Select equipment and abilities manually in the build laboratory.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Characters').parentElement?.textContent).toContain('2');
    expect(screen.getByRole('combobox', { name: 'Weapon item' })).toBeTruthy();
    expect(profileFetch).toHaveBeenCalledTimes(1);
    expect(String(profileFetch.mock.calls[0]?.[0])).toBe('/api/profile');
    expect(profileFetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ playerName: 'Example_1' }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close public profile preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import public profile' }));
    expect((screen.getByLabelText('Public player name') as HTMLInputElement).value).toBe('');
  });

  it('offers generic character previews and applies only class, level, and compatible abilities', async () => {
    const profileFetch = vi.fn(
      async () =>
        ({
          status: 200,
          json: async () => ({
            mode: 'live',
            data: {
              status: 'public',
              online: null,
              characterCount: 3,
              characterData: 'available',
              characters: [
                { classId: 'archer', level: 77 },
                { classId: 'archer', level: 77 },
                { classId: 'mage', level: 91 },
              ],
            },
          }),
        }) as Response,
    );
    render(
      createElement(App, {
        profileImportEnabled: true,
        profileFetch: profileFetch as typeof fetch,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Generate recommendation/i }));
    expect(screen.getByText('Changed slots')).toBeTruthy();
    const weapon = screen.getByRole('combobox', { name: 'Weapon item' }) as HTMLSelectElement;
    const originalWeapon = weapon.value;

    fireEvent.click(screen.getByRole('button', { name: 'Import public profile' }));
    fireEvent.change(screen.getByLabelText('Public player name'), {
      target: { value: 'Example_1' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Import public profile' }));

    expect(await screen.findByText('Character previews')).toBeTruthy();
    expect(screen.getByText('Character 1')).toBeTruthy();
    expect(screen.getByText('Character 2')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Use Archer level 77/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Use Archer level 77 from Character 1' }));

    expect((screen.getByLabelText('Class') as HTMLSelectElement).value).toBe('archer');
    expect((screen.getByLabelText('Level') as HTMLInputElement).value).toBe('77');
    expect(weapon.value).toBe(originalWeapon);
    expect(screen.getByText('0 selected')).toBeTruthy();
    expect(screen.getByText('Build needs attention')).toBeTruthy();
    expect(screen.queryByText('Changed slots')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Save current/i }));
    expect(window.localStorage.getItem('loadout-atelier.saved-builds.v1')).not.toContain(
      'Example_1',
    );
  });

  it('fails closed for inconsistent restricted character data', async () => {
    const profileFetch = vi.fn(
      async () =>
        ({
          status: 200,
          json: async () => ({
            mode: 'live',
            data: {
              status: 'partial',
              online: null,
              characterCount: null,
              characterData: 'restricted',
              characters: [{ classId: 'mage', level: 90 }],
            },
          }),
        }) as Response,
    );
    render(
      createElement(App, {
        profileImportEnabled: true,
        profileFetch: profileFetch as typeof fetch,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Import public profile' }));
    fireEvent.change(screen.getByLabelText('Public player name'), {
      target: { value: 'Example_1' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Import public profile' }));

    expect(await screen.findByText('Lookup unavailable')).toBeTruthy();
    expect(screen.queryByText('Character previews')).toBeNull();
  });

  it('does not silently clamp a live level beyond the fixture contract', async () => {
    const profileFetch = vi.fn(
      async () =>
        ({
          status: 200,
          json: async () => ({
            mode: 'live',
            data: {
              status: 'public',
              online: null,
              characterCount: 1,
              characterData: 'available',
              characters: [{ classId: 'mage', level: 120 }],
            },
          }),
        }) as Response,
    );
    render(
      createElement(App, {
        profileImportEnabled: true,
        profileFetch: profileFetch as typeof fetch,
      }),
    );
    const originalLevel = (screen.getByLabelText('Level') as HTMLInputElement).value;
    fireEvent.click(screen.getByRole('button', { name: 'Import public profile' }));
    fireEvent.change(screen.getByLabelText('Public player name'), {
      target: { value: 'Example_1' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Import public profile' }));

    const unsupported = await screen.findByRole('button', {
      name: /exceeds this fixture's supported level/i,
    });
    expect((unsupported as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Level') as HTMLInputElement).value).toBe(originalLevel);
  });

  it('surfaces an ambiguous public name without importing anything', async () => {
    const profileFetch = vi.fn(
      async () => ({ status: 409, json: async () => ({ error: 'ambiguous' }) }) as Response,
    );
    render(
      createElement(App, {
        profileImportEnabled: true,
        profileFetch: profileFetch as typeof fetch,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Import public profile' }));
    fireEvent.change(screen.getByLabelText('Public player name'), {
      target: { value: 'Example_1' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Import public profile' }));

    expect(await screen.findByText('Player name ambiguous')).toBeTruthy();
    expect(screen.getByText(/nothing was imported/i)).toBeTruthy();
    expect(profileFetch).toHaveBeenCalledTimes(1);
  });

  it('aborts an in-flight local lookup when the preview is cleared', () => {
    let requestSignal: AbortSignal | undefined;
    const profileFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    render(
      createElement(App, {
        profileImportEnabled: true,
        profileFetch: profileFetch as typeof fetch,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Import public profile' }));
    fireEvent.change(screen.getByLabelText('Public player name'), {
      target: { value: 'Example_1' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Import public profile' }));
    expect(screen.getByText('Checking public profile metadata…')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear name and result' }));
    expect((screen.getByLabelText('Public player name') as HTMLInputElement).value).toBe('');
    expect(requestSignal?.aborted).toBe(true);
  });
});
