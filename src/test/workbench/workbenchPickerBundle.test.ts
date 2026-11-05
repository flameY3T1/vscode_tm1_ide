// Runs the BUILT bundle out/webview/workbenchPicker.js in a node:vm context
// with a hand-made DOM — the file that really runs in the window, not a copy.
// Pattern: src/test/commands/addServerBundleWiring.test.ts.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { createContext, runInContext } from 'vm';
import type { PickerConfig, WebviewToHost } from '../../webviewClient/workbenchPicker/protocol';

const ROOT = join(__dirname, '../../..');
const BUNDLE = join(ROOT, 'out/webview/workbenchPicker.js');
const SOURCES = ['index.ts', 'protocol.ts'].map(f => join(ROOT, 'src/webviewClient/workbenchPicker', f));

/** Missing or stale bundle fails loudly instead of silently testing yesterday. */
function readBundle(): string {
  if (!existsSync(BUNDLE)) {
    throw new Error(`Built webview bundle missing: ${BUNDLE}\nRun \`npm run compile\` first.`);
  }
  const built = statSync(BUNDLE).mtimeMs;
  const stale = SOURCES.filter(p => statSync(p).mtimeMs > built);
  if (stale.length) {
    throw new Error(`Bundle ${BUNDLE} is older than ${stale.join(', ')} — run \`npm run compile\`.`);
  }
  return readFileSync(BUNDLE, 'utf8');
}

type Handler = (ev: FakeEvent) => void;
interface FakeEvent { key?: string; target?: FakeEl; preventDefault(): void }

/** The element and its ancestors, innermost first. */
function chain(n: FakeEl | undefined): FakeEl[] {
  const out: FakeEl[] = [];
  for (; n; n = n.parent) { out.push(n); }
  return out;
}

class FakeEl {
  listeners: Record<string, Handler[]> = {};
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  parent?: FakeEl;
  textContent = '';
  value = '';
  checked = false;
  disabled = false;
  classes = new Set<string>();
  classList = { toggle: (c: string, on: boolean) => { if (on) { this.classes.add(c); } else { this.classes.delete(c); } } };
  constructor(public kind: string, attrs: Record<string, string> = {}) { this.attrs = attrs; }
  add(...cs: FakeEl[]): this { for (const c of cs) { c.parent = this; this.children.push(c); } return this; }
  addEventListener(t: string, h: Handler): void { (this.listeners[t] ??= []).push(h); }
  fire(t: string, ev: Partial<FakeEvent> = {}): void {
    const e = { preventDefault() { /* noop */ }, target: this, ...ev };
    const path = chain(this);
    if (!path.includes(doc)) { path.push(doc); }
    for (const n of path) { for (const h of n.listeners[t] ?? []) { h(e); } }
  }
  click(): void { if (!this.disabled) { this.fire('click'); } }
  getAttribute(n: string): string | null { return this.attrs[n] ?? null; }
  closest(sel: string): FakeEl | null {
    const attr = sel.slice(1, -1);
    return chain(this).find(n => attr in n.attrs) ?? null;
  }
  all(): FakeEl[] { return this.children.flatMap(c => [c, ...c.all()]); }
  querySelectorAll(sel: string): FakeEl[] {
    if (sel === 'input[type=checkbox]') { return this.all().filter(e => e.kind === 'box'); }
    throw new Error('unexpected selector ' + sel);
  }
  querySelector(sel: string): FakeEl | null {
    return sel === '.wbgcount' ? this.all().find(e => e.kind === 'count') ?? null : null;
  }
}

let doc: FakeEl & { getElementById(id: string): FakeEl | null };

