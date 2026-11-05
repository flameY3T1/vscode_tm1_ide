// Runs the BUILT cube security matrix bundle (out/webview/securityCubeMatrix.js)
// in a node:vm context with a minimal DOM. Two things only the bundle proves:
//   * a dropdown change patches its own cell and does not redraw the table
//     (the redraw rebuilt every <select>, 6,000 for 200 cubes × 30 groups);
//   * more rows than MATRIX_ROW_CAP draw only the cap plus a hint.
// `tsc -p ./` does not check src/webviewClient, so this is the gate.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { createContext, runInContext } from 'vm';

const ROOT = join(__dirname, '../..');
const BUNDLE = join(ROOT, 'out/webview/securityCubeMatrix.js');
const SOURCES = ['src/webviewClient/_shared/securityMatrixCore.ts', 'src/webviewClient/securityCubeMatrix/index.ts']
  .map(p => join(ROOT, p));

function readBundle(): string {
  if (!existsSync(BUNDLE)) { throw new Error(`Bundle missing: ${BUNDLE} — run \`npm run compile\`.`); }
  const built = statSync(BUNDLE).mtimeMs;
  const stale = SOURCES.filter(p => statSync(p).mtimeMs > built);
  if (stale.length) { throw new Error(`Bundle older than ${stale.join(', ')} — run \`npm run compile\`.`); }
  return readFileSync(BUNDLE, 'utf8');
}

class ClassList {
  private s = new Set<string>();
  toggle(c: string, on?: boolean): void { if (on ?? !this.s.has(c)) { this.s.add(c); } else { this.s.delete(c); } }
  remove(c: string): void { this.s.delete(c); }
  contains(c: string): boolean { return this.s.has(c); }
}

class El {
  listeners: Record<string, Array<(ev: unknown) => void>> = {};
  classList = new ClassList();
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  disabled = false;
  className = '';
  textContent = '';
  value = '';
  parentElement: El | null = null;
  htmlWrites = 0;
  private html = '';
  set innerHTML(v: string) { this.html = v; this.htmlWrites++; }
  get innerHTML(): string { return this.html; }
  addEventListener(t: string, fn: (ev: unknown) => void): void { (this.listeners[t] ??= []).push(fn); }
  fire(t: string, ev: unknown): void { for (const fn of this.listeners[t] ?? []) { fn(ev); } }
  getAttribute(n: string): string | null { return this.attrs[n] ?? null; }
  removeAttribute(n: string): void { delete this.attrs[n]; }
  querySelectorAll(): El[] { return []; }
}

function boot() {
  const ids = ['chip-bar', 'matrix-wrap', 'dirty-badge', 'btn-save', 'btn-revert', 'btn-refresh',
    'status', 'row-filter', 'btn-view'];
  const byId = new Map(ids.map(id => [id, new El()]));
  const docListeners: Record<string, Array<() => void>> = {};
  const winListeners: Array<(ev: { data: unknown }) => void> = [];
  const posted: unknown[] = [];
  const matrixTab = new El();
  matrixTab.attrs = { 'data-tab': 'matrix' };
  const ctx = createContext({
    console,
    document: {
      getElementById: (id: string) => byId.get(id) ?? null,
      querySelectorAll: (q: string) => (q.includes('.tab') ? [matrixTab] : []),
      addEventListener: (t: string, fn: () => void) => { (docListeners[t] ??= []).push(fn); },
    },
    window: { addEventListener: (_t: string, fn: (ev: { data: unknown }) => void) => winListeners.push(fn) },
    acquireVsCodeApi: () => ({ postMessage: (m: unknown) => posted.push(m), getState: () => undefined, setState: () => {} }),
    __l10n: { rowsCapped: 'Showing {0} of {1} rows' },
  });
  (ctx as { globalThis?: unknown }).globalThis = ctx;
  runInContext(readBundle(), ctx);
  for (const fn of docListeners.DOMContentLoaded ?? []) { fn(); }
  const send = (data: unknown) => { for (const fn of winListeners) { fn({ data }); } };
  // The "Matrix" tab shows every group without picking chips first.
  const showMatrixTab = () => matrixTab.fire('click', { currentTarget: matrixTab });
  return { byId, posted, send, showMatrixTab };
}

const groups = [{ name: 'G1' }, { name: 'G2' }];

describe('security matrix bundle', () => {
  it('a dropdown change patches its cell instead of redrawing the table', () => {
    const { byId, posted, send } = boot();
    send({ type: 'init', cubes: ['C1'], groups, perms: { C1: { G1: 'READ', G2: 'NONE' } } });
    const wrap = byId.get('matrix-wrap')!;
    const writesBefore = wrap.htmlWrites;

    const tr = new El();
    const td = new El(); td.parentElement = tr;
    const sel = new El(); sel.parentElement = td;
    sel.classList.toggle('cell-dropdown', true);
    sel.attrs = { 'data-row': 'C1', 'data-group': 'G1' };
    sel.value = 'WRITE';
    wrap.fire('change', { target: sel });

    expect(wrap.htmlWrites).toBe(writesBefore);
    expect(td.classList.contains('dirty')).toBe(true);
    expect(byId.get('btn-save')!.disabled).toBe(false);

    byId.get('btn-save')!.fire('click', {});
    expect(JSON.stringify(posted.at(-1))).toContain('WRITE');
  });

  it('draws at most MATRIX_ROW_CAP rows and says how many match', () => {
    const { byId, send, showMatrixTab } = boot();
    const cubes = Array.from({ length: 1200 }, (_, i) => `C${i}`);
    send({ type: 'init', cubes, groups, perms: {} });
    showMatrixTab();
    const html = byId.get('matrix-wrap')!.innerHTML;
    expect((html.match(/<tr class="[^"]*" data-row=/g) ?? []).length).toBe(500);
    expect((html.match(/<select class="cell-dropdown"/g) ?? []).length).toBe(1000);
    expect(html).toContain('Showing 500 of 1200 rows');
  });
});
