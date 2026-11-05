// Runs the built server configuration editor bundle (out/webview/serverConfigEditor.js)
// in a vm context: the page logic left the host's template literal, and only
// the built file proves the wiring holds.
import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { createContext, runInContext } from 'vm';
import { renderHtml } from '../../commands/serverConfig/serverConfigEditorWebview';
import type { ConfigSnapshot } from '../../serverConfig/configApi';
import { readBuiltBundle } from '../helpers/builtBundle';

type Listener = (ev: Record<string, unknown>) => void;

interface FakeEl {
  id: string; innerHTML: string; disabled: boolean; value: string;
  listeners: Record<string, Listener[]>;
  classList: { toggle(): void; add(): void; remove(): void };
  addEventListener(t: string, fn: Listener): void;
  getAttribute(): null;
}

function fakeEl(id: string): FakeEl {
  const el: FakeEl = {
    id, innerHTML: '', disabled: false, value: '', listeners: {},
    classList: { toggle() { /* stub */ }, add() { /* stub */ }, remove() { /* stub */ } },
    addEventListener(t, fn) { (el.listeners[t] ??= []).push(fn); },
    getAttribute: () => null,
  };
  return el;
}

const snap: ConfigSnapshot = {
  values: new Map<string, unknown>([['ServerName', 'Prod<1>']]),
  staticKeys: new Set(['ServerName']),
  activeKeys: new Set(),
  paths: new Set(['ServerName']),
};

function load(savedCluster?: string) {
  const webview = { cspSource: 'csp:', asWebviewUri: (u: unknown) => u } as unknown as vscode.Webview;
  const html = renderHtml(snap, 'srv', webview, vscode.Uri.file('/ext'));
  const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  expect(inline.filter((s) => s.includes('acquireVsCodeApi'))).toHaveLength(0);
  expect(html).toContain('src="/ext/out/webview/serverConfigEditor.js"');
  const globalsScript = inline.filter((s) => s.includes('window.__serverConfig'));
  expect(globalsScript).toHaveLength(1);

  const els = new Map<string, FakeEl>();
  const byId = (id: string): FakeEl => { if (!els.has(id)) { els.set(id, fakeEl(id)); } return els.get(id)!; };
  const posted: unknown[] = [];
  const sandbox = {
    document: { getElementById: byId, querySelectorAll: () => [] as unknown[] },
    window: {},
    acquireVsCodeApi: () => ({
      postMessage: (m: unknown) => posted.push(m),
      getState: () => (savedCluster ? { cluster: savedCluster } : undefined),
      setState: () => { /* stub */ },
    }),
  };
  createContext(sandbox);
  runInContext(globalsScript[0], sandbox);
  runInContext(readBuiltBundle('serverConfigEditor', [
    'src/webviewClient/serverConfigEditor/index.ts',
    'src/webviewClient/serverConfigEditor/protocol.ts',
  ]), sandbox, { filename: 'serverConfigEditor.js' });
  const click = (id: string): void => { for (const fn of byId(id).listeners.click ?? []) { fn({}); } };
  return { byId, posted, click };
}

describe('server config editor bundle', () => {
  it('renders the raw tab from the remembered state, with the value escaped', () => {
    const { byId } = load('__raw__');
    expect(byId('main').innerHTML).toContain('<textarea id="raw">');
    expect(byId('main').innerHTML).toContain('Prod&lt;1&gt;');
  });

  it('save posts the original and the edited values', () => {
    const { posted, click } = load();
    click('save');
    expect(posted).toEqual([{ type: 'save', original: { ServerName: 'Prod<1>' }, edited: { ServerName: 'Prod<1>' } }]);
  });

  it('reload posts reload', () => {
    const { posted, click } = load();
    click('reload');
    expect(posted).toEqual([{ type: 'reload' }]);
  });
});
