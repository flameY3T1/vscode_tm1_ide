/**
 * Guard for the transaction log window: every control must be
 * connected, and the window script must run.
 *
 * The occasion is a bug that happened here twice: a laid wire is not a
 * connected wire (ID written, never read). Since 09-24 the
 * window script is a bundle (`webviewClient/transactionLog`) instead of inline text;
 * what is checked is the BUILT bundle, because only that runs in the window.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import * as vscode from 'vscode';
import { getHtml } from '../../commands/transactionLog';

const ROOT = join(__dirname, '../../..');
const BUNDLE = join(ROOT, 'out/webview/transactionLog.js');
const BUNDLE_SOURCES = [
  'src/webviewClient/transactionLog/index.ts',
  'src/webviewClient/transactionLog/protocol.ts',
  'src/utils/logTimestamp.ts',
].map(p => join(ROOT, p));

/** If the bundle is missing or older than its source, the test fails loudly instead of staying silently green. */
function readBundle(): string {
  if (!existsSync(BUNDLE)) {
    throw new Error(`Das gebaute Webview-Bundle fehlt: ${BUNDLE} — bitte \`npm run compile\` laufen lassen.`);
  }
  const built = statSync(BUNDLE).mtimeMs;
  const stale = BUNDLE_SOURCES.filter(p => existsSync(p) && statSync(p).mtimeMs > built);
  if (stale.length) {
    throw new Error(`Das Bundle ${BUNDLE} ist aelter als ${stale.join(', ')} — bitte \`npm run compile\` laufen lassen.`);
  }
  return readFileSync(BUNDLE, 'utf8');
}

const webview = { cspSource: 'vscode-webview:', asWebviewUri: (u: unknown) => u } as unknown as vscode.Webview;
const html = getHtml(webview, vscode.Uri.file('/ext'));

/** The inline script part: the last script element of the page (column drag script). */
function inlineScript(): string {
  const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  return blocks[blocks.length - 1];
}

/** `window.__tx`, as the host sets it. */
function bootstrap(): unknown {
  const m = /window\.__tx = (.*);/.exec(html);
  if (!m) { throw new Error('window.__tx fehlt im HTML'); }
  return JSON.parse(m[1].replace(/\\u003c/g, '<'));
}

