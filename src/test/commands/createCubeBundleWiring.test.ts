// Runs the built "New Cube" bundle (out/webview/createCube.js) in a vm context
// with a minimal DOM: the dialog logic left the host's template literal, and
// only the built file proves the wiring holds.
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { getCreateCubeHtml } from '../../commands/cubeViewer/createCube';
import { readBuiltBundle } from '../helpers/builtBundle';

type Listener = (ev: Record<string, unknown>) => void;

interface FakeEl {
  id: string; value: string; checked: boolean; disabled: boolean; textContent: string;
  innerHTML: string; className: string; children: FakeEl[];
  classList: { add(c: string): void; contains(c: string): boolean };
  listeners: Record<string, Listener[]>;
  addEventListener(t: string, fn: Listener): void;
  appendChild(c: FakeEl): void;
  click(): void;
}

function fakeEl(id = ''): FakeEl {
  const classes = new Set<string>();
  const el: FakeEl = {
    id, value: '', checked: false, disabled: false, textContent: '', className: '', children: [],
    get innerHTML() { return ''; },
    set innerHTML(_v: string) { el.children = []; },
    classList: { add: (c) => { classes.add(c); }, contains: (c) => classes.has(c) },
    listeners: {},
    addEventListener(t, fn) { (el.listeners[t] ??= []).push(fn); },
    appendChild(c) { el.children.push(c); },
    click() { for (const fn of el.listeners.click ?? []) { fn({}); } },
  };
  return el;
}

const fire = (el: FakeEl, type: string, ev: Record<string, unknown> = {}): void => {
  for (const fn of el.listeners[type] ?? []) { fn({ preventDefault: () => { /* stub */ }, ...ev }); }
};

function load(dimensions: string[]) {
  const html = getCreateCubeHtml(dimensions, 'csp:', 'createCube.js');
  const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  expect(inline.filter((s) => s.includes('acquireVsCodeApi'))).toHaveLength(0);
  const globalsScript = inline.filter((s) => s.includes('window.__createCube'));
  expect(globalsScript).toHaveLength(1);

  const els = new Map<string, FakeEl>();
  const byId = (id: string): FakeEl => { if (!els.has(id)) { els.set(id, fakeEl(id)); } return els.get(id)!; };
  const docListeners: Record<string, Listener[]> = {};
  const posted: unknown[] = [];
  let onMessage: Listener = () => { /* replaced */ };
  const sandbox = {
    document: {
      getElementById: byId,
      createElement: () => fakeEl(),
      addEventListener: (t: string, fn: Listener) => { (docListeners[t] ??= []).push(fn); },
    },
    window: { addEventListener: (t: string, fn: Listener) => { if (t === 'message') { onMessage = fn; } } },
    acquireVsCodeApi: () => ({ postMessage: (m: unknown) => posted.push(m) }),
  };
  createContext(sandbox);
  runInContext(globalsScript[0], sandbox);
  runInContext(readBuiltBundle('createCube', [
    'src/webviewClient/createCube/index.ts',
    'src/webviewClient/createCube/protocol.ts',
  ]), sandbox, { filename: 'createCube.js' });
  return { byId, posted, onMessage: (data: unknown) => onMessage({ data }) };
}

/** Double-click the list entry with this text. */
function dbl(list: FakeEl, text: string): void {
  const li = list.children.find((c) => c.textContent === text);
  expect(li, text).toBeDefined();
  fire(li!, 'dblclick');
}

describe('New Cube bundle', () => {
  it('lists dimensions, hides control objects by default', () => {
    const { byId } = load(['Year', '}Clients', 'Region']);
    expect(byId('dimList').children.map((c) => c.textContent)).toEqual(['Year', 'Region']);
  });

  it('enables submit only with a name and two dimensions, then posts them in order', () => {
    const { byId, posted } = load(['Year', 'Region', 'Measure']);
    byId('cubeName').value = 'Sales';
    fire(byId('cubeName'), 'input');
    expect(byId('submit').disabled).toBe(true);
    expect(byId('err').textContent).not.toBe('');
    dbl(byId('dimList'), 'Region');
    dbl(byId('dimList'), 'Year');
    expect(byId('submit').disabled).toBe(false);
    byId('submit').click();
    expect(posted).toEqual([{ type: 'submit', name: 'Sales', dimensions: ['Region', 'Year'] }]);
  });

  it('sends dimension names raw — an & is not turned into &amp;', () => {
    // The old inline script got the names HTML-escaped and posted them back that
    // way, so validateCubeDims rejected "P&L" as an unknown dimension.
    const { byId, posted } = load(['P&L', 'Year']);
    expect(byId('dimList').children.map((c) => c.textContent)).toEqual(['P&L', 'Year']);
    byId('cubeName').value = 'C';
    dbl(byId('dimList'), 'P&L');
    dbl(byId('dimList'), 'Year');
    byId('submit').click();
    expect(posted).toEqual([{ type: 'submit', name: 'C', dimensions: ['P&L', 'Year'] }]);
  });

  it('shows a host validation error', () => {
    const { byId, onMessage } = load(['A', 'B']);
    onMessage({ type: 'validationError', message: 'Cube exists' });
    expect(byId('err').textContent).toBe('Cube exists');
  });

  it('cancel posts cancel', () => {
    const { byId, posted } = load(['A', 'B']);
    byId('cancel').click();
    expect(posted).toEqual([{ type: 'cancel' }]);
  });
});
