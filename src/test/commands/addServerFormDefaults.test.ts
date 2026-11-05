// src/test/commands/addServerFormDefaults.test.ts
//
// Click test feedback, round B/2 ("when I switch between admin and instance
// and it is EMPTY, show the example per kind"): the field was never empty,
// because DEFAULTS/ADMIN_DEFAULTS prefilled a real serverUrl — so the
// placeholder from src/webviewClient/addServer/index.ts never took
// effect. This test runs the real `openAddServerPanel`/
// `openAddAdminServerPanel`/`openEditServerPanel` path end-to-end (mocked
// vscode + WebviewPanelHost) and checks the `init` messages actually posted
// instead of just scanning source text.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', async () => await import('../__mocks__/vscode'));

const getServerFormDataSpy = vi.hoisted(() => vi.fn());
vi.mock('../../commands/serverManager', () => ({
  testServerConnection: vi.fn(),
  saveServerFromForm: vi.fn(),
  getServerFormData: getServerFormDataSpy,
  deleteServer: vi.fn(),
  confirmInsecureSave: vi.fn(),
}));

import * as vscode from 'vscode';
import type { MockWebviewPanel } from '../__mocks__/vscode';
import {
  initializeAddServerPanel,
  openAddServerPanel,
  openAddAdminServerPanel,
  openEditServerPanel,
} from '../../commands/serverConfig/addServerPanel';
import type { HostToWebview, ServerFormData } from '../../webviewClient/addServer/protocol';

const EXT_URI = vscode.Uri.file('/ext');

function fakeContext(): vscode.ExtensionContext {
  return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

/** Opens via the given opener, sends the webview's `ready`, and returns the posted `init` message. */
function openAndGetInit(open: () => void | Promise<void>): Promise<Extract<HostToWebview, { type: 'init' }>> {
  return (async () => {
    await open();
    const panel = (vscode.window.createWebviewPanel as unknown as ReturnType<typeof vi.fn>).mock
      .results.at(-1)!.value as MockWebviewPanel;
    panel.simulateMessage({ type: 'ready' });
    const post = panel.webview.postMessage as unknown as ReturnType<typeof vi.fn>;
    const initCall = post.mock.calls.find((c) => (c[0] as HostToWebview).type === 'init');
    expect(initCall).toBeDefined();
    return initCall![0] as Extract<HostToWebview, { type: 'init' }>;
  })();
}

describe('add-server dialog: the example URL lives ONLY in the placeholder, not in the value', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeAddServerPanel(EXT_URI);
    getServerFormDataSpy.mockReset();
  });

  it('tm1.addServer (instance): serverUrl is empty', async () => {
    const ctx = fakeContext();
    const init = await openAndGetInit(() => openAddServerPanel(ctx));
    expect(init.mode).toBe('add');
    expect(init.kind).toBeUndefined();
    expect((init.data as ServerFormData).serverUrl).toBe('');
  });

  it('tm1.adminServer.add: serverUrl is empty as well, kind is "admin"', async () => {
    const ctx = fakeContext();
    const init = await openAndGetInit(() => openAddAdminServerPanel(ctx));
    expect(init.mode).toBe('add');
    expect(init.kind).toBe('admin');
    expect((init.data as ServerFormData).serverUrl).toBe('');
  });

  it('edit mode: serverUrl is unchanged that of the existing profile, not empty', async () => {
    getServerFormDataSpy.mockResolvedValue({
      name: 'Prod',
      serverUrl: 'https://prod.example.com:8010',
      username: 'admin',
      password: '',
      authType: 'Basic',
      camNamespace: '',
      rejectUnauthorized: true,
      version: 'v11',
    } satisfies ServerFormData);
    const ctx = fakeContext();
    const init = await openAndGetInit(() => openEditServerPanel(ctx, 'srv-1'));
    expect(init.mode).toBe('edit');
    expect((init.data as ServerFormData).serverUrl).toBe('https://prod.example.com:8010');
  });
});
