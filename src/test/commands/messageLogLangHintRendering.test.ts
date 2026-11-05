// The language hint has to arrive in BOTH analyses without disturbing the
// normal path.
//
// It travels as a message of its own (`{ langHint }`) and carries neither a result nor an
// error. A receiver that simply carries on reads `result.stats` on
// `undefined` — the hint would then have wrecked precisely the view that
// it is meant to explain.
//
// Both receivers run as built bundles under `out/webview/`; the test really
// executes them.
import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { readBuiltBundle } from '../helpers/builtBundle';
import { createContext, runInContext } from 'vm';
import { _getHtmlForTest } from '../../commands/messageLogAnalysis';
import { _getHtmlForTest as _getStartupHtmlForTest } from '../../commands/messageLogStartup';

type MessageHandler = (ev: { data: Record<string, unknown> }) => void;

interface StubEl {
  innerHTML: string; textContent: string; className: string;
  dataset: Record<string, string>;
}

function stubEl(): StubEl {
  return { innerHTML: '', textContent: '', className: '', dataset: {} };
}

// Both analyses run as real bundles (out/webview/*.js), no longer as inline
// scripts. The test executes the BUILT bundle in a vm context, together with the
// globals script the host renders in front of it — same approach as
// addServerBundleWiring.
/** Run the globals script of `html` and the built bundle; return the message handler and touched elements. */
function runBundle(html: string, globalsMarker: string, name: string, sources: string[]): { handler: MessageHandler; els: Map<string, StubEl> } {
  const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  // The window logic must no longer sit in an inline script.
  expect(inline.filter(s => s.includes('acquireVsCodeApi'))).toHaveLength(0);
  const globalsScript = inline.filter(s => s.includes(globalsMarker));
  expect(globalsScript).toHaveLength(1);

  const els = new Map<string, StubEl>();
  const el = (id: string): StubEl => {
    if (!els.has(id)) { els.set(id, stubEl()); }
    return els.get(id)!;
  };
  const classList = { toggle: () => { /* stub */ }, contains: () => false, add: () => { /* stub */ }, remove: () => { /* stub */ } };
  const document = {
    getElementById: (id: string) => Object.assign(el(id), {
      classList,
      addEventListener: () => { /* stub */ },
      querySelectorAll: () => [] as unknown[],
      parentElement: null,
    }),
    querySelectorAll: () => [] as unknown[],
  };
  let handler: MessageHandler = () => { /* replaced */ };
  const windowStub: Record<string, unknown> = {
    addEventListener: (typ: string, fn: MessageHandler) => { if (typ === 'message') { handler = fn; } },
  };
  const sandbox = {
    document,
    window: windowStub,
    acquireVsCodeApi: (): unknown => ({ postMessage: () => { /* stub */ } }),
  };
  createContext(sandbox);
  runInContext(globalsScript[0], sandbox);
  runInContext(readBuiltBundle(name, sources), sandbox, { filename: name + '.js' });
  return { handler, els };
}

const webviewStub = { cspSource: 'vscode-webview:', asWebviewUri: (u: unknown) => u } as unknown as vscode.Webview;

function ladeEmpfaenger(): { handler: MessageHandler; els: Map<string, StubEl> } {
  const html = _getHtmlForTest(webviewStub, vscode.Uri.file('/ext'), 500);
  expect(html).toContain('src="/ext/out/webview/messageLogAnalysis.js"');
  return runBundle(html, 'window.__mlaL', 'messageLogAnalysis', [
    'src/webviewClient/messageLogAnalysis/index.ts',
    'src/webviewClient/messageLogAnalysis/render.ts',
    'src/webviewClient/messageLogAnalysis/protocol.ts',
  ]);
}

function ladeStartEmpfaenger(): { handler: MessageHandler; els: Map<string, StubEl>; html: string } {
  const html = _getStartupHtmlForTest(webviewStub, vscode.Uri.file('/ext'), 'PROD');
  return {
    ...runBundle(html, 'window.__mls', 'messageLogStartup', [
      'src/webviewClient/messageLogStartup/index.ts',
      'src/webviewClient/messageLogStartup/protocol.ts',
      'src/utils/fmtSec.ts',
    ]),
    html,
  };
}

describe('language hint in the process run analysis', () => {
  it('shows the hint and leaves the result alone', () => {
    const { handler, els } = ladeEmpfaenger();
    handler({ data: { langHint: 'Server language "FR": …' } });
    expect(els.get('langhint')?.textContent).toBe('Server language "FR": …');
    // No error text, no status line — the message says nothing about the
    // fetch.
    expect(els.get('error')?.textContent ?? '').toBe('');
  });

  it('does NOT fall into the result branch on a hint message', () => {
    const { handler } = ladeEmpfaenger();
    // Without the early `return`, this would be a read of `undefined.stats`.
    expect(() => handler({ data: { langHint: 'x' } })).not.toThrow();
  });

  it('keeps the hint when a result arrives afterwards', () => {
    const { handler, els } = ladeEmpfaenger();
    handler({ data: { langHint: 'Server language "FR": …' } });
    handler({ data: { result: { stats: [], trees: [], entryCount: 0, parsedRuns: 0, ignoredLines: 0 } } });
    // The hint depends on the server language, not on the result: a run that happens
    // to be recognized does not make it wrong.
    expect(els.get('langhint')?.textContent).toBe('Server language "FR": …');
    expect(els.get('status')?.textContent).toContain('0');
  });

  it('still lets an error land in the error field', () => {
    const { handler, els } = ladeEmpfaenger();
    handler({ data: { error: 'HTTP 500' } });
    expect(els.get('error')?.textContent).toBe('HTTP 500');
    expect(els.get('langhint')?.textContent ?? '').toBe('');
  });
});

// ── Startup analysis: the same hint, a receiver of its own ─────────────────────

describe('language hint in the startup analysis', () => {
  it('shows the hint without touching the list or the detail', () => {
    const { handler, els } = ladeStartEmpfaenger();
    handler({ data: { langHint: 'Server language "JPN": …' } });
    expect(els.get('langhint')?.textContent).toBe('Server language "JPN": …');
    expect(els.get('list')?.innerHTML ?? '').toBe('');
    expect(els.get('error')?.textContent ?? '').toBe('');
  });

  it('still lets errors and status through', () => {
    const { handler, els } = ladeStartEmpfaenger();
    handler({ data: { error: 'HTTP 403' } });
    expect(els.get('error')?.textContent).toBe('HTTP 403');
    handler({ data: { status: 'Loading…' } });
    expect(els.get('status')?.textContent).toBe('Loading…');
  });

  it('loads the bundle via scriptUris and renders the list and the duration', () => {
    const { handler, els, html } = ladeStartEmpfaenger();
    expect(html).toContain('src="/ext/out/webview/messageLogStartup.js"');
    handler({ data: { startups: [{ readyTs: '2026-01-02T03:04:00Z', elapsedSec: 125 }] } });
    // fmtSec now comes in by import, not by toString injection.
    expect(els.get('list')?.innerHTML).toContain('<div class="tot">2 min 5 s</div>');
    expect(els.get('list')?.innerHTML).toContain('class="row sel"');
  });
});
