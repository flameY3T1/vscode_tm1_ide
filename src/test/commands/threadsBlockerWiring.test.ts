import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { createContext, runInContext } from 'vm';
import { getHtml } from '../../commands/threads';
import { readBuiltBundle } from '../helpers/builtBundle';

/**
 * The "kill blockers" button used to live in the shell's `inlineScript`, where a
 * listener nested one brace too deep still compiled and passed every gate while
 * the button stayed dead (that is exactly how the message log's "Startup" button
 * broke once). Run the built bundle against a stub DOM and assert the button is
 * wired, and that a poll payload arms and labels it.
 */
interface StubEl {
  id: string;
  listeners: Record<string, ((ev: unknown) => void)[]>;
  addEventListener(type: string, fn: (ev: unknown) => void): void;
  querySelectorAll(): StubEl[];
  classList: { toggle(cls: string, on?: boolean): void; add(): void; remove(): void };
  dataset: Record<string, string>;
  style: Record<string, string>;
  textContent: string;
  innerHTML: string;
  className: string;
  disabled: boolean;
  toggled: string[];
}

function makeEl(id: string): StubEl {
  const listeners: Record<string, ((ev: unknown) => void)[]> = {};
  const toggled: string[] = [];
  return {
    id,
    listeners,
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    querySelectorAll: () => [],
    classList: {
      toggle(cls: string, on?: boolean) { if (on) { toggled.push(cls); } },
      add() { /* stub */ }, remove() { /* stub */ },
    },
    dataset: {}, style: {}, textContent: '', innerHTML: '', className: '',
    disabled: false, toggled,
  };
}

interface Harness {
  els: Map<string, StubEl>;
  posted: unknown[];
  /** Deliver a poll payload the way the extension host posts it. */
  post(data: unknown): void;
}

function runInlineScript(): Harness {
  const html = getHtml(
    { cspSource: 'vscode-webview:', asWebviewUri: (u: unknown) => u } as unknown as vscode.Webview,
    vscode.Uri.file('/ext'), false,
  );
  const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  expect(inline.filter(b => b.includes('acquireVsCodeApi'))).toHaveLength(0);
  expect(html).toContain('src="/ext/out/webview/threads.js"');
  // The shell emits `window.__l10n` in a script of its own; the toolbar labels come from it.
  const globalsScript = inline.filter(b => b.includes('window.__l10n'));
  expect(globalsScript).toHaveLength(1);

  const els = new Map<string, StubEl>();
  const getEl = (id: string): StubEl => {
    let el = els.get(id);
    if (!el) { el = makeEl(id); els.set(id, el); }
    return el;
  };
  const posted: unknown[] = [];
  const document = { getElementById: (id: string) => getEl(id), querySelectorAll: () => [] as StubEl[] };
  const msgListeners: ((ev: unknown) => void)[] = [];
  const windowStub = {
    addEventListener: (type: string, fn: (ev: unknown) => void) => { if (type === 'message') { msgListeners.push(fn); } },
  };
  const acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { posted.push(m); } });

  const sandbox = { document, window: windowStub, acquireVsCodeApi };
  createContext(sandbox);
  runInContext(globalsScript[0], sandbox);
  runInContext(readBuiltBundle('threads', ['src/webviewClient/threads/index.ts', 'src/webviewClient/threads/protocol.ts']), sandbox, { filename: 'threads.js' });
  return { els, posted, post: (data) => { for (const fn of msgListeners) { fn({ data }); } } };
}

const basePayload = { groups: [], cycleIds: [], threads: [], waitingCount: 0, ts: 1_700_000_000_000 };

describe('threads panel — kill-blockers button wiring', () => {
  it('posts killBlockers on click, without any prior interaction', () => {
    const { els, posted } = runInlineScript();
    const btn = els.get('btn-killblocker');
    expect(btn, '#btn-killblocker is never looked up — the script does not wire it').toBeDefined();
    const fns = btn!.listeners['click'] ?? [];
    expect(fns, '#btn-killblocker has no click listener at load time').toHaveLength(1);
    fns[0](undefined);
    expect(posted).toContainEqual({ command: 'killBlockers' });
  });

  it('stays disabled while nothing blocks', () => {
    const h = runInlineScript();
    h.post({ ...basePayload, blockers: [] });
    expect(h.els.get('btn-killblocker')!.disabled).toBe(true);
    expect(h.els.get('lbl-killblocker')!.textContent).toBe('Kill blockers');
  });

  it('arms and carries the count once blockers arrive', () => {
    const h = runInlineScript();
    h.post({ ...basePayload, blockers: [{ id: 42, label: 'T42', waiterCount: 3, fromCycle: false }, { id: 7, label: 'T7', waiterCount: 1, fromCycle: false }] });
    expect(h.els.get('btn-killblocker')!.disabled).toBe(false);
    expect(h.els.get('lbl-killblocker')!.textContent).toBe('Kill blockers (2)');
  });

  it('marks the button when one of the targets breaks a deadlock', () => {
    const h = runInlineScript();
    h.post({ ...basePayload, blockers: [{ id: 7, label: 'T7', waiterCount: 2, fromCycle: true }] });
    expect(h.els.get('btn-killblocker')!.toggled).toContain('has-deadlock');
  });

  it('disables the button when the poll itself failed', () => {
    const h = runInlineScript();
    h.post({ ...basePayload, blockers: [{ id: 42, label: 'T42', waiterCount: 3, fromCycle: false }] });
    h.post({ ...basePayload, blockers: [], error: 'ECONNREFUSED' });
    expect(h.els.get('btn-killblocker')!.disabled).toBe(true);
  });

  it('survives an old payload that carries no blockers field at all', () => {
    const h = runInlineScript();
    h.post({ ...basePayload });
    expect(h.els.get('btn-killblocker')!.disabled).toBe(true);
  });
});
