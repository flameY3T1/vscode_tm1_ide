import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('../debug/tm1DebugClient', async (orig) => ({ ...(await orig<typeof import('../debug/tm1DebugClient')>()), Tm1DebugClient: class {} }));
vi.mock('../commands/processEditor/save', () => ({
  handleMonacoSave: vi.fn(),
  handleMonacoSaveAs: vi.fn(),
}));
vi.mock('../commands/processEditor/debug', () => ({
  handleDebugCommand: vi.fn(),
  handleDebugStart: vi.fn(),
  handleBreakpoint: vi.fn(),
  handleBreakpointCondition: vi.fn(),
}));
vi.mock('../commands/processEditor/asciiPreview', () => ({
  handleAsciiPreview: vi.fn(),
}));
vi.mock('../commands/processEditor/processParams', () => ({
  showServerParameterForm: vi.fn(),
}));
vi.mock('../commands/processEditor/processEditorUtils', () => ({
  getPanelTitle: (name: string, dirty: boolean, _label?: string) => `${dirty ? '● ' : ''}${name}`,
  // `monacoReady` sends the panel its v12 state along; the name of the
  // deprecated list travels with it.
  getV12DeprecatedNames: () => [],
}));
vi.mock('../commands/processEditor/processEditorLint', () => ({
  lintAllSections: vi.fn(),
}));
vi.mock('../commands/processEditor/messagingLog', () => ({
  logFetchError: vi.fn(),
}));
vi.mock('../tm1Client', () => ({
  apiRequest: vi.fn(),
  executeProcess: vi.fn(),
}));
// tm1Rest/ modules import tm1Rest/client directly; same doubles there (docs/architecture/import-rules.md).
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));
vi.mock('../tm1Rest/processApi', () => ({
  listProcesses: vi.fn(),
}));
vi.mock('../tm1Rest/cubeApi', () => ({
  getCubeViewNames: vi.fn(),
  getCubeDimensionNames: vi.fn(),
  listCubes: vi.fn(),
}));
vi.mock('../tm1Rest/subsetApi', () => ({
  listPublicSubsetNames: vi.fn(),
}));
vi.mock('../providers/fetchNames', () => ({
  fetchNames: vi.fn(),
}));
vi.mock('../references/resolverView', () => ({
  buildResolverView: vi.fn(),
  lookupIdentifierInfo: vi.fn(),
}));
vi.mock('../commands/processEditor/openPanel', () => ({
  openProcess: vi.fn(),
}));
vi.mock('../commands/processEditor/recentBridge', () => ({
  recordProcessOpen: vi.fn(),
}));
// State now lives in `serverState/`; the code under test imports it there.
vi.mock('../serverState/state', async () => await import('../commands/serverManager'));
vi.mock('../commands/serverManager', () => ({
  getServerIdByUrl: vi.fn(),
}));

import { handleMessage } from '../commands/processEditor/messaging';
import { _sessions, type PanelSession } from '../commands/processEditor/state';
import { testSession } from './helpers/processEditorSession';
import { lintAllSections } from '../commands/processEditor/processEditorLint';
import { fetchNames } from '../providers/fetchNames';
import { getCubeViewNames, getCubeDimensionNames, listCubes } from '../tm1Rest/cubeApi';
import { listPublicSubsetNames } from '../tm1Rest/subsetApi';
import { listProcesses } from '../tm1Rest/processApi';
import { apiRequest } from '../tm1Client';
import { buildResolverView, lookupIdentifierInfo } from '../references/resolverView';
import { handleMonacoSave, handleMonacoSaveAs } from '../commands/processEditor/save';
import { handleAsciiPreview } from '../commands/processEditor/asciiPreview';
import { handleDebugCommand, handleBreakpoint, handleDebugStart } from '../commands/processEditor/debug';
import { openProcess } from '../commands/processEditor/openPanel';
import { recordProcessOpen } from '../commands/processEditor/recentBridge';
import { getServerIdByUrl } from '../commands/serverManager';

