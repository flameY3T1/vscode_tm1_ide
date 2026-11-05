// Runs the built reorder-dimensions and cell-security-builder bundles in a vm
// context against their real rendered bodies. Replaces the text scans of the
// former inline scripts: what matters is what the built file does.
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { renderReorderDimsBody } from '../../commands/cube/reorderDimsHtml';
import { renderCellSecurityBuilderBody } from '../../commands/security/cellSecurityBuilderHtml';
import { readBuiltBundle } from '../helpers/builtBundle';

type Listener = (ev: Record<string, unknown>) => void;

interface FakeEl {
  id: string; textContent: string; innerHTML: string; className: string; disabled: boolean;
  listeners: Record<string, Listener[]>;
  classList: { toggle(c: string, on?: boolean): void; contains(c: string): boolean };
  addEventListener(t: string, fn: Listener): void;
}

function fakeEl(id: string, text = ''): FakeEl {
  const classes = new Set<string>();
  const el: FakeEl = {
    id, textContent: text, innerHTML: '', className: '', disabled: false, listeners: {},
    classList: {
      toggle(c, on) { if (on ?? !classes.has(c)) { classes.add(c); } else { classes.delete(c); } },
      contains: (c) => classes.has(c),
    },
    addEventListener(t, fn) { (el.listeners[t] ??= []).push(fn); },
  };
  return el;
}

/** Run `bundle` against `body`: JSON script blocks become element text, the rest stub elements. */
function run(body: string, bundle: string, sources: string[], checked: string[] = []) {
  const json = new Map([...body.matchAll(/<script type="application\/json" id="([^"]+)">([\s\S]*?)<\/script>/g)].map((m) => [m[1], m[2]]));
  const els = new Map<string, FakeEl>();
  const byId = (id: string): FakeEl => { if (!els.has(id)) { els.set(id, fakeEl(id, json.get(id) ?? '')); } return els.get(id)!; };
  const posted: unknown[] = [];
  let onMessage: Listener = () => { /* replaced */ };
  const sandbox = {
    document: {
      getElementById: byId,
      querySelectorAll: () => checked.map((value) => ({ value })),
    },
    window: { addEventListener: (t: string, fn: Listener) => { if (t === 'message') { onMessage = fn; } } },
    acquireVsCodeApi: () => ({ postMessage: (m: unknown) => posted.push(m) }),
  };
  createContext(sandbox);
  runInContext(readBuiltBundle(bundle, sources), sandbox, { filename: bundle + '.js' });
  const click = (id: string): void => { for (const fn of byId(id).listeners.click ?? []) { fn({ target: byId(id) }); } };
  return { byId, posted, click, send: (data: unknown) => onMessage({ data }) };
}

const labels = { current: 'C', recommended: 'R', editable: 'E', use: 'Use', apply: 'Apply', up: 'Up', down: 'Down', lastWarn: 'W' };
const reorder = () => run(
  renderReorderDimsBody({ current: ['A', 'B<1>'], recommended: ['B<1>', 'A'], counts: { A: 3, 'B<1>': null } }, labels),
  'reorderDims', ['src/webviewClient/reorderDims/index.ts', 'src/webviewClient/reorderDims/protocol.ts'],
);

describe('reorder-dimensions bundle', () => {
  it('renders the editable list escaped, Apply off while nothing changed', () => {
    const { byId } = reorder();
    expect(byId('editable').innerHTML).toContain('B&lt;1&gt;');
    expect(byId('apply').disabled).toBe(true);
  });

  it('"use recommended" arms Apply and warns about the changed last dimension', () => {
    const { byId, click } = reorder();
    click('use-recommended');
    expect(byId('apply').disabled).toBe(false);
    expect(byId('last-warn').classList.contains('hidden')).toBe(false);
  });

  it('applies the new order and rebaselines on success', () => {
    const { byId, click, posted, send } = reorder();
    click('use-recommended');
    click('apply');
    expect(posted).toEqual([{ type: 'apply', order: ['B<1>', 'A'] }]);
    send({ type: 'applied', current: ['B<1>', 'A'], counts: {}, message: 'done' });
    expect(byId('apply').disabled).toBe(true);
    expect(byId('result').className).toBe('result ok');
  });

  it('a neutral info re-enables Apply without the error style', () => {
    const { byId, click, send } = reorder();
    click('use-recommended');
    click('apply');
    send({ type: 'info', message: 'Cancelled.' });
    expect(byId('apply').disabled).toBe(false);
    expect(byId('result').className).toBe('result');
  });
});

describe('cell-security builder bundle', () => {
  const body = renderCellSecurityBuilderBody('Sales', ['Region', 'Year', 'Product'], { heading: 'H', hint: 'h', groupsRow: 'g', create: 'Create' });
  const sources = ['src/webviewClient/cellSecurityBuilder/index.ts', 'src/webviewClient/cellSecurityBuilder/protocol.ts'];

  it('posts the checked dimensions in source order', () => {
    const { click, posted } = run(body, 'cellSecurityBuilder', sources, ['Product', 'Region']);
    click('create');
    expect(posted).toEqual([{ type: 'create', selected: ['Region', 'Product'] }]);
  });

  it('keeps Create off with nothing checked and shows a host error', () => {
    const { byId, send } = run(body, 'cellSecurityBuilder', sources, []);
    expect(byId('create').disabled).toBe(true);
    send({ type: 'error', message: 'HTTP 400' });
    expect(byId('result').textContent).toBe('HTTP 400');
    expect(byId('create').disabled).toBe(false);
  });
});
