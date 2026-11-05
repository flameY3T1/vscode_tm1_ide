/**
 * Lineage window: the host page and the BUILT bundle (out/webview/lineage.js).
 * Since 10-04 the window script is a bundle instead of inline text; only the
 * bundle runs in the window, so the test runs the bundle in a node:vm context
 * with a minimal DOM and feeds it real host messages.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { createContext, runInContext } from 'vm';
import * as vscode from 'vscode';
import { getLineageHtml } from '../../references/lineage';
import type { LineageBootstrap } from '../../webviewClient/lineage/protocol';

const ROOT = join(__dirname, '../../..');
const BUNDLE = join(ROOT, 'out/webview/lineage.js');
const BUNDLE_SOURCES = [
  'src/webviewClient/lineage/index.ts',
  'src/webviewClient/lineage/protocol.ts',
  'src/references/lineagePure.ts',
].map(p => join(ROOT, p));

/** A missing or stale bundle fails loudly instead of passing silently. */
function readBundle(): string {
  if (!existsSync(BUNDLE)) {
    throw new Error(`The built webview bundle is missing: ${BUNDLE} — run \`npm run compile\`.`);
  }
  const built = statSync(BUNDLE).mtimeMs;
  const stale = BUNDLE_SOURCES.filter(p => existsSync(p) && statSync(p).mtimeMs > built);
  if (stale.length) {
    throw new Error(`The bundle ${BUNDLE} is older than ${stale.join(', ')} — run \`npm run compile\`.`);
  }
  return readFileSync(BUNDLE, 'utf8');
}

const webview = { cspSource: 'vscode-webview:', asWebviewUri: (u: unknown) => u } as unknown as vscode.Webview;
const ext = vscode.Uri.file('/ext');

function bootstrapOf(html: string): LineageBootstrap {
  const m = /window\.__lineage = (.*);/.exec(html);
  if (!m) { throw new Error('window.__lineage missing in the HTML'); }
  return JSON.parse(m[1].replace(/\\u003c/g, '<')) as LineageBootstrap;
}

// ── Minimal DOM ─────────────────────────────────────────────────────────────
class FakeEl {
  hidden = false;
  disabled = false;
  title = '';
  textContent = '';
  innerHTML = '';
  dataset: Record<string, string> = {};
  private cls = new Set<string>();
  listeners: Record<string, ((ev: unknown) => void)[]> = {};
  classList = {
    toggle: (c: string, on?: boolean) => { if (on ?? !this.cls.has(c)) { this.cls.add(c); } else { this.cls.delete(c); } },
    contains: (c: string) => this.cls.has(c),
    add: (c: string) => { this.cls.add(c); },
    remove: (...cs: string[]) => cs.forEach(c => this.cls.delete(c)),
  };
  addEventListener(t: string, fn: (ev: unknown) => void): void { (this.listeners[t] ??= []).push(fn); }
  querySelector(): null { return null; }
  click(): void { (this.listeners.click ?? []).forEach(fn => fn({})); }
}

function runBundle(boot: LineageBootstrap, withBack: boolean) {
  const ids = ['status', 'wrap', 'mode-obj', 'mode-cube', 'overview', 'legend-obj', 'legend-cube', 'hint', 'crumb', 'refresh'];
  if (withBack) { ids.push('back'); }
  const els = new Map(ids.map(id => [id, new FakeEl()]));
  const srcButtons = ['off', 'sys', 'detail'].map(s => { const b = new FakeEl(); b.dataset.src = s; return b; });
  const posted: Array<Record<string, unknown>> = [];
  const windowListeners: Array<(ev: { data: unknown }) => void> = [];
  let state: unknown;
  const sandbox: Record<string, unknown> = {
    acquireVsCodeApi: () => ({
      postMessage: (m: Record<string, unknown>) => posted.push(m),
      getState: () => state,
      setState: (s: unknown) => { state = s; },
    }),
    document: {
      getElementById: (id: string) => els.get(id) ?? null,
      querySelectorAll: (sel: string) => (sel === '[data-src]' ? srcButtons : []),
    },
  };
  sandbox.window = {
    __lineage: boot,
    addEventListener: (t: string, fn: (ev: { data: unknown }) => void) => { if (t === 'message') { windowListeners.push(fn); } },
  };
  createContext(sandbox);
  runInContext(readBundle(), sandbox, { filename: 'lineage.js' });
  const send = (data: unknown) => windowListeners.forEach(fn => fn({ data }));
  return { els, srcButtons, posted, send, state: () => state };
}

