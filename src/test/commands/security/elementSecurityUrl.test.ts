// URL-key encoding regression tests for src/commands/security/elementSecurity.ts.
//
// `listElementNames` builds `Dimensions(<key>)/Hierarchies(<key>)/Elements`.
// With quote-doubling only, a dim/hier name containing `/` splits the path into
// an extra segment and `#` truncates it as a fragment — Node's WHATWG
// `new URL()` repairs `}` and spaces but never those two.
//
// `listElementNames` is module-private, so we drive it through the real
// `openElementSecurity` and capture the panel-host `onMessage` handler.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tm1Config } from '../../../tm1Rest/transport/types';

const captured = vi.hoisted(() => ({
  onMessage: null as null | ((msg: unknown, panel: unknown) => unknown),
}));

vi.mock('../../../webviews/webviewPanelHost', () => ({
  WebviewPanelHost: class {
    initialize(): void {}
    disposeAll(): void {}
    disposePanelsForServer(): void {}
    reveal(): boolean { return false; }
    open(args: { onMessage: (msg: unknown, panel: unknown) => unknown }): null {
      captured.onMessage = args.onMessage;
      return null;
    }
  },
}));

// State now lives in `serverState/`; the code under test imports it there.
vi.mock('../../../serverState/state', async () => await import('../../../commands/serverManager'));
vi.mock('../../../commands/serverManager', () => ({
  getServerConfig: vi.fn(() => ({ serverUrl: 'http://tm1:8000' } as Tm1Config)),
  getServerNameByUrl: vi.fn(() => 'TestSrv'),
}));

vi.mock('../../../commands/cubeViewer/manager', () => ({
  CubeViewerManager: { open: vi.fn() },
}));

vi.mock('../../../security/api/groupsApi', () => ({
  listGroups: vi.fn(async () => []),
}));

vi.mock('../../../security/api/elementSecurityApi', () => ({
  cubeExists: vi.fn(async () => true),
  createElementSecurityCube: vi.fn(),
  fetchElementPerms: vi.fn(async () => ({})),
  updateElementPerms: vi.fn(),
}));

vi.mock('../../../security/core/v12Adapter', () => ({
  detectMode: vi.fn(async () => 'v11'),
}));

vi.mock('../../../tm1Rest/client', () => ({ apiRequest: vi.fn() }));

import { apiRequest } from '../../../tm1Rest/client';
import { openElementSecurity } from '../../../commands/security/elementSecurity';

const fakePanel = { webview: { postMessage: vi.fn() } };

/** Open the panel for `dimName`, run the `ready` handler, return the Elements GET URL. */
async function elementsUrlFor(dimName: string): Promise<string> {
  captured.onMessage = null;
  vi.mocked(apiRequest).mockResolvedValue({
    statusCode: 200,
    body: JSON.stringify({ value: [{ Name: 'Europe' }] }),
  });
  await openElementSecurity('srv1', dimName);
  expect(captured.onMessage).toBeTypeOf('function');
  await captured.onMessage!({ type: 'ready' }, fakePanel);
  return vi.mocked(apiRequest).mock.calls[0][1] as string;
}

describe('elementSecurity listElementNames URL keys', () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    fakePanel.webview.postMessage.mockReset();
  });

  it('plain dim name → unchanged path (byte-identical to the old behaviour)', async () => {
    const url = await elementsUrlFor('Region');
    expect(url).toBe("Dimensions('Region')/Hierarchies('Region')/Elements?$select=Name");
  });

  it('percent-encodes path-breaking chars in dim AND hier key', async () => {
    // listDefaultHier returns the dim name → both keys carry the same payload.
    const url = await elementsUrlFor("A/B#C?D'E F");
    expect(url).toBe(
      "Dimensions('A%2FB%23C%3FD''E%20F')/Hierarchies('A%2FB%23C%3FD''E%20F')/Elements?$select=Name",
    );
    // `/` must not open a new path segment, `#` must not start a fragment.
    expect(url.split('/')).toHaveLength(3);
    expect(url).not.toContain('#');
  });

  it('a }-prefixed dim encodes exactly once (no %257D double-encode)', async () => {
    const url = await elementsUrlFor('}Groups');
    expect(url).toBe("Dimensions('%7DGroups')/Hierarchies('%7DGroups')/Elements?$select=Name");
    expect(url).not.toContain('%257D');
  });
});
