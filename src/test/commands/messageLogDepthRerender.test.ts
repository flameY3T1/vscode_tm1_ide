import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { createContext, runInContext } from 'vm';
import { getHtml } from '../../commands/messageLog';
import { readBuiltBundle } from '../helpers/builtBundle';

/**
 * The table has an append-only fast path: when the filter is unchanged and the
 * previously topmost row is still there, only the rows above it are prepended.
 *
 * Its guard used to be "topmost row unchanged -> nothing to do". That is wrong
 * for a depth change: switching 100 -> 1000 on a quiet server answers with the
 * SAME first row plus 900 older ones, so the counter said 1000/1000 while the
 * DOM still held 100 rows. The depth is not part of the filter key, so only the
 * row count can tell the two cases apart.
 *
 * The renderer is the built bundle `out/webview/messageLog.js`; the test runs
 * it against a stub DOM, as `messageLogToolbarWiring` does for the toolbar.
 */

interface StubEl {
  listeners: Record<string, ((ev: unknown) => void)[]>;
  addEventListener(type: string, fn: (ev: unknown) => void): void;
  insertAdjacentHTML(where: string, html: string): void;
  dataset: Record<string, string>;
  classList: { toggle(): void };
  textContent: string;
  innerHTML: string;
  className: string;
}

function makeEl(): StubEl {
  const listeners: Record<string, ((ev: unknown) => void)[]> = {};
  return {
    listeners,
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    insertAdjacentHTML(where, html) {
      this.innerHTML = where === 'afterbegin' ? html + this.innerHTML : this.innerHTML + html;
    },
    dataset: {},
    classList: { toggle() { /* stub */ } },
    textContent: '',
    innerHTML: '',
    className: '',
  };
}

interface Harness {
  /** Deliver one host answer, as the panel's poll does. */
  post(entries: unknown[]): void;
  /** Rows currently in the DOM. */
  rows(): number;
  /** The `shown/total` counter. */
  status(): string;
}

function runInlineScript(): Harness {
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
    if (!el) { el = makeEl(); els.set(id, el); }
    return el;
  };
  const document = {
    getElementById: (id: string) => getEl(id),
    querySelectorAll: () => [] as StubEl[],
  };
  const winListeners: Record<string, ((ev: unknown) => void)[]> = {};
  const windowStub = {
    addEventListener(type: string, fn: (ev: unknown) => void) { (winListeners[type] ??= []).push(fn); },
  };
  const acquireVsCodeApi = () => ({ postMessage: () => { /* stub */ } });

  const sandbox = { document, window: windowStub, acquireVsCodeApi, setTimeout, clearTimeout };
  createContext(sandbox);
  runInContext(readBuiltBundle('messageLog', [
    'src/webviewClient/messageLog/index.ts',
    'src/webviewClient/messageLog/protocol.ts',
    'src/messageLog/messageLogPure.ts',
    'src/utils/logTimestamp.ts',
  ]), sandbox, { filename: 'messageLog.js' });
  expect(winListeners['message'] ?? []).toHaveLength(1);

  return {
    post(entries) {
      winListeners['message'][0]({ data: { entries, ts: Date.now() } });
    },
    rows() {
      return (getEl('tbody').innerHTML.match(/<tr>/g) ?? []).length;
    },
    status() { return getEl('status').textContent.split(' · ')[0]; },
  };
}

/** `n` entries, newest first — index 0 is the same row in every window. */
function log(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({
    Level: 'Info',
    LevelClass: 'l-info',
    TimeStamp: `2026-09-20T10:00:${String(59 - i % 60).padStart(2, '0')}.000Z`,
    ThreadID: String(1000 - i),
    Message: `line ${i}`,
    Logger: 'TM1.Server',
  }));
}

describe('message log — depth change re-renders the table', () => {
  it('grows the DOM when the depth goes 100 -> 1000 with an unchanged first row', () => {
    const h = runInlineScript();
    h.post(log(100));
    expect(h.rows()).toBe(100);

    h.post(log(1000));
    expect(h.status()).toBe('1000/1000');
    expect(h.rows()).toBe(1000);
  });

  it('shrinks the DOM when the depth goes back 1000 -> 100', () => {
    const h = runInlineScript();
    h.post(log(1000));
    h.post(log(100));
    expect(h.status()).toBe('100/100');
    expect(h.rows()).toBe(100);
  });

  it('still skips the work when the answer is byte-for-byte the same', () => {
    const h = runInlineScript();
    h.post(log(100));
    h.post(log(100));
    expect(h.rows()).toBe(100);
  });

  it('still prepends only the new rows when the server logged more', () => {
    const h = runInlineScript();
    h.post(log(100).slice(3));
    expect(h.rows()).toBe(97);
    h.post(log(100));
    expect(h.rows()).toBe(100);
  });
});
