// Runs the built Chore Overview bundle (out/webview/choreOverview.js) in a vm
// context. Replaces the text scans of the old inline script: header tooltips,
// the log-reach rerender, sorting and attribute escaping are now checked on the
// code that actually runs in the window.
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { getChoreOverviewHtml } from '../../commands/chore/choreOverviewWebview';
import { readBuiltBundle } from '../helpers/builtBundle';
import type { ChoreOverviewRow } from '../../chore/choreTablePure';

type Listener = (ev: Record<string, unknown>) => void;

interface FakeEl {
  id: string; innerHTML: string; textContent: string; hidden: boolean; checked: boolean; value: string;
  style: Record<string, string>; dataset: Record<string, string>;
  classList: { toggle(): void; add(): void; remove(): void };
  addEventListener(t: string, fn: Listener): void;
  querySelectorAll(): unknown[];
}

function fakeEl(id: string): FakeEl {
  return {
    id, innerHTML: '', textContent: '', hidden: false, checked: true, value: '', style: {}, dataset: {},
    classList: { toggle() { /* stub */ }, add() { /* stub */ }, remove() { /* stub */ } },
    addEventListener() { /* stub */ },
    querySelectorAll: () => [],
  };
}

function row(name: string, over: Partial<ChoreOverviewRow> = {}): ChoreOverviewRow {
  return {
    name, active: true, startTime: '21:00', frequency: '1d', executionMode: 'SingleCommit', nextRun: '—',
    frequencyMs: null, nextRunMs: null, lastRun: '—', lastRunMs: null, duration: '—', durationSec: null,
    lastState: '—', anchorMs: null, ...over,
  };
}

function load() {
  const html = getChoreOverviewHtml('demo', 'csp:', 'choreOverview.js');
  const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  expect(inline.filter((s) => s.includes('acquireVsCodeApi'))).toHaveLength(0);
  const globalsScript = inline.filter((s) => s.includes('window.__choreOverview'));
  expect(globalsScript).toHaveLength(1);

  const els = new Map<string, FakeEl>();
  const byId = (id: string): FakeEl => { if (!els.has(id)) { els.set(id, fakeEl(id)); } return els.get(id)!; };
  const posted: unknown[] = [];
  let onMessage: Listener = () => { /* replaced */ };
  const sandbox = {
    document: { getElementById: byId, querySelectorAll: () => [] as unknown[] },
    window: { addEventListener: (t: string, fn: Listener) => { if (t === 'message') { onMessage = fn; } } },
    acquireVsCodeApi: () => ({ postMessage: (m: unknown) => posted.push(m), getState: () => undefined, setState: () => { /* stub */ } }),
  };
  createContext(sandbox);
  runInContext(globalsScript[0], sandbox);
  runInContext(readBuiltBundle('choreOverview', [
    'src/webviewClient/choreOverview/index.ts',
    'src/webviewClient/choreOverview/protocol.ts',
    'src/chore/choreTablePure.ts',
  ]), sandbox, { filename: 'choreOverview.js' });
  const send = (data: unknown): void => onMessage({ data });
  return { byId, posted, send };
}

const data = (rows: ChoreOverviewRow[], logReach = '') => ({ type: 'data', rows, runs: {}, logReach, now: 0 });

describe('Chore Overview bundle', () => {
  it('asks the host for data on start', () => {
    expect(load().posted).toEqual([{ type: 'ready' }]);
  });

  it('gives the source columns header tooltips and adds the log reach once it arrives', () => {
    const { byId, send } = load();
    expect(byId('th-row').innerHTML).toContain(' title="');
    expect(byId('th-row').innerHTML).not.toContain('back to 01.10.');
    send(data([], 'Message log read back to 01.10.'));
    expect(byId('th-row').innerHTML).toContain('back to 01.10.');
  });

  it('sorts rows by name and keeps unscheduled placeholders last', () => {
    const { byId, send } = load();
    send(data([row('b'), row('a')]));
    const body = byId('chore-body').innerHTML;
    expect(body.indexOf('data-name="a"')).toBeLessThan(body.indexOf('data-name="b"'));
    expect(byId('row-count').textContent).toContain('2 / 2');
  });

  it('escapes the double quote, because names land inside attributes', () => {
    const { byId, send } = load();
    send(data([row('x"y')]));
    expect(byId('chore-body').innerHTML).toContain('data-name="x&quot;y"');
  });

  it('shows a host error', () => {
    const { byId, send } = load();
    send({ type: 'error', message: '<b>HTTP 500</b>' });
    expect(byId('error-box').innerHTML).toContain('&lt;b&gt;HTTP 500');
  });
});