function setup(cfg: Partial<PickerConfig> = {}, groups: Array<boolean[]> = [[true, true], [false]]) {
  const ids: Record<string, FakeEl> = {};
  const mk = (id: string, kind = id) => (ids[id] = new FakeEl(kind));
  const list = mk('wblist');
  const sections = groups.map((checks, gi) => {
    const s = new FakeEl('section', { 'data-group': `g${gi}` });
    s.add(new FakeEl('count'),
      new FakeEl('btn', { 'data-group-all': `g${gi}` }), new FakeEl('btn', { 'data-group-none': `g${gi}` }));
    checks.forEach((c, i) => { const b = new FakeEl('box'); b.checked = c; b.value = `c${gi}_${i}`; s.add(b); });
    return s;
  });
  list.add(...sections);
  const full: PickerConfig = {
    max: 15, counter: '{0} of {1} selected · {2} possible', existing: ['Monday'],
    save: 'Save', overwrite: 'Overwrite', name: '', ...cfg,
  };
  mk('wbcfg').textContent = JSON.stringify(full);
  for (const id of ['wbname', 'wbsave', 'wbcount', 'wbcancel']) { mk(id); }
  const root = new FakeEl('document');
  doc = Object.assign(root, {
    getElementById: (id: string) => ids[id] ?? null,
    querySelectorAll: (sel: string) => {
      if (sel === '#wblist input[type=checkbox]') { return list.querySelectorAll('input[type=checkbox]'); }
      if (sel === '#wblist section') { return sections; }
      const m = sel.match(/^#wblist section\[data-group="([^"]*)"\] input\[type=checkbox\]$/);
      if (m) { return sections.filter(s => s.attrs['data-group'] === m[1]).flatMap(s => s.querySelectorAll('input[type=checkbox]')); }
      throw new Error('unexpected selector ' + sel);
    },
  });
  const posted: WebviewToHost[] = [];
  const ctx = createContext({ document: doc, acquireVsCodeApi: () => ({ postMessage: (m: WebviewToHost) => posted.push(m) }) });
  runInContext(readBundle(), ctx);
  return { ids, sections, posted };
}

describe('workbenchPicker bundle', () => {
  it('fills every counter placeholder and the group counts on start', () => {
    const { ids, sections } = setup();
    expect(ids.wbcount.textContent).toBe('2 of 3 selected · 15 possible');
    expect(sections.map(s => s.querySelector('.wbgcount')!.textContent)).toEqual(['2/2', '0/1']);
  });

  it('fills a REPEATED placeholder the second time too', () => {
    // A translation may name {0} twice; replace only hit the first occurrence.
    const { ids } = setup({ counter: '{0} von {1} — noch {0} von {2}' });
    expect(ids.wbcount.textContent).toBe('2 von 3 — noch 2 von 15');
  });

  it('switches to overwrite while typing an existing name (case-insensitive)', () => {
    const { ids } = setup();
    expect(ids.wbsave.textContent).toBe('Save');
    ids.wbname.value = ' monday ';
    ids.wbname.fire('input');
    expect(ids.wbsave.textContent).toBe('Overwrite');
    expect(ids.wbname.classes.has('clash')).toBe(true);
  });

  it('Enter saves through the button with trimmed name and checked ids', () => {
    const { ids, posted } = setup();
    ids.wbname.value = '  Close  ';
    ids.wbname.fire('keydown', { key: 'Enter' });
    expect(posted).toEqual([{ type: 'save', name: 'Close', ids: ['c0_0', 'c0_1'] }]);
  });

  it('group None unchecks, disabled Save refuses Enter', () => {
    const { ids, sections, posted } = setup({}, [[true]]);
    sections[0].children[2].fire('click');
    expect(ids.wbsave.disabled).toBe(true);
    ids.wbname.fire('keydown', { key: 'Enter' });
    expect(posted).toEqual([]);
    sections[0].children[1].fire('click');
    expect(ids.wbsave.disabled).toBe(false);
  });

  it('Escape and Cancel post cancel', () => {
    const { ids, posted } = setup();
    doc.fire('keydown', { key: 'Escape' });
    ids.wbcancel.fire('click');
    expect(posted).toEqual([{ type: 'cancel' }, { type: 'cancel' }]);
  });
});
