// Runs the built "New Process" wizard bundle (out/webview/newProcess.js) in a vm
// context with a minimal DOM: the wizard logic left the host's template literal,
// and only the built file proves the wiring holds.
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { buildWizardHtml } from '../../commands/processEditor/newProcessWebview';
import { readBuiltBundle } from '../helpers/builtBundle';

type Listener = (ev: Record<string, unknown>) => void;

interface FakeEl {
  id: string; tagName: string; value: string; checked: boolean; textContent: string; className: string;
  style: Record<string, string>; dataset: Record<string, string>;
  listeners: Record<string, Listener[]>;
  classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean };
  addEventListener(t: string, fn: Listener): void;
  focus(): void; getAttribute(): null;
}

function fakeEl(id: string, tagName = 'DIV'): FakeEl {
  const classes = new Set<string>();
  const el: FakeEl = {
    id, tagName, value: '', checked: false, textContent: '', className: '', style: {}, dataset: {},
    listeners: {},
    classList: { add: (c) => { classes.add(c); }, remove: (c) => { classes.delete(c); }, contains: (c) => classes.has(c) },
    addEventListener(t, fn) { (el.listeners[t] ??= []).push(fn); },
    focus() { /* stub */ },
    getAttribute: () => null,
  };
  return el;
}

/** Ids present in the rendered body; anything else answers null like the real DOM. */
function load() {
  const html = buildWizardHtml(['Sales'], ['Region'], [], [], 'csp:', 'newProcess.js');
  const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  expect(inline.filter((s) => s.includes('acquireVsCodeApi'))).toHaveLength(0);
  const globalsScript = inline.filter((s) => s.includes('window.__newProcess'));
  expect(globalsScript).toHaveLength(1);
  expect(html).toContain('src="newProcess.js"');

  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const els = new Map<string, FakeEl>();
  const byId = (id: string): FakeEl | null => {
    if (!ids.has(id)) { return null; }
    if (!els.has(id)) { els.set(id, fakeEl(id, id === 'processName' ? 'INPUT' : 'DIV')); }
    return els.get(id)!;
  };
  byId('dsType')!.value = 'NULL';
  const docListeners: Record<string, Listener[]> = {};
  const posted: unknown[] = [];
  const sandbox = {
    document: {
      getElementById: byId,
      querySelector: () => null,
      querySelectorAll: () => [] as unknown[],
      addEventListener: (t: string, fn: Listener) => { (docListeners[t] ??= []).push(fn); },
    },
    window: { addEventListener: () => { /* stub */ } },
    acquireVsCodeApi: () => ({ postMessage: (m: unknown) => posted.push(m) }),
    setTimeout, clearTimeout,
  };
  createContext(sandbox);
  runInContext(globalsScript[0], sandbox);
  runInContext(readBuiltBundle('newProcess', [
    'src/webviewClient/newProcess/index.ts',
    'src/webviewClient/newProcess/protocol.ts',
  ]), sandbox, { filename: 'newProcess.js' });
  const click = (id: string): void => { for (const fn of byId(id)!.listeners.click ?? []) { fn({}); } };
  const key = (k: string, target: FakeEl): void => {
    for (const fn of docListeners.keydown ?? []) { fn({ key: k, target, preventDefault: () => { /* stub */ } }); }
  };
  return { byId, posted, click, key };
}

describe('New Process wizard bundle', () => {
  it('starts on the name step and refuses to go on without a name', () => {
    const { byId, click } = load();
    expect(byId('step1')!.style.display).toBe('block');
    click('btnNext');
    expect(byId('errName')!.textContent).not.toBe('');
    expect(byId('step1')!.style.display).toBe('block');
  });

  it('name + Enter through the steps creates a NULL-source process', () => {
    const { byId, posted, key } = load();
    const name = byId('processName')!;
    name.value = 'myImport';
    key('Enter', name); // → data source
    key('Enter', name); // → parameters
    key('Enter', name); // NULL source skips variables and finishes
    expect(posted).toEqual([{
      command: 'finish',
      data: { name: 'myImport', templateId: null, dsType: 'NULL', params: [], variables: [] },
    }]);
  });

  it('Escape cancels', () => {
    const { byId, posted, key } = load();
    key('Escape', byId('processName')!);
    expect(posted).toEqual([{ command: 'cancel' }]);
  });
});
