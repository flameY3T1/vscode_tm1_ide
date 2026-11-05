import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', async () => await import('../__mocks__/vscode'));

// `saveServerFromForm` tries to connect at the end — that's not the point here.
vi.mock('../../commands/serverManager/connection', () => ({
  connect: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => {}),
}));

import { saveServerFromForm } from '../../commands/serverManager/form';
import {
  getAllServers,
  saveServers,
  initServerManager,
  type ServerProfile,
} from '../../serverState/state';

function fakeContext() {
  const store = new Map<string, unknown>();
  return {
    globalState: {
      get: (k: string, dflt?: unknown) => (store.has(k) ? store.get(k) : dflt),
      update: async (k: string, v: unknown) => { store.set(k, v); },
    },
    secrets: {
      get: async () => '',
      store: async () => {},
      delete: async () => {},
    },
  } as unknown as import('vscode').ExtensionContext;
}

let ctx: ReturnType<typeof fakeContext>;

const discovered = (): ServerProfile => ({
  id: 'disc:a1:SALES',
  name: 'SALES',
  serverUrl: 'https://old:1',
  username: '',
  rejectUnauthorized: false,
  authType: 'Basic',
  parentAdminId: 'a1',
  discoveredName: 'SALES',
  discoveredUrl: 'https://old:1',
});

beforeEach(async () => {
  ctx = fakeContext();
  initServerManager(ctx);
  await saveServers(ctx, [discovered()]);
});

describe('saveServerFromForm keeps admin-server link', () => {
  it('survives rename and a corrected URL', async () => {
    await saveServerFromForm(ctx, {
      name: 'Produktion Düsseldorf',
      serverUrl: 'https://fixed:9',
      username: 'admin',
      password: 'x',
      rejectUnauthorized: false,
      authType: 'Basic',
    } as never, 'disc:a1:SALES');

    const saved = getAllServers(ctx).find(s => s.id === 'disc:a1:SALES');
    expect(saved).toBeDefined();
    expect(saved?.name).toBe('Produktion Düsseldorf');
    expect(saved?.serverUrl).toBe('https://fixed:9');
    // The admin-server link must survive the rebuild — otherwise the next
    // discovery pass would create a SECOND profile for this instance.
    expect(saved?.parentAdminId).toBe('a1');
    expect(saved?.discoveredName).toBe('SALES');
    expect(saved?.discoveredUrl).toBe('https://old:1');
  });

  it('carries the fields over on a fresh (non-discovered) profile too, as undefined', async () => {
    await saveServerFromForm(ctx, {
      name: 'Neuer Server',
      serverUrl: 'https://new:1',
      username: 'admin',
      password: 'x',
      rejectUnauthorized: false,
      authType: 'Basic',
    } as never);

    const saved = getAllServers(ctx).find(s => s.name === 'Neuer Server');
    expect(saved).toBeDefined();
    expect(saved?.parentAdminId).toBeUndefined();
    expect(saved?.discoveredName).toBeUndefined();
    expect(saved?.discoveredUrl).toBeUndefined();
  });
});
