// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    ).toHaveLength(34);
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
});
