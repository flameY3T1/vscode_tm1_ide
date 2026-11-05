// Execute / Debug from the process editor ask for parameters as an overlay in
// that editor (askParams → paramsAnswer) instead of opening a second tab
// (2026-10-28). Host side: posting, conversion, cancel, editor closed.
import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { askParamsInPanel, answerParamAsk } from '../../commands/processEditor/processParams';

function fakePanel() {
  let onDispose: (() => void) | undefined;
  const posted: Array<Record<string, unknown>> = [];
  const panel = {
    webview: { postMessage: vi.fn(async (m: Record<string, unknown>) => { posted.push(m); return true; }) },
    onDidDispose: (cb: () => void) => { onDispose = cb; return { dispose: () => { onDispose = undefined; } }; },
  };
  return { panel: panel as unknown as vscode.WebviewPanel, posted, close: () => onDispose?.() };
}

const PARAMS = [
  { Name: 'pYear', Type: 'Numeric', Value: 2026, Prompt: 'Year' },
  { Name: 'pCube', Type: 'String', Value: 'Sales', Prompt: 'pCube' },
];

describe('parameter prompt inside the process editor', () => {
  it('posts askParams to the editor and converts the answer', async () => {
    const { panel, posted } = fakePanel();
    const pending = askParamsInPanel(panel, 'Load', PARAMS, 'Execute', 'http://s');
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    const ask = posted[0] as { type: string; requestId: string; params: unknown[] };
    expect(ask.type).toBe('askParams');
    expect(ask.params).toEqual([
      { name: 'pYear', numeric: true, value: '2026', prompt: 'Year' },
      { name: 'pCube', numeric: false, value: 'Sales', prompt: '' },
    ]);
    answerParamAsk(ask.requestId, { pYear: '2027', pCube: 'Plan' });
    await expect(pending).resolves.toEqual([{ Name: 'pYear', Value: 2027 }, { Name: 'pCube', Value: 'Plan' }]);
  });

  it('cancel resolves undefined', async () => {
    const { panel, posted } = fakePanel();
    const pending = askParamsInPanel(panel, 'Load', PARAMS, 'Execute', 'http://s');
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    answerParamAsk(String(posted[0].requestId), null);
    await expect(pending).resolves.toBeUndefined();
  });

  it('closing the editor while asking resolves undefined', async () => {
    const { panel, posted, close } = fakePanel();
    const pending = askParamsInPanel(panel, 'Load', PARAMS, 'Execute', 'http://s');
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    close();
    await expect(pending).resolves.toBeUndefined();
  });

  it('asks nothing for a process without parameters', async () => {
    const { panel, posted } = fakePanel();
    await expect(askParamsInPanel(panel, 'Load', [], 'Execute', 'http://s')).resolves.toEqual([]);
    expect(posted).toHaveLength(0);
  });
});
