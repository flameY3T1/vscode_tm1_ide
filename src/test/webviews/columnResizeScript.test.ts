// src/test/webviews/columnResizeScript.test.ts
//
// Actually runs the column-width drag script (`columnResizeScript`) —
// in a `node:vm` context with a recreated DOM. The script lives as text in the
// template literal: `tsc` and `lint` do not see it, and a plain `\n` or
// a backtick in it would only become a SyntaxError in the window. The other tests
// only check whether `data-resizable` is in the HTML; whether grips are created and widths
// are applied and reported is checked only by this one.
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'vm';
import { columnResizeScript } from '../../webviews/columnResize';

type Listener = (ev: Record<string, unknown>) => void;

class FakeEl {
  children: FakeEl[] = [];
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  className = '';
  listeners: Record<string, Listener[]> = {};
  classList = {
    set: new Set<string>(),
    add: (c: string) => { this.classList.set.add(c); },
    remove: (c: string) => { this.classList.set.delete(c); },
    contains: (c: string) => this.classList.set.has(c),
  };
  constructor(public tagName: string, public width = 0) {}
  appendChild(c: FakeEl): FakeEl { this.children.push(c); return c; }
  addEventListener(t: string, fn: Listener): void { (this.listeners[t] ??= []).push(fn); }
  removeEventListener(t: string, fn: Listener): void {
    this.listeners[t] = (this.listeners[t] ?? []).filter(f => f !== fn);
  }
  fire(t: string, ev: Record<string, unknown> = {}): void {
    const e = { stopPropagation() {}, preventDefault() {}, ...ev };
    for (const fn of [...(this.listeners[t] ?? [])]) { fn(e); }
  }
  getBoundingClientRect(): { width: number } { return { width: this.width }; }
  /** Only the one query that the script makes: `:scope > .col-grip`. */
  querySelector(sel: string): FakeEl | null {
    if (sel !== ':scope > .col-grip') { throw new Error('unerwarteter Selektor ' + sel); }
    return this.children.find(c => c.className === 'col-grip') ?? null;
  }
  get grip(): FakeEl {
    const g = this.querySelector(':scope > .col-grip');
    if (!g) { throw new Error('kein Griff'); }
    return g;
  }
}

class FakeTable extends FakeEl {
  heads: FakeEl[];
  constructor(widths: number[], resizable = '') {
    super('table');
    this.dataset.resizable = resizable;
    this.heads = widths.map(w => new FakeEl('th', w));
  }
  get tHead(): { rows: { cells: FakeEl[] }[] } { return { rows: [{ cells: this.heads }] }; }
}

function run(kind: string, saved: Record<string, number[]>, tables: FakeTable[]) {
  const posted: unknown[] = [];
  const document = new FakeEl('document') as FakeEl & Record<string, unknown>;
  document.querySelectorAll = (sel: string) => {
    if (sel !== 'table[data-resizable]') { throw new Error('unerwarteter Selektor ' + sel); }
    return tables;
  };
  document.createElement = (tag: string) => new FakeEl(tag);
  const ctx = createContext({
    document,
    vscode: { postMessage: (m: unknown) => posted.push(m) },
    getComputedStyle: () => ({ position: 'static' }),
    JSON, Array, Math, String,
  });
  runInContext(columnResizeScript(kind, saved), ctx);
  return { posted, document };
}

describe('columnResizeScript im Fenster', () => {
  it('sets exactly one grip per header cell and makes it the positioning context', () => {
    const t = new FakeTable([100, 80, 60]);
    run('log', {}, [t]);
    for (const th of t.heads) {
      expect(th.children.filter(c => c.className === 'col-grip')).toHaveLength(1);
      expect(th.style.position).toBe('relative');
    }
    expect(t.classList.contains('col-fixed')).toBe(false);
  });

  it('applies remembered widths — the last column stays without a width', () => {
    const t = new FakeTable([100, 80, 60]);
    run('log', { log: [120, 90, 0] }, [t]);
    expect(t.classList.contains('col-fixed')).toBe(true);
    expect(t.heads.map(h => h.style.width)).toEqual(['120px', '90px', '']);
    // Sum with the last column's natural width (60) as its floor, never narrower than the container.
    expect(t.style.width).toBe('max(270px, 100%)');
  });

  it('keeps the last column at its natural width when the table overflows', () => {
    // Wider than any container: before, the last column had no rest left and
    // dropped to MIN on the first drag of another column.
    const t = new FakeTable([400, 300, 250]);
    run('log', { log: [420, 300, 0] }, [t]);
    expect(t.style.width).toBe('max(970px, 100%)');
  });

  it('discards remembered widths when the column count differs', () => {
    const t = new FakeTable([100, 80, 60]);
    run('log', { log: [120, 90] }, [t]);
    expect(t.classList.contains('col-fixed')).toBe(false);
    expect(t.heads.map(h => h.style.width)).toEqual(['', '', '']);
  });

  it('dragging freezes, sets the width and reports it; the last column as 0', () => {
    const t = new FakeTable([100, 80, 60], 'cubes');
    const { posted, document } = run('overview', {}, [t]);
    t.heads[0].grip.fire('mousedown', { clientX: 200 });
    document.fire('mousemove', { clientX: 250 });
    expect(t.heads[0].style.width).toBe('150px');
    document.fire('mouseup');
    expect(posted).toEqual([{ columnWidths: 'overview:cubes', widths: [150, 80, 0] }]);
    // After releasing, no listener is attached to the document any more.
    expect(document.listeners.mousemove).toEqual([]);
  });

  it('dragging respects the minimum width', () => {
    const t = new FakeTable([100, 80, 60]);
    const { posted, document } = run('log', {}, [t]);
    t.heads[1].grip.fire('mousedown', { clientX: 200 });
    document.fire('mousemove', { clientX: 0 });
    document.fire('mouseup');
    expect(posted).toEqual([{ columnWidths: 'log', widths: [100, 30, 0] }]);
  });

  it('double-click releases the table and reports null', () => {
    const t = new FakeTable([100, 80, 60]);
    const { posted } = run('log', { log: [120, 90, 0] }, [t]);
    t.heads[1].grip.fire('dblclick');
    expect(t.classList.contains('col-fixed')).toBe(false);
    expect(t.heads.map(h => h.style.width)).toEqual(['', '', '']);
    expect(posted).toEqual([{ columnWidths: 'log', widths: null }]);
  });
});
