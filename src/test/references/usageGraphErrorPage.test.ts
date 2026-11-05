/**
 * Codex finding B12: the error page of the call graph window ("Chore not in
 * the index") was the only document of the extension without a CSP — and the
 * chore name, which comes from the server, went into it unescaped.
 */
import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';

vi.mock('../../references/referenceIndexService', () => ({ getOrBuildIndex: vi.fn() }));

import { renderChoreGraph } from '../../references/showUsageGraph';
import type { ReferenceIndex } from '../../references/referenceTypes';

const emptyIndex = { choreTasks: new Map<string, unknown>() } as unknown as ReferenceIndex;

function fakePanel() {
  return {
    webview: {
      html: '', cspSource: 'vscode-webview:',
      onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      postMessage: vi.fn(),
      asWebviewUri: (u: unknown) => u,
    },
  } as unknown as vscode.WebviewPanel;
}

describe('Aufrufgrafik — Fehlerseite', () => {
  it('escapes the chore name and carries a CSP', () => {
    const panel = fakePanel();
    renderChoreGraph(panel, emptyIndex, '</strong><img src=x onerror=alert(1)>', undefined, false);

    const html = panel.webview.html;
    expect(html).toContain('Content-Security-Policy');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
