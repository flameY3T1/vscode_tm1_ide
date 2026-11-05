import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { createContext, runInContext } from 'vm';
import { getHtml } from '../../commands/messageLog';
import { readBuiltBundle } from '../helpers/builtBundle';

/**
 * The Message Log toolbar used to be wired inside the shell's `inlineScript` — a
 * template literal, so a listener nested one brace too deep was still valid
 * JavaScript and passed tsc, eslint and every other gate. That is exactly what
 * happened to the "Startup" button: its `addEventListener` sat INSIDE the
 * analyze handler's body, so the button stayed dead until you had clicked
 * "Analyze" once.
 *
 * This runs the built bundle against a stub DOM and asserts each toolbar
 * control is wired straight away — no prior interaction.
 */

interface StubEl {
  id: string;
  listeners: Record<string, ((ev: unknown) => void)[]>;
  addEventListener(type: string, fn: (ev: unknown) => void): void;
  dataset: Record<string, string>;
  classList: { toggle(): void };
  textContent: string;
  innerHTML: string;
  className: string;
}

function makeEl(id: string): StubEl {
  const listeners: Record<string, ((ev: unknown) => void)[]> = {};
  return {
    id,
    listeners,
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    dataset: {},
    classList: { toggle() { /* stub */ } },
    textContent: '',
    innerHTML: '',
    className: '',
  };
}

/** Extract the shell's nonce'd inline script and run it against a stub DOM. */
function runInlineScript(): { els: Map<string, StubEl>; posted: unknown[] } {
  const html = getHtml(
    { cspSource: 'vscode-webview:', asWebviewUri: (u: unknown) => u } as unknown as vscode.Webview,
    vscode.Uri.file('/ext'),
  );
  // The window logic is the bundle now; no inline script may carry it.
  expect([...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].filter(m => m[1].includes('acquireVsCodeApi'))).toHaveLength(0);
  expect(html).toContain('src="/ext/out/webview/messageLog.js"');

  const els = new Map<string, StubEl>();
  const getEl = (id: string): StubEl => {
    let el = els.get(id);
    if (!el) { el = makeEl(id); els.set(id, el); }
    return el;
  };
  const posted: unknown[] = [];
  const document = {
    getElementById: (id: string) => getEl(id),
    querySelectorAll: () => [] as StubEl[],
  };
  const windowStub = { addEventListener: () => { /* stub */ } };
  const acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { posted.push(m); } });

  const sandbox = { document, window: windowStub, acquireVsCodeApi, setTimeout, clearTimeout };
  createContext(sandbox);
  runInContext(readBuiltBundle('messageLog', [
    'src/webviewClient/messageLog/index.ts',
    'src/webviewClient/messageLog/protocol.ts',
    'src/messageLog/messageLogPure.ts',
    'src/utils/logTimestamp.ts',
  ]), sandbox, { filename: 'messageLog.js' });
  return { els, posted };
}

describe('message log toolbar wiring', () => {
  it.each([
    ['analyzeBtn', 'click', 'openAnalysis'],
    ['startupBtn', 'click', 'openStartup'],
  ])('%s posts %s on %s without any prior interaction', (id, type, command) => {
    const { els, posted } = runInlineScript();
    const el = els.get(id);
    expect(el, `#${id} was never looked up — the script does not wire it`).toBeDefined();
    const fns = el!.listeners[type] ?? [];
    expect(fns, `#${id} has no ${type} listener at load time`).toHaveLength(1);
    fns[0](undefined);
    expect(posted).toContainEqual({ command });
  });

  it('wires the depth select and the filter input at load time', () => {
    const { els } = runInlineScript();
    expect(els.get('topSel')?.listeners['change'] ?? []).toHaveLength(1);
    expect(els.get('filterInput')?.listeners['input'] ?? []).toHaveLength(1);
    expect(els.get('tbody')?.listeners['click'] ?? []).toHaveLength(1);
  });
});
