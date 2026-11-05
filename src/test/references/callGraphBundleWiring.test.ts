// Runs the built call-graph bundle (out/webview/callGraph.js) in a vm context:
// the page's click wiring left the host's template literal, and only the built
// file proves it holds. The chore and usage bundles share wireMapTab with it.
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { readBuiltBundle } from '../helpers/builtBundle';

type Listener = (ev: Record<string, unknown>) => void;

interface FakeEl {
  dataset: Record<string, string>;
  attrs: Record<string, string>;
  value: string;
  listeners: Record<string, Listener[]>;
  closest(sel: string): FakeEl | null;
  addEventListener(t: string, fn: Listener): void;
  setAttribute(k: string, v: string): void;
  removeAttribute(k: string): void;
  getAttribute(k: string): string | null;
}

function fakeEl(dataset: Record<string, string> = {}, matches: string[] = [], parent: FakeEl | null = null): FakeEl {
  const el: FakeEl = {
    dataset, attrs: {}, value: '', listeners: {},
    closest(sel) { return matches.includes(sel) ? el : parent ? parent.closest(sel) : null; },
    addEventListener(t, fn) { (el.listeners[t] ??= []).push(fn); },
    setAttribute(k, v) { el.attrs[k] = v; },
    removeAttribute(k) { delete el.attrs[k]; },
    getAttribute(k) { return el.attrs[k] ?? null; },
  };
  return el;
}

function load() {
  const runSelect = fakeEl();
  const docListeners: Listener[] = [];
  const posted: unknown[] = [];
  const sandbox = {
    document: {
      getElementById: (id: string) => (id === 'run-select' ? runSelect : null),
      querySelectorAll: () => [] as FakeEl[],
      addEventListener: (t: string, fn: Listener) => { if (t === 'click') { docListeners.push(fn); } },
    },
    window: {},
    acquireVsCodeApi: () => ({ postMessage: (m: unknown) => posted.push(m) }),
  };
  createContext(sandbox);
  runInContext(readBuiltBundle('callGraph', [
    'src/webviewClient/callGraph/index.ts',
    'src/webviewClient/_shared/mapTab.ts',
  ]), sandbox, { filename: 'callGraph.js' });
  const click = (target: FakeEl): void => {
    for (const fn of docListeners) { fn({ target, stopPropagation: () => { /* stub */ } }); }
  };
  return { runSelect, posted, click };
}

describe('call graph bundle', () => {
  it('opens a process or a chore from its node', () => {
    const { posted, click } = load();
    const proc = fakeEl({ proc: 'Load', kind: 'process' }, ['.node']);
    click(fakeEl({ action: 'open' }, [], proc));
    const chore = fakeEl({ proc: 'Nightly', kind: 'chore' }, ['.node']);
    click(fakeEl({ action: 'open' }, [], chore));
    expect(posted).toEqual([
      { type: 'openProcess', processName: 'Load' },
      { type: 'openChore', choreName: 'Nightly' },
    ]);
  });

  it('switches direction from the badge inside a tab', () => {
    const { posted, click } = load();
    const tab = fakeEl({ dir: 'upstream' }, ['[data-dir]']);
    click(fakeEl({}, [], tab));
    expect(posted).toEqual([{ type: 'switchDirection', direction: 'upstream' }]);
  });

  it('asks for the lineage map from its tab', () => {
    const { posted, click } = load();
    click(fakeEl({}, ['[data-map-tab]']));
    expect(posted).toContainEqual({ type: 'showMap' });
  });

  it('selects a run', () => {
    const { runSelect, posted } = load();
    runSelect.value = '2026-10-28T10:00:00Z';
    for (const fn of runSelect.listeners.change ?? []) { fn({}); }
    expect(posted).toEqual([{ type: 'selectRun', startedAt: '2026-10-28T10:00:00Z' }]);
  });
});
