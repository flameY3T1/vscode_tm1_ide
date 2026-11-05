import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';

// Capture the cfg that the panel routes REST through, without hitting a server.
const fetchCorpus = vi.fn().mockResolvedValue({ corpus: [], unreadable: [] });
vi.mock('../../findReplace/corpus', () => ({
  fetchCorpus: (...args: unknown[]) => fetchCorpus(...args),
  applyEdits: vi.fn().mockResolvedValue({ updated: [], failed: [] }),
}));

// Jumping to a match opens the editor and records a Recent entry — stub both
// sides so the assertion is about WHICH serverId is recorded.
vi.mock('../../commands/processEditor/openPanel', () => ({ openProcess: vi.fn() }));
vi.mock('../../commands/processEditor/recentBridge', () => ({
  recordProcessOpen: vi.fn(),
  recordRuleOpen: vi.fn(),
}));
vi.mock('../../commands/serverManager', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getServerIdByUrl: vi.fn(),
}));

import { FindReplacePanel } from '../../webviews/findReplaceWebview';
import { openProcess } from '../../commands/processEditor/openPanel';
import { recordProcessOpen } from '../../commands/processEditor/recentBridge';
import { getServerIdByUrl } from '../../commands/serverManager';

const URL = 'http://srv:8001';
const cfgFor = (url: string): Tm1Config => ({ serverUrl: url }) as unknown as Tm1Config;
const created = () =>
  (vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.results.map((r) => r.value);
const searchMsg = { type: 'search', query: 'x', opts: { wholeWord: false, regex: false }, filter: {} };

describe('FindReplacePanel lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchCorpus.mockResolvedValue({ corpus: [], unreadable: [] });
    // Fresh host per test (initialize replaces the WebviewPanelHost singleton).
    FindReplacePanel.initialize(vscode.Uri.file('/ext'));
  });

  it('reveals the existing panel instead of opening a second one for the same server', () => {
    FindReplacePanel.open(cfgFor(URL), 'srv', 'Srv');
    FindReplacePanel.open(cfgFor(URL), 'srv', 'Srv');
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it('disposePanelsForServer disposes the panel; a later open creates a fresh one', async () => {
    FindReplacePanel.open(cfgFor(URL), 'srv', 'Srv');
    const panel = created()[0];
    const disposed = vi.spyOn(panel, 'dispose');

    FindReplacePanel.disposePanelsForServer(URL);
    expect(disposed).toHaveBeenCalled();
    // Since B14, the panel host attaches a dead webview to the panel on close:
    // `postMessage` returns `false` instead of throwing. Exactly that is the
    // proof of the teardown here — previously an expected throw when
    // setting `html` stood for it, and that throw no longer exists.
    await expect(panel.webview.postMessage({ type: 'x' })).resolves.toBe(false);

    FindReplacePanel.open(cfgFor(URL), 'srv', 'Srv');
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
  });

  it('re-open with a refreshed cfg rebinds the cfg used for REST (no stale cfg on reveal)', () => {
    const cfg1 = cfgFor(URL);
    const cfg2 = cfgFor(URL); // same serverUrl -> reveal path, must still pick up cfg2
    FindReplacePanel.open(cfg1, 'srv', 'Srv');
    const panel = created()[0];

    panel.simulateMessage(searchMsg);
    expect(fetchCorpus).toHaveBeenLastCalledWith(cfg1);

    FindReplacePanel.open(cfg2, 'srv', 'Srv'); // reveal — WebviewPanelHost.open returns early
    panel.simulateMessage(searchMsg);
    expect(fetchCorpus).toHaveBeenLastCalledWith(cfg2);
  });

  it('records the Recent entry under the serverId the panel was opened with, not a URL lookup', async () => {
    // Two v12 profiles (different databases) share one gateway URL: reverse-
    // resolving the id from cfg.serverUrl yields whichever was registered first
    // ('srv-a'), so reopening the Recent entry would hit the WRONG database.
    vi.mocked(openProcess).mockResolvedValue(true);
    vi.mocked(getServerIdByUrl).mockReturnValue('srv-a');
    FindReplacePanel.open(cfgFor(URL), 'srv-b', 'Srv B');
    const panel = created()[0];

    panel.simulateMessage({ type: 'open', objectKind: 'process', objectName: 'Load.Sales' });

    await vi.waitFor(() => expect(recordProcessOpen).toHaveBeenCalled());
    expect(recordProcessOpen).toHaveBeenCalledWith('srv-b', 'Load.Sales');
    expect(getServerIdByUrl).not.toHaveBeenCalled();
  });
});