describe('transaction log webview', () => {
  it('loads the bundle and parses the inline resize script', () => {
    expect(html).toContain('out/webview/transactionLog.js');
    // new Function parses without executing — exactly the gate that a wrongly
    // escaped character in the template literal would break.
    expect(() => new Function(inlineScript())).not.toThrow();
  });

  it('wires every control in the toolbar', () => {
    const script = readBundle().replace(/"/g, "'");
    const ids = [...html.matchAll(/id="([a-zA-Z][\w-]*)"/g)].map(m => m[1]);
    // The display fields are written, not read — they carry no listener.
    const anzeige = new Set(['dot', 'status', 'error', 'hint', 'note', 'tbody']);
    const bedienelemente = ids.filter(id => !anzeige.has(id));
    expect(bedienelemente.length).toBeGreaterThan(5);
    for (const id of bedienelemente) {
      expect(script, `Bedienelement ${id} ist nicht angeschlossen`).toContain(`'${id}'`);
    }
  });

  it('offers a real search mask: interval, cube, user, element', () => {
    for (const id of ['fromInput', 'toInput', 'cubeInput', 'userInput', 'elemInput', 'searchBtn']) {
      expect(html, id).toContain(`id="${id}"`);
    }
    // Free input WITH a suggestion list, not a selection from the loaded
    // window: otherwise a user whose changes are older than the
    // window cannot be searched for.
    expect(html).toContain('list="cubeList"');
    expect(html).toContain('list="userList"');
    expect(html).toContain('type="datetime-local"');
  });

  it('carries the load disclaimer, not only a warning after the fact', () => {
    const tx = bootstrap() as { texts: { load: string }; warnSpanHours: number };
    expect(tx.texts.load).toContain('hold other users up');
    expect(tx.warnSpanHours).toBe(168);
  });

  it('offers the measured windows and row counts', () => {
    expect(html).toContain('<select id="winSel">');
    expect(html).toContain('value="24" selected');
    expect(html).toContain('<select id="topSel">');
    expect(html).toContain('value="1000" selected');
  });

  it('says what an empty result can also mean', () => {
    // "Nothing changed" and "not logged" look the same in the log —
    // measured 2026-09-22. The hint is the difference.
    expect((bootstrap() as { texts: { empty: string } }).texts.empty).toContain('LOGGING');
  });

  it('keeps the CSP nonce scaffolding from the shell', () => {
    expect(html).toContain('Content-Security-Policy');
    // Only the script needs a nonce; `style-src 'unsafe-inline'` is the
    // shell's default, because the stylesheets are inline.
    const scriptSrc = /script-src ([^;]+);/.exec(html)?.[1] ?? '';
    expect(scriptSrc).toContain("'nonce-");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });
});

describe('column resize in the log tables and TM1 Top', () => {
  it('marks the table and runs a parseable resize script in all four panels', async () => {
    const { getHtml: messageLog } = await import('../../commands/messageLog');
    const { getHtml: threads } = await import('../../commands/threads');
    const { getTm1TopHtml } = await import('../../commands/tm1Top');
    const tm1Top = getTm1TopHtml(webview, { user: '', saved: false }, 'tm1Top.js');
    for (const h of [html, messageLog(webview, vscode.Uri.file('/ext')), threads(webview, vscode.Uri.file('/ext'), false), tm1Top]) {
      expect(h).toMatch(/<table data-resizable>/);
      expect(h).toContain('table-layout: fixed');
      const blocks = [...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
      const script = blocks[blocks.length - 1];
      expect(script).toContain('col-grip');
      expect(() => new Function(script)).not.toThrow();
    }
  });
});

describe('transaction log search order', () => {
  /** Run the built bundle in a mock: elements by ID, messages collected. */
  function run() {
    const els = new Map<string, Record<string, unknown>>();
    const el = (id: string) => {
      if (!els.has(id)) {
        const listeners: Record<string, Array<(e: unknown) => void>> = {};
        els.set(id, {
          value: '', checked: false, className: '', textContent: '', innerHTML: '',
          addEventListener: (t: string, f: (e: unknown) => void) => { (listeners[t] ??= []).push(f); },
          dispatchEvent: (e: { type: string }) => { for (const f of listeners[e.type] ?? []) { f(e); } },
          click: () => { for (const f of listeners.click ?? []) { f({}); } },
          querySelectorAll: () => [], classList: { contains: () => false },
        });
      }
      return els.get(id)!;
    };
    let onMessage: (e: { data: unknown }) => void = () => undefined;
    const posted: Array<Record<string, unknown>> = [];
    const document = {
      getElementById: el, querySelectorAll: () => [], querySelector: () => null,
      addEventListener: () => undefined, body: {}, createElement: () => el(`new${Math.random()}`),
    };
    const window = {
      __tx: bootstrap(),
      addEventListener: (t: string, f: typeof onMessage) => { if (t === 'message') { onMessage = f; } },
    };
    const vscodeApi = { postMessage: (m: Record<string, unknown>) => posted.push(m), getState: () => undefined, setState: () => undefined };
    class Event { constructor(public type: string) {} }
    class MutationObserver { observe() { /* nothing */ } }
    new Function('acquireVsCodeApi', 'document', 'window', 'Event', 'MutationObserver', readBundle())(
      () => vscodeApi, document, window, Event, MutationObserver);
    return { el, posted, deliver: (data: unknown) => onMessage({ data }) };
  }

  it('drops a slower older answer instead of replacing the newer result', () => {
    // Follow-up review 09-23 F4: search A, then B; B arrives first, A last — the table showed A under cube B.
    const w = run();
    w.el('cubeInput').value = 'A';
    (w.el('searchBtn').click as () => void)();
    w.el('cubeInput').value = 'B';
    (w.el('searchBtn').click as () => void)();
    const [a, b] = w.posted.filter(m => m.type === 'load');
    expect(a.cube).toBe('A');
    expect(b.cube).toBe('B');
    w.deliver({ seq: b.seq, entries: [{ Cube: 'CubeB' }], total: 1 });
    w.deliver({ seq: a.seq, entries: [{ Cube: 'CubeA' }], total: 1 });
    w.deliver({ seq: a.seq, error: 'stale failure' });
    expect(w.el('tbody').innerHTML).toContain('CubeB');
    expect(w.el('tbody').innerHTML).not.toContain('CubeA');
    expect(w.el('error').textContent).toBe('');
  });
});
