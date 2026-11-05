import { describe, it, expect } from 'vitest';
import { runMigrationChain, STATE_VERSION_KEY } from '../commands/serverManager/migrations';

function memento(init: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(init));
  return {
    store,
    get: <T>(k: string) => store.get(k) as T | undefined,
    update: (k: string, v: unknown) => { store.set(k, v); return Promise.resolve(); },
  };
}

describe('runMigrationChain', () => {
  it('runs only the steps above the stored version, in order, and stores the version', async () => {
    const ran: number[] = [];
    const steps = [1, 2, 3].map(n => async () => { ran.push(n); });

    const fresh = memento();
    await runMigrationChain(fresh, steps);
    expect(ran).toEqual([1, 2, 3]);
    expect(fresh.store.get(STATE_VERSION_KEY)).toBe(3);

    ran.length = 0;
    const atOne = memento({ [STATE_VERSION_KEY]: 1 });
    await runMigrationChain(atOne, steps);
    expect(ran).toEqual([2, 3]);

    ran.length = 0;
    await runMigrationChain(atOne, steps);
    expect(ran).toEqual([]);
  });

  it('a failing step keeps the version below it so it is retried next time', async () => {
    const m = memento();
    const steps = [async () => {}, async () => { throw new Error('boom'); }, async () => {}];
    await expect(runMigrationChain(m, steps)).rejects.toThrow('boom');
    expect(m.store.get(STATE_VERSION_KEY)).toBe(1);
  });
});
