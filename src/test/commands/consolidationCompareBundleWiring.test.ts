// Guard for the WIRING of the consolidation compare webview: loads the BUILT
// bundle `out/webview/consolidationCompare.js` into a `node:vm` context with a
// minimal DOM and drives it with real host messages and clicks.
//
// `tsc -p ./` excludes `src/webviewClient/`, and the pure maths has its own
// tests — only the bundle proves that message, render and click handlers
// reach each other. Same approach as addServerBundleWiring.test.ts.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { createContext, runInContext } from 'vm';
import { consolidationCompareBody } from '../../webviews/consolidationCompareBody';
import type { L10nMap } from '../../webviewClient/_shared/l10n';
import type { Edge } from '../../consolidationCompare/comparePure';

const ROOT = join(__dirname, '../../..');
const BUNDLE = join(ROOT, 'out/webview/consolidationCompare.js');
const BUNDLE_SOURCES = [
  'src/webviewClient/consolidationCompare/index.ts',
  'src/consolidationCompare/comparePure.ts',
  'src/consolidationCompare/protocol.ts',
  'src/webviewClient/_shared/l10n.ts',
].map(p => join(ROOT, p));

function readBundle(): string {
  if (!existsSync(BUNDLE)) {
    throw new Error(`Built webview bundle missing: ${BUNDLE}\nRun \`npm run compile\` first.`);
  }
  const built = statSync(BUNDLE).mtimeMs;
  const stale = BUNDLE_SOURCES.filter(p => existsSync(p) && statSync(p).mtimeMs > built);
  if (stale.length) {
    throw new Error(`Bundle older than its sources:\n  ${stale.map(p => p.slice(ROOT.length + 1)).join('\n  ')}\nRun \`npm run compile\`.`);
  }
  return readFileSync(BUNDLE, 'utf8');
}

// The client renders through innerHTML and delegates clicks on `document`, so
// the fake elements only keep the markup string; clicks are dispatched with a
// target that answers `closest`, `matches` and `dataset` like the real one.
class FakeEl {
  innerHTML = '';
  textContent = '';
  hidden = false;
  disabled = false;
  checked = false;
  value = '';
  options: Array<{ value: string; hidden: boolean }> = [];
  constructor(readonly id: string) {}
}