const CONFIG = {
  serverUrl: 'http://tm1:8001',
  username: 'admin',
  password: 'p',
  rejectUnauthorized: false,
  authType: 'Basic' as const,
};
const EMPTY_SECTIONS = { prolog: '', metadata: '', data: '', epilog: '' };
const KEY = 'srv::TestProcess';
const REOPEN = vi.fn();

function makePanel(): vscode.WebviewPanel {
  return {
    title: 'Test',
    webview: {
      postMessage: vi.fn().mockResolvedValue(true),
      html: '',
      onDidReceiveMessage: vi.fn(),
    },
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
    reveal: vi.fn(),
  } as unknown as vscode.WebviewPanel;
}

function posted(panel: vscode.WebviewPanel) {
  return (panel.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
}

beforeEach(() => {
  vi.resetAllMocks();
  REOPEN.mockResolvedValue(undefined);
  _sessions.clear();
});

describe('handleMessage — processEditor', () => {
  it('ignores null message', async () => {
    const panel = makePanel();
    await expect(
      handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), null as any, REOPEN),
    ).resolves.toBeUndefined();
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
  });

  it('ignores message without type', async () => {
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), {} as any, REOPEN);
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
  });

  // ─── openProcess (Ctrl/Cmd+click on an ExecuteProcess/RunProcess name) ──────

  it('openProcess — opens the target and records it in "Recently opened"', async () => {
    vi.mocked(getServerIdByUrl).mockReturnValue('srv-1');
    vi.mocked(openProcess).mockResolvedValue(true);
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'openProcess', name: 'SubProc' } as any, REOPEN);
    expect(openProcess).toHaveBeenCalledWith('SubProc', undefined, CONFIG);
    expect(getServerIdByUrl).toHaveBeenCalledWith(CONFIG.serverUrl);
    expect(recordProcessOpen).toHaveBeenCalledWith('srv-1', 'SubProc');
  });

  it('openProcess — records NOTHING when the process failed to open', async () => {
    // Ctrl+click on a typo'd / unreadable process: openProcess shows an error
    // toast and disposes the panel, so there is no editor. Recording it anyway
    // would push a dead entry into the 5-slot Recent list and evict a real one.
    vi.mocked(getServerIdByUrl).mockReturnValue('srv-1');
    vi.mocked(openProcess).mockResolvedValue(false);
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'openProcess', name: 'Typo.Proc' } as any, REOPEN);
    expect(openProcess).toHaveBeenCalledWith('Typo.Proc', undefined, CONFIG);
    expect(recordProcessOpen).not.toHaveBeenCalled();
  });

  it('openProcess — still opens when the server is not in the connected map', async () => {
    // getServerIdByUrl misses (profile disconnected): navigation must not break,
    // the Recent entry is simply skipped (recordProcessOpen no-ops on undefined).
    vi.mocked(getServerIdByUrl).mockReturnValue(undefined);
    vi.mocked(openProcess).mockResolvedValue(true);
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'openProcess', name: 'SubProc' } as any, REOPEN);
    expect(openProcess).toHaveBeenCalledWith('SubProc', undefined, CONFIG);
    expect(recordProcessOpen).toHaveBeenCalledWith(undefined, 'SubProc');
  });

  it('openProcess — ignores a blank name', async () => {
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'openProcess', name: '   ' } as any, REOPEN);
    expect(openProcess).not.toHaveBeenCalled();
    expect(recordProcessOpen).not.toHaveBeenCalled();
  });

  // ─── monacoReady ────────────────────────────────────────────────────────────

  // Hydration requires stored process data. Seed empty-but-present code so
  // hydratePanel runs (mirrors the real flow where openProcess stores data).
  const seedCode = (session: PanelSession) => { session.code = {
    prolog: '', metadata: '', data: '', epilog: '', parameters: [], variables: [], hasSecurity: false,
  }; };

  it('monacoReady before data loads — defers (posts no content, records readiness, not hydrated)', async () => {
    // No _processCodeData yet: an early monacoReady must NOT blank the editor.
    // The v12 state still goes out — it belongs to the panel, not to the
    // content, and completion needs it from the first keystroke.
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'monacoReady' }, REOPEN);
    expect(posted(panel).map((m: { type?: string }) => m.type)).toEqual(['v12ModeChanged']);
    expect(testSession(panel, KEY, 'Proc', 'srv', CONFIG).ready).toBe(true);
    expect(testSession(panel, KEY, 'Proc', 'srv', CONFIG).hydrated).toBe(false);
  });

  it('monacoReady — seeds stored process code into messages', async () => {
    const panel = makePanel();
    testSession(panel, KEY, 'Proc', 'srv', CONFIG).code = {
      prolog: 'pCode', metadata: 'mCode', data: 'dCode', epilog: 'eCode',
      parameters: [], variables: [], hasSecurity: false,
    };
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'monacoReady' }, REOPEN);
    expect(posted(panel)).toContainEqual(expect.objectContaining({
      type: 'monacoSetContent',
      sections: { prolog: 'pCode', metadata: 'mCode', data: 'dCode', epilog: 'eCode' },
    }));
    expect(testSession(panel, KEY, 'Proc', 'srv', CONFIG).hydrated).toBe(true);
  });

  it('monacoReady re-hydrates on a webview reload (second monacoReady re-posts content)', async () => {
    // Regression: the _hydratedPanels idempotency guard must not suppress the
    // legitimate re-hydrate when the webview reloads (re-fires monacoReady) without
    // the panel being disposed (e.g. "Developer: Reload Webviews").
    const panel = makePanel();
    testSession(panel, KEY, 'Proc', 'srv', CONFIG).code = {
      prolog: 'pCode', metadata: '', data: '', epilog: '', parameters: [], variables: [], hasSecurity: false,
    };
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'monacoReady' }, REOPEN);
    expect(testSession(panel, KEY, 'Proc', 'srv', CONFIG).hydrated).toBe(true);
    (panel.webview.postMessage as ReturnType<typeof vi.fn>).mockClear();
    // Webview reloaded: same (undisposed) panel fires monacoReady again.
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'monacoReady' }, REOPEN);
    expect(posted(panel)).toContainEqual(expect.objectContaining({
      type: 'monacoSetContent',
      sections: { prolog: 'pCode', metadata: '', data: '', epilog: '' },
    }));
  });

  it('monacoReady — flushes pending debug state and removes it', async () => {
    const debugMsg = { type: 'debugStateUpdate' as const, section: 'Prolog', line: 3 };
    const panel = makePanel();
    seedCode(testSession(panel, KEY, 'Proc', 'srv', CONFIG));
    testSession(panel, KEY, 'Proc', 'srv', CONFIG).pendingDebugState = debugMsg;
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'monacoReady' }, REOPEN);
    expect(posted(panel)).toContainEqual(debugMsg);
    expect(testSession(panel, KEY, 'Proc', 'srv', CONFIG).pendingDebugState).toBeUndefined();
  });

  it('monacoReady — sends exactly 9 messages when no pending debug state', async () => {
    const panel = makePanel();
    seedCode(testSession(panel, KEY, 'Proc', 'srv', CONFIG));
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'monacoReady' }, REOPEN);
    expect(posted(panel)).toHaveLength(9);
  });

  it('monacoReady — sends the user snippets along', async () => {
    // The webview keeps a list of its own; without this message it knows no
    // snippets when it opens. Exactly that was missing until 2026-08-29 — the
    // wire up to `state.ts#_getSnippets` was laid, only nobody read it.
    const panel = makePanel();
    seedCode(testSession(panel, KEY, 'Proc', 'srv', CONFIG));
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'monacoReady' }, REOPEN);
    expect(posted(panel).map((m: { type: string }) => m.type)).toContain('snippets');
  });

  it('monacoReady — reports the v12 mode before the content arrives', async () => {
    const panel = makePanel();
    seedCode(testSession(panel, KEY, 'Proc', 'srv', CONFIG));
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'monacoReady' }, REOPEN);
    const types = posted(panel).map((m: { type?: string }) => m.type);
    // The order matters: the state decides which functions completion offers,
    // and it must not trail behind the content.
    expect(types[0]).toBe('v12ModeChanged');
  });

  it('monacoReady — includes a monacoSetSecurity message', async () => {
    const panel = makePanel();
    seedCode(testSession(panel, KEY, 'Proc', 'srv', CONFIG));
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'monacoReady' }, REOPEN);
    expect(posted(panel).some((m: { type?: string }) => m.type === 'monacoSetSecurity')).toBe(true);
  });

  it('monacoReady — includes a formatConfig message', async () => {
    const panel = makePanel();
    seedCode(testSession(panel, KEY, 'Proc', 'srv', CONFIG));
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'monacoReady' }, REOPEN);
    expect(posted(panel).some((m: { type?: string }) => m.type === 'formatConfig')).toBe(true);
  });

  // ─── monacoContentChanged ────────────────────────────────────────────────────

  it('monacoContentChanged — marks dirty and updates panel title', async () => {
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'monacoContentChanged' }, REOPEN);
    expect(testSession(panel, KEY, 'Proc', 'srv', CONFIG).dirty).toBe(true);
    expect(panel.title).toContain('●');
  });

  it('monacoContentChanged — does not update title when already dirty', async () => {
    const panel = makePanel();
    testSession(panel, KEY, 'Proc', 'srv', CONFIG).dirty = true;
    panel.title = 'Original Title';
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'monacoContentChanged' }, REOPEN);
    expect(panel.title).toBe('Original Title');
  });

  // ─── clipboard ───────────────────────────────────────────────────────────────

  it('requestPaste — posts clipboard text to webview', async () => {
    (vscode.env.clipboard.readText as ReturnType<typeof vi.fn>).mockResolvedValue('pasted');
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'requestPaste' }, REOPEN);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'pasteText', text: 'pasted' });
  });

  it('requestPaste — posts empty string on clipboard read failure', async () => {
    (vscode.env.clipboard.readText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no access'));
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'requestPaste' }, REOPEN);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'pasteText', text: '' });
  });

  it('requestCopy — writes text to clipboard', async () => {
    (vscode.env.clipboard.writeText as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'requestCopy', text: 'to-copy' }, REOPEN);
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('to-copy');
  });

  // ─── openExternal ────────────────────────────────────────────────────────────

  // What is checked is the TARGET, not just the call: `openExternal` receives a
  // `Uri`, not a string, and a URL that is cut off at the wrong place or mixed
  // up does not stand out with `toHaveBeenCalled()` alone.
  it('openExternal — opens valid https URL', async () => {
    (vscode.env.openExternal as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'openExternal', url: 'https://example.com/docs' }, REOPEN);
    expect(vscode.env.openExternal).toHaveBeenCalledWith(vscode.Uri.parse('https://example.com/docs'));
  });

  it('openExternal — opens valid http URL', async () => {
    (vscode.env.openExternal as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'openExternal', url: 'http://intranet/docs' }, REOPEN);
    expect(vscode.env.openExternal).toHaveBeenCalledWith(vscode.Uri.parse('http://intranet/docs'));
  });

  it('openExternal — rejects non-http URL (security guard)', async () => {
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'openExternal', url: 'file:///etc/passwd' }, REOPEN);
    expect(vscode.env.openExternal).not.toHaveBeenCalled();
  });

  it('openExternal — rejects javascript: URL', async () => {
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'openExternal', url: 'javascript:alert(1)' }, REOPEN);
    expect(vscode.env.openExternal).not.toHaveBeenCalled();
  });

  // ─── REST fetch cases ─────────────────────────────────────────────────────────

  it('fetchCubes — posts sorted cube list', async () => {
    (fetchNames as ReturnType<typeof vi.fn>).mockResolvedValue(['Zebra', 'Alpha', 'Middle']);
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'fetchCubes' }, REOPEN);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'cubeList', cubes: ['Alpha', 'Middle', 'Zebra'] });
  });

  it('fetchCubes — posts empty list on fetch error', async () => {
    (fetchNames as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('net'));
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'fetchCubes' }, REOPEN);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'cubeList', cubes: [] });
  });

  it('fetchViews — posts sorted view list for named cube', async () => {
    (getCubeViewNames as ReturnType<typeof vi.fn>).mockResolvedValue(['View2', 'View1']);
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'fetchViews', cubeName: 'SalesCube' }, REOPEN);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'viewList', cubeName: 'SalesCube', views: ['View1', 'View2'],
    });
  });

  it('fetchDimensions — posts sorted dimension list', async () => {
    (fetchNames as ReturnType<typeof vi.fn>).mockResolvedValue(['Region', 'Account', 'Period']);
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'fetchDimensions' }, REOPEN);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'dimensionList', dimensions: ['Account', 'Period', 'Region'],
    });
  });

  it('fetchSubsets — posts sorted subset list for dimension', async () => {
    (listPublicSubsetNames as ReturnType<typeof vi.fn>).mockResolvedValue(['Sub2', 'Sub1']);
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'fetchSubsets', dimensionName: 'Region' }, REOPEN);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'subsetList', dimensionName: 'Region', subsets: ['Sub1', 'Sub2'],
    });
  });

  it('fetchOdbcDsns — parses apiRequest response into sorted list', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ value: [{ Name: 'DSN_B' }, { Name: 'DSN_A' }] }),
    });
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'fetchOdbcDsns' }, REOPEN);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'odbcDsnList', items: ['DSN_A', 'DSN_B'] });
  });

  it('fetchOdbcDsns — returns empty list for non-2xx status', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ statusCode: 403, body: '{}' });
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'fetchOdbcDsns' }, REOPEN);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'odbcDsnList', items: [] });
  });

  it('fetchCubeDimensions — posts dimension list for cube', async () => {
    (getCubeDimensionNames as ReturnType<typeof vi.fn>).mockResolvedValue(['Dim1', 'Dim2']);
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'fetchCubeDimensions', cubeName: 'SalesCube' }, REOPEN);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'cubeDimensions', cubeName: 'SalesCube', dimensions: ['Dim1', 'Dim2'],
    });
  });

  it('fetchProcesses — maps name, signature, and params', async () => {
    (listProcesses as ReturnType<typeof vi.fn>).mockResolvedValue([
      { Name: 'Load', Parameters: [{ Name: 'sYear', Type: 'String' }, { Name: 'nQty', Type: 'Numeric' }] },
    ]);
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'fetchProcesses' }, REOPEN);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'processList',
      processes: [expect.objectContaining({
        name: 'Load',
        sig: '(sYear, nQty)',
        params: [{ name: 'sYear', type: 'String' }, { name: 'nQty', type: 'Numeric' }],
      })],
    }));
  });

  it('fetchProcesses — posts empty list on fetch error', async () => {
    (listProcesses as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'));
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'fetchProcesses' }, REOPEN);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'processList', processes: [] });
  });

  // ─── requestLint ─────────────────────────────────────────────────────────────

  it('requestLint — increments lint version and calls lintAllSections', async () => {
    (lintAllSections as ReturnType<typeof vi.fn>).mockImplementation(() => {});
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), {
      type: 'requestLint',
      sections: { prolog: 'code', metadata: '', data: '', epilog: '' },
      parameters: [], variables: [],
    }, REOPEN);
    expect(testSession(panel, KEY, 'Proc', 'srv', CONFIG).lintVersion.value).toBe(1);
    expect(lintAllSections).toHaveBeenCalled();
  });

  it('requestLint — lint version accumulates across successive calls', async () => {
    (lintAllSections as ReturnType<typeof vi.fn>).mockImplementation(() => {});
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'requestLint', sections: EMPTY_SECTIONS, parameters: [], variables: [] }, REOPEN);
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'requestLint', sections: EMPTY_SECTIONS, parameters: [], variables: [] }, REOPEN);
    expect(testSession(panel, KEY, 'Proc', 'srv', CONFIG).lintVersion.value).toBe(2);
  });

  // ─── requestResolver ─────────────────────────────────────────────────────────

  it('requestResolver — posts resolverData from buildResolverView result', async () => {
    const rows = [{ name: 'sRegion', type: 'String', value: '' }];
    (buildResolverView as ReturnType<typeof vi.fn>).mockReturnValue(rows);
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), {
      type: 'requestResolver',
      sections: { prolog: 'code', metadata: '', data: '', epilog: '' },
      parameters: [],
      variables: [],
    }, REOPEN);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'resolverData', rows });
  });

  it('requestResolver — posts error field when buildResolverView throws', async () => {
    (buildResolverView as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('parse fail'); });
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), {
      type: 'requestResolver',
      sections: EMPTY_SECTIONS, parameters: [], variables: [],
    }, REOPEN);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'resolverData', rows: [], error: 'parse fail' }),
    );
  });

  it('fetchCubesWithDims — maps cube name and dimension names', async () => {
    (listCubes as ReturnType<typeof vi.fn>).mockResolvedValue([
      { Name: 'Sales', Dimensions: [{ Name: 'Region' }, { Name: 'Year' }] },
      { Name: 'Empty', Dimensions: undefined },
    ]);
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'fetchCubesWithDims' }, REOPEN);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'cubesWithDims',
      cubes: [
        { name: 'Sales', dims: ['Region', 'Year'] },
        { name: 'Empty', dims: [] },
      ],
    });
  });

  it('fetchCubesWithDims — posts empty list on fetch error', async () => {
    (listCubes as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), { type: 'fetchCubesWithDims' }, REOPEN);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'cubesWithDims', cubes: [] });
  });

  it('resolveIdentifier — posts identifierInfo from lookup result', async () => {
    const info = { kind: 'parameter', name: 'pRegion' };
    (lookupIdentifierInfo as ReturnType<typeof vi.fn>).mockReturnValue(info);
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), {
      type: 'resolveIdentifier', word: 'pRegion', section: 'prolog', line: 2, requestId: 5,
      sections: { prolog: 'a\nb', metadata: '', data: '', epilog: '' },
      parameters: [{ Name: 'pRegion', Type: 'String' }], variables: [],
    }, REOPEN);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'identifierInfo', requestId: 5, info });
  });

  it('resolveIdentifier — guards invalid section with null info', async () => {
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), {
      type: 'resolveIdentifier', word: 'x', section: 'bogus', line: 1, requestId: 9,
      sections: {}, parameters: [], variables: [],
    }, REOPEN);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'identifierInfo', requestId: 9, info: null });
    expect(lookupIdentifierInfo).not.toHaveBeenCalled();
  });

  it('setFormatConfig — broadcasts config to panels of same serverKey only', async () => {
    const target = makePanel();
    const other = makePanel();
    testSession(target, 'srv|A', 'A', 'srv', CONFIG);
    testSession(other, 'OTHER|B', 'B', 'OTHER', CONFIG);
    const cfg = { enabled: { 'keyword-case': true } };
    await handleMessage(testSession(makePanel(), KEY, 'Proc', 'srv', CONFIG), {
      type: 'setFormatConfig', config: cfg as never,
    }, REOPEN);
    expect(target.webview.postMessage).toHaveBeenCalledWith({ type: 'formatConfig', config: cfg });
    expect(other.webview.postMessage).not.toHaveBeenCalled();
  });

  it('setLintConfig — broadcasts config to panels of same serverKey only', async () => {
    const target = makePanel();
    const other = makePanel();
    testSession(target, 'srv|A', 'A', 'srv', CONFIG);
    testSession(other, 'OTHER|B', 'B', 'OTHER', CONFIG);
    const cfg = { 'unknown-function': false };
    await handleMessage(testSession(makePanel(), KEY, 'Proc', 'srv', CONFIG), {
      type: 'setLintConfig', config: cfg as never,
    }, REOPEN);
    expect(target.webview.postMessage).toHaveBeenCalledWith({ type: 'lintConfig', config: cfg });
    expect(other.webview.postMessage).not.toHaveBeenCalled();
  });

  it('save — delegates to handleMonacoSave (not autosave)', async () => {
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), {
      type: 'save', sections: { ...EMPTY_SECTIONS, prolog: 'x' }, parameters: [], dataSource: { Type: 'None' }, variables: [], hasSecurity: false, errorCount: 0,
    }, REOPEN);
    expect(handleMonacoSave).toHaveBeenCalledTimes(1);
    // 10th positional arg (index 9) = isAutoSave flag → false for explicit save
    expect((handleMonacoSave as ReturnType<typeof vi.fn>).mock.calls[0][9]).toBe(false);
  });

  it('saveAs — delegates to handleMonacoSaveAs with reopen callback', async () => {
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), {
      type: 'saveAs', sections: EMPTY_SECTIONS, parameters: [], dataSource: { Type: 'None' }, variables: [], hasSecurity: false, errorCount: 0,
    }, REOPEN);
    expect(handleMonacoSaveAs).toHaveBeenCalledTimes(1);
    // index 7 = reopenAfterSave (hasSecurity now trails at index 8)
    expect((handleMonacoSaveAs as ReturnType<typeof vi.fn>).mock.calls[0][7]).toBe(REOPEN);
  });

  it('execute — autosaves first; breaks when save fails', async () => {
    (handleMonacoSave as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), {
      type: 'execute', sections: EMPTY_SECTIONS, parameters: [], dataSource: { Type: 'None' }, variables: [], hasSecurity: false, errorCount: 0,
    }, REOPEN);
    expect(handleMonacoSave).toHaveBeenCalledTimes(1);
    expect((handleMonacoSave as ReturnType<typeof vi.fn>).mock.calls[0][9]).toBe(true); // autosave
    expect(posted(panel).some((m) => m.type === 'setExecuting')).toBe(false); // never reached
  });

  it('fetchAsciiPreview — delegates to handleAsciiPreview', async () => {
    const panel = makePanel();
    const msg = { type: 'fetchAsciiPreview', cubeName: 'C' } as never;
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), msg, REOPEN);
    expect(handleAsciiPreview).toHaveBeenCalledWith(panel, msg, CONFIG);
  });

  it('debugCommand — delegates to handleDebugCommand with panelKey', async () => {
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), {
      type: 'debugCommand', command: 'stepOver',
    }, REOPEN);
    expect(handleDebugCommand).toHaveBeenCalledWith(KEY, panel, 'stepOver');
  });

  it('setBreakpoint — capitalizes section and forwards to handleBreakpoint', async () => {
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), {
      type: 'setBreakpoint', section: 'prolog', line: 12, enabled: true,
    }, REOPEN);
    expect(handleBreakpoint).toHaveBeenCalledWith(KEY, panel, { section: 'Prolog', line: 12, enabled: true });
  });

  it('setBreakpoint — ignored when section is empty', async () => {
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), {
      type: 'setBreakpoint', section: '' as never, line: 1, enabled: true,
    }, REOPEN);
    expect(handleBreakpoint).not.toHaveBeenCalled();
  });

  it('debugStart — no sections + no params: forwards filtered breakpoints to handleDebugStart', async () => {
    const panel = makePanel();
    await handleMessage(testSession(panel, KEY, 'Proc', 'srv', CONFIG), {
      type: 'debugStart', parameters: [],
      breakpoints: [
        { section: 'prolog', line: 3 },
        { section: 'epilog', line: 0 },   // dropped (line <= 0)
        { section: '' as never, line: 5 },          // dropped (no section)
      ],
    }, REOPEN);
    expect(handleMonacoSave).not.toHaveBeenCalled(); // no sections → no autosave
    expect(handleDebugStart).toHaveBeenCalledWith(KEY, panel, [], [{ section: 'Prolog', line: 3 }]);
  });
});
