import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getHtml, TOP_OPTIONS, MAX_TOP } from '../../commands/messageLog';

/**
 * The depth dropdown and the upper bound to which the host clamps `setTop`
 * are two places for the same number. When they diverged, the
 * host swallowed the selection SILENTLY: 10000 selected, 5000 loaded, and the corner
 * showed "5000/5000" without any hint of the truncation.
 *
 * No gate caught that — the option was there, the clamp value was there, both
 * plausible on their own. Hence here: both have to come from `TOP_OPTIONS`.
 */
describe('message log: depth dropdown and clamp value', () => {
  it('offers exactly the values from TOP_OPTIONS', () => {
    const html = getHtml({ cspSource: 'vscode-webview:', asWebviewUri: (u: unknown) => u } as unknown as vscode.Webview, vscode.Uri.file('/ext'));
    const angeboten = [...html.matchAll(/<option value="(\d+)"/g)].map((m) => Number(m[1]));
    expect(angeboten).toEqual([...TOP_OPTIONS]);
  });

  it('clamps to MAX_TOP instead of to a written-out number', () => {
    expect(MAX_TOP).toBe(Math.max(...TOP_OPTIONS));
    const src = readFileSync(path.join(__dirname, '../../commands/messageLog.ts'), 'utf8');
    const klemmzeile = src.split('\n').find((l) => l.includes('currentTop = Number.isFinite(top)'));
    expect(klemmzeile).toBeDefined();
    expect(klemmzeile).toContain('MAX_TOP');
  });
});