const GRAPH = {
  nodes: [
    { id: 'chore:nightly', kind: 'chore', name: 'Nightly' },
    { id: 'process:load', kind: 'process', name: 'Load' },
    { id: 'cube:sales', kind: 'cube', name: 'Sales' },
    { id: 'cube:report', kind: 'cube', name: 'Report' },
  ],
  edges: [
    { from: 'chore:nightly', to: 'process:load', kind: 'calls' },
    { from: 'cube:sales', to: 'process:load', kind: 'reads' },
    { from: 'process:load', to: 'cube:report', kind: 'writes' },
  ],
};
const CUBE_GRAPH = {
  nodes: [{ id: 'cube:sales', kind: 'cube', name: 'Sales' }, { id: 'cube:report', kind: 'cube', name: 'Report' }],
  edges: [{ from: 'cube:sales', to: 'cube:report', processes: ['Load'], rule: false }],
};

describe('lineage page (host)', () => {
  const html = getLineageHtml(webview, ext, { focusId: 'cube:sales', focusName: 'Sales', backLabel: 'Usages' });

  it('loads the bundle instead of an inline script', () => {
    expect(html).toContain('out/webview/lineage.js');
    expect(html).not.toContain('acquireVsCodeApi');
  });

  it('names the page like the tab that opens it', () => {
    expect(html).toContain('<button class="tab active">Lineage</button>');
  });

  it('hands focus and texts to the bundle', () => {
    const boot = bootstrapOf(html);
    expect(boot).toMatchObject({ initialFocus: 'cube:sales', initialName: 'Sales', inTab: true, highlightId: null });
    expect(boot.texts.title).toBe('Lineage');
  });

  it('the server overview has no back tab and needs no focus', () => {
    const overview = getLineageHtml(webview, ext, { highlightId: 'cube:sales' });
    expect(overview).not.toContain('id="back"');
    expect(bootstrapOf(overview)).toMatchObject({ initialFocus: null, inTab: false, highlightId: 'cube:sales' });
  });
});

describe('lineage page (built bundle)', () => {
  it('object tab: asks for data, draws the dependency chain, back and server buttons post', () => {
    const boot = bootstrapOf(getLineageHtml(webview, ext, { focusId: 'process:load', focusName: 'Load', backLabel: 'Call graph' }));
    const { els, posted, send, state } = runBundle(boot, true);
    expect(posted).toEqual([{ type: 'mapReady' }]);
    send({ type: 'mapData', graph: GRAPH, cubeGraph: CUBE_GRAPH });
    const svg = els.get('wrap')!.innerHTML;
    // focusGraph (imported, no longer toString-injected) keeps chore, process and both cubes.
    for (const id of ['chore:nightly', 'process:load', 'cube:sales', 'cube:report']) { expect(svg).toContain(`data-id="${id}"`); }
    expect(svg).toContain('class="edge calls"');
    expect(els.get('crumb')!.textContent).toBe('Load');
    expect(els.get('overview')!.hidden).toBe(false);
    expect(state()).toMatchObject({ lineageFocus: 'process:load', lineageMode: 'obj', lineageSources: 'sys' });
    els.get('back')!.click();
    els.get('overview')!.click();
    expect(posted.slice(1)).toEqual([{ type: 'mapBack' }, { type: 'lineageServer', id: 'process:load' }]);
  });

  it('data flow: flowChain draws the cube edge with its process tooltip', () => {
    const boot = bootstrapOf(getLineageHtml(webview, ext, { focusId: 'cube:sales', focusName: 'Sales', backLabel: 'Usages' }));
    const { els, send } = runBundle(boot, true);
    send({ type: 'mapData', graph: GRAPH, cubeGraph: CUBE_GRAPH });
    els.get('mode-cube')!.click();
    const svg = els.get('wrap')!.innerHTML;
    expect(svg).toContain('class="edge flow"');
    expect(svg).toContain('Sales → Report\nvia: Load');
    expect(els.get('legend-cube')!.hidden).toBe(false);
  });

  it('overview: starts on the whole server, no focus disables Dependencies', () => {
    const boot = bootstrapOf(getLineageHtml(webview, ext, {}));
    const { els, send } = runBundle(boot, false);
    send({ type: 'mapData', graph: GRAPH, cubeGraph: CUBE_GRAPH });
    expect((els.get('mode-obj') as FakeEl).disabled).toBe(true);
    expect(els.get('crumb')!.textContent).toBe(boot.texts.overview);
    expect(els.get('wrap')!.innerHTML).toContain('data-id="cube:report"');
  });

  it('shows a host error escaped', () => {
    const boot = bootstrapOf(getLineageHtml(webview, ext, {}));
    const { els, send } = runBundle(boot, false);
    send({ type: 'mapError', message: 'a<b' });
    expect(els.get('status')!.innerHTML).toBe('<div class="err">a&lt;b</div>');
  });
});