function ids(markup: string): string[] {
  return [...markup.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
}

/** The compared-roots bar: chips, the add picker and the source groups. */
const cmpHtml = (h: { el(id: string): FakeEl }): string =>
  ['cmpChips', 'addRoot', 'srcGroups'].map(id => h.el(id).innerHTML).join('');

const L10N_ECHO = new Proxy({}, { get: (_t, k) => String(k) }) as L10nMap;

function mount() {
  const byId = new Map(ids(consolidationCompareBody(L10N_ECHO)).map(id => [id, new FakeEl(id)]));
  const posted: Array<Record<string, unknown>> = [];
  const doc: Record<string, Array<(ev: unknown) => void>> = {};
  let onMessage: ((ev: { data: unknown }) => void) | null = null;

  const sandbox: Record<string, unknown> = {
    console,
    document: {
      getElementById: (id: string) => byId.get(id) ?? null,
      addEventListener: (t: string, fn: (ev: unknown) => void) => { (doc[t] ??= []).push(fn); },
    },
    window: {
      addEventListener: (t: string, fn: (ev: { data: unknown }) => void) => { if (t === 'message') { onMessage = fn; } },
    },
    acquireVsCodeApi: () => ({ postMessage: (m: Record<string, unknown>) => posted.push(m) }),
    __l10n: L10N_ECHO,
  };
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  runInContext(readBundle(), sandbox, { filename: 'consolidationCompare.js' });

  const el = (id: string): FakeEl => {
    const e = byId.get(id);
    if (!e) { throw new Error(`no #${id} in the body markup`); }
    return e;
  };
  const click = (t: { id?: string; cell?: boolean; dataset?: Record<string, string> }): void => {
    const target = {
      id: t.id ?? '',
      dataset: t.dataset ?? {},
      matches: (sel: string) => sel === 'td.cell' && !!t.cell,
      closest: () => target,
    };
    for (const fn of doc.click ?? []) { fn({ target }); }
  };
  const change = (t: { id?: string; value?: string; checked?: boolean; dataset?: Record<string, string> }): void => {
    const target = { id: t.id ?? '', value: t.value ?? '', checked: !!t.checked, dataset: t.dataset ?? {} };
    for (const fn of doc.change ?? []) { fn({ target }); }
  };
  const input = (id: string, value: string): void => {
    for (const fn of doc.input ?? []) { fn({ target: { id, value } }); }
  };
  return {
    el,
    click,
    change,
    input,
    posted,
    send: (data: unknown) => { (onMessage as unknown as (ev: { data: unknown }) => void)({ data }); },
  };
}

const E = (rows: Array<[string, string, number]>): Edge[] => rows.map(([parent, child, weight]) => ({ parent, child, weight }));

// Legal is right; Region hangs B twice (via M and directly) and misses C.
const EDGES = E([
  ['Legal', 'A', 1], ['Legal', 'B', 1], ['Legal', 'C', 1],
  ['Region', 'M', 1], ['M', 'A', 1], ['M', 'B', 1], ['Region', 'B', 1],
]);

/** Reference Legal, compare Region, click Compare. */
function pick(h: ReturnType<typeof mount>): void {
  h.change({ id: 'ref', value: 'Legal' });
  h.change({ id: 'addRoot', value: 'Region' });
  h.click({ id: 'compare' });
}

describe('consolidationCompare bundle: wiring in the built artefact', () => {
  it('asks for the edges on start', () => {
    const h = mount();
    expect(h.posted).toEqual([{ type: 'ready' }]);
  });

  it('renders counts, opens a cell, and a draft change turns the tile green', () => {
    const h = mount();
    h.send({ type: 'edges', dim: 'D', hier: 'D', edges: EDGES, aliases: [], elements: [], hierarchies: [], leaves: ['A', 'B', 'C'], attributes: ['Land'], view: { ref: '', cmp: [], alias: '', scopeAttr: '', scopeValue: '', group: false, onlyDiff: true } });

    // Nothing is compared until roots are picked and Compare is clicked.
    expect(h.el('main').hidden).toBe(true);
    expect(h.el('status').textContent).toBe('pickRoots');
    pick(h);

    expect(h.el('main').hidden).toBe(false);
    const tiles = h.el('tiles').innerHTML;
    expect(tiles).toContain('Legal');
    expect(tiles).toMatch(/data-filter="Region" data-cls="double">1 /);
    expect(tiles).toMatch(/data-filter="Region" data-cls="missing">1 /);
    // Only differences: B and C, not A.
    expect(h.el('matrix').innerHTML).toContain('data-leaf="B"');
    expect(h.el('matrix').innerHTML).not.toContain('data-leaf="A"');

    h.click({ cell: true, dataset: { leaf: 'B', root: 'Region' } });
    const detail = h.el('detail').innerHTML;
    const [own, inRef] = detail.split('inReference');
    expect(own.match(/class="path mono"/g)).toHaveLength(2);
    expect(inRef.match(/class="path mono"/g)).toHaveLength(1);

    // Select the direct edge Region→B and remove it.
    h.click({ dataset: { edge: 'Region', edgec: 'B' } });
    h.click({ dataset: { act: 'remove' } });
    expect(h.el('changes').innerHTML).toContain('Region → B');
    expect(h.el('tiles').innerHTML).toMatch(/data-filter="Region" data-cls="double" disabled>0 /);

    // Undo brings the double back.
    h.click({ id: 'undo' });
    expect(h.el('tiles').innerHTML).toMatch(/data-filter="Region" data-cls="double">1 /);
  });

  it('posts the change list as CSV on export', () => {
    const h = mount();
    h.send({ type: 'edges', dim: 'D', hier: 'D', edges: EDGES, aliases: [], elements: [], hierarchies: [], leaves: ['A', 'B', 'C'], attributes: ['Land'], view: { ref: '', cmp: [], alias: '', scopeAttr: '', scopeValue: '', group: false, onlyDiff: true } });
    pick(h);
    h.click({ cell: true, dataset: { leaf: 'B', root: 'Region' } });
    h.click({ dataset: { edge: 'Region', edgec: 'B' } });
    h.click({ dataset: { act: 'remove' } });
    h.click({ id: 'exportChanges' });
    expect(h.posted.at(-1)).toEqual({
      type: 'export', kind: 'changes', name: 'D_changes.csv',
      text: 'Action;Parent;Child;Weight\nremove;Region;B;',
    });
  });

  it('posts the draft on save, and a saved reply clears it', () => {
    const h = mount();
    h.send({ type: 'edges', dim: 'D', hier: 'D', edges: EDGES, aliases: [], elements: [], hierarchies: [], leaves: ['A', 'B', 'C'], attributes: ['Land'], view: { ref: '', cmp: [], alias: '', scopeAttr: '', scopeValue: '', group: false, onlyDiff: true } });
    pick(h);
    h.click({ cell: true, dataset: { leaf: 'B', root: 'Region' } });
    h.click({ dataset: { edge: 'Region', edgec: 'B' } });
    h.click({ dataset: { act: 'remove' } });
    h.click({ id: 'save' });
    expect(h.posted.at(-1)).toEqual({
      type: 'save', base: EDGES, changes: [{ action: 'remove', parent: 'Region', child: 'B' }],
    });
    expect(h.el('save').disabled).toBe(true);

    h.send({ type: 'saved', edges: EDGES.filter(e => !(e.parent === 'Region' && e.child === 'B')) });
    expect(h.el('changes').innerHTML).not.toContain('Region → B');
    expect(h.el('tiles').innerHTML).toMatch(/data-filter="Region" data-cls="double" disabled>0 /);
    expect(h.el('saveMsg').innerHTML).toContain('saved');
  });

  it('keeps the draft on a conflict', () => {
    const h = mount();
    h.send({ type: 'edges', dim: 'D', hier: 'D', edges: EDGES, aliases: [], elements: [], hierarchies: [], leaves: ['A', 'B', 'C'], attributes: ['Land'], view: { ref: '', cmp: [], alias: '', scopeAttr: '', scopeValue: '', group: false, onlyDiff: true } });
    pick(h);
    h.click({ cell: true, dataset: { leaf: 'B', root: 'Region' } });
    h.click({ dataset: { edge: 'Region', edgec: 'B' } });
    h.click({ dataset: { act: 'remove' } });
    h.click({ id: 'save' });
    h.send({ type: 'saveFailed', conflict: true, message: '', edges: EDGES });
    expect(h.el('changes').innerHTML).toContain('Region → B');
    expect(h.el('saveMsg').innerHTML).toContain('conflict');
    expect(h.el('save').disabled).toBe(false);
  });

  it('after a partial save, a re-added edge whose weight was written is not removed', () => {
    const h = mount();
    h.send({ type: 'edges', dim: 'D', hier: 'D', edges: EDGES, aliases: [], elements: ['Legal', 'Region', 'M', 'A', 'B', 'C'], hierarchies: [], leaves: ['A', 'B', 'C'], attributes: ['Land'], view: { ref: '', cmp: [], alias: '', scopeAttr: '', scopeValue: '', group: false, onlyDiff: true } });
    h.el('importText').value = 'Region;M;1\nRegion;B;2\nRegion;C;1';
    h.click({ id: 'importPaste' });
    pick(h);
    h.click({ cell: true, dataset: { leaf: 'B', root: 'Region' } });
    h.click({ dataset: { edge: 'Region', edgec: 'B' } });
    h.click({ dataset: { act: 'remove' } });
    h.change({ dataset: { target: '\u00011' }, value: 'Region' });
    h.click({ dataset: { applyimport: '\u00011' } });
    h.click({ id: 'save' });
    // The weight of Region→B was written, adding Region→C failed.
    const server = EDGES.map(e => (e.parent === 'Region' && e.child === 'B' ? { ...e, weight: 2 } : e));
    h.send({ type: 'saveFailed', conflict: false, message: 'boom', edges: server });
    const draft = h.el('changes').innerHTML;
    expect(draft).not.toContain('Region → B');
    expect(draft).toContain('+ Region → C (1)');
  });

  it('ignores draft edits while a save runs, so a successful save loses nothing', () => {
    const h = mount();
    h.send({ type: 'edges', dim: 'D', hier: 'D', edges: EDGES, aliases: [], elements: [], hierarchies: [], leaves: ['A', 'B', 'C'], attributes: ['Land'], view: { ref: '', cmp: [], alias: '', scopeAttr: '', scopeValue: '', group: false, onlyDiff: true } });
    pick(h);
    h.click({ cell: true, dataset: { leaf: 'A', root: 'Region' } });
    h.click({ dataset: { edge: 'M', edgec: 'A' } });
    h.click({ dataset: { act: 'remove' } });
    h.click({ id: 'save' });
    expect(h.el('changes').innerHTML).toContain('data-drop="0" disabled');
    h.click({ cell: true, dataset: { leaf: 'B', root: 'Region' } });
    h.click({ dataset: { edge: 'Region', edgec: 'B' } });
    h.click({ dataset: { act: 'remove' } });
    h.click({ dataset: { drop: '0' } });
    expect(h.el('changes').innerHTML).not.toContain('Region → B');
    expect(h.el('changes').innerHTML).toContain('M → A');
  });

  it('adds a pasted edge list as a read-only column, matched case-insensitively', () => {
    const h = mount();
    h.send({ type: 'edges', dim: 'D', hier: 'D', edges: EDGES, aliases: [], elements: ['Legal', 'Region', 'M', 'A', 'B', 'C', 'Spare'], hierarchies: [], leaves: ['A', 'B', 'C'], attributes: ['Land'], view: { ref: '', cmp: [], alias: '', scopeAttr: '', scopeValue: '', group: false, onlyDiff: true } });
    h.el('importText').value = 'Parent;Child;Weight\nNew;a;1\nNew;b;1\nNew;c;1\nNew;Ghost;1';
    h.click({ id: 'importPaste' });
    expect(cmpHtml(h)).toContain('class="srcwarn"');
    expect(cmpHtml(h)).toContain('data-uncmp="\u00011"');

    h.change({ id: 'ref', value: 'Legal' });
    h.click({ id: 'compare' });
    // a/b/c matched to A/B/C, Ghost is the only extra.
    expect(h.el('tiles').innerHTML).toMatch(/data-cls="extra">1 /);
    expect(h.el('tiles').innerHTML).toMatch(/data-cls="ok">3 /);

    h.click({ cell: true, dataset: { leaf: 'Ghost', root: '\u00011' } });
    expect(h.el('detail').innerHTML).not.toContain('data-act=');
  });

  it('removes a whole source group with one click', () => {
    const h = mount();
    h.send({ type: 'edges', dim: 'D', hier: 'D', edges: EDGES, aliases: [], elements: ['Legal', 'Region', 'M', 'A', 'B', 'C'], hierarchies: [], leaves: ['A', 'B', 'C'], attributes: ['Land'], view: { ref: '', cmp: [], alias: '', scopeAttr: '', scopeValue: '', group: false, onlyDiff: true } });
    h.el('importText').value = 'X;A;1\nY;B;1';
    h.click({ id: 'importPaste' });
    expect(cmpHtml(h).match(/data-uncmp="\u0001/g)).toHaveLength(2);
    h.click({ dataset: { dropgroup: '1' } });
    expect(cmpHtml(h)).not.toContain('srcgroup');
  });

  it('applies an imported list to a server root as draft changes', () => {
    const h = mount();
    h.send({ type: 'edges', dim: 'D', hier: 'D', edges: EDGES, aliases: [], elements: ['Legal', 'Region', 'M', 'A', 'B', 'C'], hierarchies: [], leaves: ['A', 'B', 'C'], attributes: ['Land'], view: { ref: '', cmp: [], alias: '', scopeAttr: '', scopeValue: '', group: false, onlyDiff: true } });
    // The list says Region = M + C, M = A + B: drop the direct Region→B, add Region→C.
    h.el('importText').value = 'Region;M;1\nRegion;c;1\nM;A;1\nM;B;1';
    h.click({ id: 'importPaste' });
    // Apply sits on the column tile, so it only exists after a comparison.
    h.click({ dataset: { applyimport: '\u00011' } });
    expect(h.el('tiles').innerHTML).toBe('');
    h.change({ id: 'ref', value: 'Legal' });
    h.click({ id: 'compare' });
    expect(h.el('changes').innerHTML).not.toContain('Region');
    h.click({ dataset: { applyimport: '\u00011' } });
    const draft = h.el('changes').innerHTML;
    expect(draft).toContain('− Region → B');
    expect(draft).toContain('+ Region → C (1)');

    // Region was added as a compared column and now matches the reference exactly.
    expect(h.el('tiles').innerHTML).toMatch(/data-filter="Region" data-cls="ok">3 /);
  });

  it('compares against another hierarchy and uses it as reference', () => {
    const h = mount();
    h.send({ type: 'edges', dim: 'D', hier: 'D', edges: EDGES, aliases: [], elements: ['Legal', 'Region', 'M', 'A', 'B', 'C'], hierarchies: ['Alt'], leaves: ['A', 'B', 'C'], attributes: ['Land'], view: { ref: '', cmp: [], alias: '', scopeAttr: '', scopeValue: '', group: false, onlyDiff: true } });
    h.click({ id: 'addSrcBtn' });
    expect(h.el('addSrc').hidden).toBe(false);
    expect(h.el('hierBtns').innerHTML).toContain('data-loadhier="Alt"');
    h.click({ dataset: { loadhier: 'Alt' } });
    expect(h.posted.at(-1)).toEqual({ type: 'loadHierarchy', hier: 'Alt' });

    // Alt has one top "Sales" = A + B + C, exactly like Legal.
    h.send({ type: 'hierEdges', hier: 'Alt', edges: E([['Sales', 'A', 1], ['Sales', 'B', 1], ['Sales', 'C', 1]]) });
    expect(cmpHtml(h)).toContain('srcname">Alt<');
    expect(h.el('addSrc').hidden).toBe(true);

    // Alt:Sales as reference, Region of this hierarchy compared against it.
    h.change({ id: 'ref', value: '\u0003Alt\u0001Sales' });
    h.change({ id: 'addRoot', value: 'Region' });
    h.click({ id: 'compare' });
    expect(h.el('tiles').innerHTML).toContain('Alt:Sales');
    expect(h.el('tiles').innerHTML).toMatch(/data-filter="Region" data-cls="double">1 /);
    expect(h.el('tiles').innerHTML).toMatch(/data-filter="Region" data-cls="missing">1 /);
  });

  it('offers every consolidation of another hierarchy, not only its tops, and picks none', () => {
    const h = mount();
    h.send({ type: 'edges', dim: 'D', hier: 'D', edges: EDGES, aliases: [], elements: ['Legal', 'Region', 'M', 'A', 'B', 'C'], hierarchies: ['Alt'], leaves: ['A', 'B', 'C'], attributes: [], view: { ref: '', cmp: [], alias: '', scopeAttr: '', scopeValue: '', group: false, onlyDiff: true } });
    // No attribute: the scope field would only offer "all elements".
    expect(h.el('scopeField').hidden).toBe(true);
    h.click({ dataset: { loadhier: 'Alt' } });
    // The right root sits under a collector.
    h.send({ type: 'hierEdges', hier: 'Alt', edges: E([['All', 'Sales', 1], ['All', 'Other', 1], ['Sales', 'A', 1], ['Sales', 'B', 1], ['Sales', 'C', 1], ['Other', 'A', 1]]) });
    expect(cmpHtml(h)).not.toContain('data-uncmp=');
    // Offered roots fill the picker only when it opens; picking one makes the column.
    for (const root of ['All', 'Other']) { h.change({ id: 'addRoot', value: `\u0003Alt\u0001${root}` }); }
    expect(cmpHtml(h)).toContain('>Alt:All<');
    expect(cmpHtml(h)).toContain('>Alt:Other<');
    // A leaf is no root.
    h.change({ id: 'addRoot', value: '\u0003Alt\u0001A' });
    expect(cmpHtml(h)).not.toContain('>Alt:A<');
    for (const id of ['\u00011', '\u00012']) { h.click({ dataset: { uncmp: id } }); }
    expect(cmpHtml(h)).not.toContain('data-uncmp=');
    // Offered, not yet columns: picking makes one.
    h.change({ id: 'ref', value: '\u0003Alt\u0001Sales' });
    h.change({ id: 'addRoot', value: 'Legal' });
    h.click({ id: 'compare' });
    expect(h.el('tiles').innerHTML).toMatch(/data-filter="Legal" data-cls="ok">3 /);
  });

  it('switches the hierarchy in the panel, not while a draft is open', () => {
    const h = mount();
    h.send({ type: 'edges', dim: 'D', hier: 'D', edges: EDGES, aliases: [], elements: [], hierarchies: ['D', 'Alt'], leaves: ['A', 'B', 'C'], attributes: ['Land'], view: { ref: '', cmp: [], alias: '', scopeAttr: '', scopeValue: '', group: false, onlyDiff: true } });
    expect(h.el('hier').disabled).toBe(false);
    pick(h);
    h.click({ cell: true, dataset: { leaf: 'B', root: 'Region' } });
    h.click({ dataset: { edge: 'Region', edgec: 'B' } });
    h.click({ dataset: { act: 'remove' } });
    expect(h.el('hier').disabled).toBe(true);

    h.click({ id: 'discard' });
    h.change({ id: 'hier', value: 'Alt' });
    expect(h.posted.at(-1)).toEqual({ type: 'switchHierarchy', hier: 'Alt' });
    h.send({ type: 'edges', dim: 'D', hier: 'Alt', edges: [], aliases: [], elements: [], hierarchies: ['D', 'Alt'], leaves: ['A', 'B', 'C'], attributes: ['Land'], view: { ref: '', cmp: [], alias: '', scopeAttr: '', scopeValue: '', group: false, onlyDiff: true } });
    // Flat hierarchy: empty state, but the switch back stays available.
    expect(h.el('status').textContent).toBe('noConsolidations');
    expect(h.el('hier').disabled).toBe(false);
  });

  it('all leaves as reference, scope, search, grouping and export', () => {
    const h = mount();
    h.send({ type: 'edges', dim: 'D', hier: 'D', edges: EDGES, aliases: [], elements: [], hierarchies: ['D'],
      leaves: ['A', 'B', 'C', 'Orphan'], attributes: ['Land'], view: { ref: '', cmp: [], alias: '', scopeAttr: '', scopeValue: '', group: false, onlyDiff: true } });
    h.change({ id: 'ref', value: '\u0002all' });
    h.change({ id: 'addRoot', value: 'Legal' });
    h.click({ id: 'compare' });
    // The orphan hangs nowhere: missing in Legal.
    expect(h.el('tiles').innerHTML).toMatch(/data-filter="Legal" data-cls="missing">1 /);
    expect(h.el('matrix').innerHTML).toContain('data-leaf="Orphan"');

    // Scope by attribute: only A is in "DE" — Legal is all ok then.
    h.change({ id: 'scopeAttr', value: 'Land' });
    expect(h.posted.at(-1)).toEqual({ type: 'scopeAttr', attr: 'Land' });
    h.send({ type: 'scopeValues', attr: 'Land', values: { A: 'DE', B: 'AT', Orphan: 'AT' } });
    h.change({ id: 'scopeValue', value: 'DE' });
    expect(h.el('tiles').innerHTML).toMatch(/data-filter="Legal" data-cls="ok">1 /);
    expect(h.posted.at(-1)).toMatchObject({ type: 'saveView', view: { ref: '\u0002all', cmp: ['Legal'], scopeAttr: 'Land', scopeValue: 'DE' } });
  });

  it('searches rows, groups by reference parent, exports the result, fixes a column in bulk', () => {
    const h = mount();
    h.send({ type: 'edges', dim: 'D', hier: 'D', edges: EDGES, aliases: [], elements: [], hierarchies: ['D'],
      leaves: ['A', 'B', 'C'], attributes: [], view: { ref: '', cmp: [], alias: '', scopeAttr: '', scopeValue: '', group: false, onlyDiff: true } });
    pick(h);
    h.input('rowSearch', 'c');
    expect(h.el('matrix').innerHTML).toContain('data-leaf="C"');
    expect(h.el('matrix').innerHTML).not.toContain('data-leaf="B"');
    h.input('rowSearch', '');

    h.change({ id: 'groupRows', checked: true });
    expect(h.el('matrix').innerHTML).toContain('data-grp="Legal"');

    h.click({ id: 'exportResult' });
    const exp = h.posted.at(-1) as { type: string; kind: string; text: string };
    expect(exp.kind).toBe('result');
    expect(exp.text.split('\n')[0]).toContain('csvValue');
    expect(exp.text).toContain('Region > M > B (1) | Region > B (1)');

    // C is missing in Region; Legal siblings A/B hang under M there.
    h.click({ dataset: { bulk: 'Region' } });
    expect(h.el('changes').innerHTML).toContain('+ M → C (1)');
  });

  it('restores the last picks of this hierarchy on open', () => {
    const h = mount();
    h.send({ type: 'edges', dim: 'D', hier: 'D', edges: EDGES, aliases: [], elements: [], hierarchies: ['D'], leaves: [], attributes: [],
      view: { ref: 'Legal', cmp: ['Region'], alias: '', scopeAttr: '', scopeValue: '', group: true, onlyDiff: false } });
    expect(cmpHtml(h)).toContain('data-uncmp="Region"');
    expect(h.el('compare').disabled).toBe(false);
    expect(h.el('groupRows').checked).toBe(true);
  });

  it('shows the empty state for a flat hierarchy', () => {
    const h = mount();
    h.send({ type: 'edges', dim: 'D', hier: 'D', edges: [], aliases: [], elements: [], hierarchies: [], leaves: ['A', 'B', 'C'], attributes: ['Land'], view: { ref: '', cmp: [], alias: '', scopeAttr: '', scopeValue: '', group: false, onlyDiff: true } });
    expect(h.el('main').hidden).toBe(true);
    expect(h.el('status').textContent).toBe('noConsolidations');
  });

  it('a hierarchy switch restores the saved view of the target hierarchy', () => {
    const h = mount();
    const empty = { ref: '', cmp: [], alias: '', scopeAttr: '', scopeValue: '', group: false, onlyDiff: true };
    h.send({ type: 'edges', dim: 'D', hier: 'D', edges: EDGES, aliases: [], elements: [], hierarchies: ['D', 'Alt'], leaves: ['A', 'B', 'C'], attributes: ['Land'], view: empty });
    pick(h);
    h.change({ id: 'hier', value: 'Alt' });
    h.send({ type: 'edges', dim: 'D', hier: 'Alt', edges: EDGES, aliases: [], elements: [], hierarchies: ['D', 'Alt'], leaves: ['A', 'B', 'C'], attributes: ['Land'], view: { ...empty, ref: 'Region', cmp: ['Legal'], onlyDiff: false } });
    expect(h.el('ref').value).toBe('Region');
    expect(cmpHtml(h)).toContain('data-uncmp="Legal"');
    expect(cmpHtml(h)).not.toContain('data-uncmp="Region"');
    expect(h.el('onlyDiff').checked).toBe(false);
  });
});
