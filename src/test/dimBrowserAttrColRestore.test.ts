import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Fix round 2, finding 1: the REMEMBERED column state only reached the renderer
 * (`attrColumns.ts#_spalten`), not the checkbox list
 * (`viewControls.ts#_attrSpaltenGewaehlt`). Consequence: the grid showed the
 * remembered columns, but the button said "Attributes" instead of "Attributes (3)",
 * no checkbox was checked — and an open AND CLOSE WITHOUT ANY
 * CHANGE collected `[]` and thereby DELETED the stored entry.
 *
 * The model for the fix is `showActiveAlias` in the same file: the path
 * REPORTS its state, instead of the control fetching it.
 *
 * The DOM double is the same as in `dimBrowserAttrColMenu.test.ts` (button +
 * menu with `innerHTML` evaluation); here additionally the button label,
 * hence an `__l10n` of its own with the two text keys.
 */

interface FakeCheckbox { value: string; checked: boolean; }

function bauButton() {
  const attrs: Record<string, string> = {};
  const obj = {
    style: { display: 'none' } as { display: string },
    textContent: '',
    attrs,
    _h: null as null | ((e: unknown) => void),
    setAttribute(n: string, v: string) { attrs[n] = v; },
    addEventListener(_t: string, h: (e: unknown) => void) { obj._h = h; },
    contains(node: unknown) { return node === obj; },
  };
  return obj;
}

function bauMenu() {
  let checkboxes: FakeCheckbox[] = [];
  const obj = {
    style: { display: 'none' } as { display: string },
    _change: null as null | ((e: unknown) => void),
    addEventListener(t: string, h: (e: unknown) => void) { if (t === 'change') { obj._change = h; } },
    set innerHTML(html: string) {
      const re = /<input type="checkbox" value="([^"]*)"( checked)?>/g;
      const found: FakeCheckbox[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(html))) { found.push({ value: m[1]!, checked: !!m[2] }); }
      checkboxes = found;
    },
    get innerHTML() { return ''; },
    contains(node: unknown) { return checkboxes.includes(node as FakeCheckbox); },
    querySelectorAll(sel: string) { return sel.includes('checkbox') ? checkboxes : []; },
    get _checkboxes() { return checkboxes; },
  };
  return obj;
}

function bauDom() {
  const btn = bauButton();
  const menu = bauMenu();
  const els: Record<string, unknown> = { 'vw-attrcols-btn': btn, 'vw-attrcols-menu': menu };
  const doc = {
    getElementById: (id: string) => els[id] ?? null,
    addEventListener() { /* the outside click is not checked here */ },
  };
  (globalThis as unknown as { document: unknown }).document = doc;
  (globalThis as unknown as { __l10n: unknown }).__l10n = {
    vwAttrColsButton: 'Attributes',
    vwAttrColsButtonN: 'Attributes ({0})',
  };
  return { btn, menu };
}

function bauCbs() {
  return {
    setBase: vi.fn(), keepMarked: vi.fn(), removeMarked: vi.fn(), applyLayer: vi.fn(),
    previewLayer: vi.fn(), setAlias: vi.fn(), setSort: vi.fn(), setLevel: vi.fn(),
    setAttrColumns: vi.fn(),
  };
}

const defs = [
  { Name: 'SITENAME', Type: 'Alias' },
  { Name: 'Kostenstelle', Type: 'String' },
  { Name: 'Jahr', Type: 'Numeric' },
];

describe('attribute columns — the remembered state reaches the checkbox list', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { warnSpy.mockRestore(); });

  async function laden() {
    const { btn, menu } = bauDom();
    const cbs = bauCbs();
    const mod = await import('../webviewClient/dimensionBrowser/viewControls');
    mod.initViewControls(cbs);
    return { btn, menu, cbs, mod };
  }

  it('(a) the restored state checks the checkboxes and stands in the button', async () => {
    const { btn, menu, mod } = await laden();
    mod.showAttrColumnSelection(['SITENAME', 'Jahr'], 'Dim');
    mod.showAttrDefs(defs, 'Dim');
    expect(btn.textContent).toBe('Attributes (2)');
    btn._h!({}); // open
    const an = menu._checkboxes.filter((c) => c.checked).map((c) => c.value);
    expect(an).toEqual(['SITENAME', 'Jahr']);
  });

  it('(b) opening and closing WITHOUT a change reports the same list, NOT the empty one', async () => {
    const { btn, cbs, mod } = await laden();
    mod.showAttrColumnSelection(['SITENAME', 'Jahr'], 'Dim');
    mod.showAttrDefs(defs, 'Dim');
    btn._h!({}); // open
    btn._h!({}); // close, without touching a checkbox
    expect(cbs.setAttrColumns).toHaveBeenCalledTimes(1);
    expect(cbs.setAttrColumns).toHaveBeenCalledWith(['SITENAME', 'Jahr']);
  });

  it('(c) a remembered name that the definitions do not know drops away', async () => {
    const { btn, mod } = await laden();
    mod.showAttrColumnSelection(['SITENAME', 'WEG', 'Jahr'], 'Dim');
    mod.showAttrDefs(defs, 'Dim');
    expect(mod.attrColSelection()).toEqual(['SITENAME', 'Jahr']);
    expect(btn.textContent).toBe('Attributes (2)');
  });

  it('(c2) the intersection applies too when the definitions come FIRST', async () => {
    const { btn, mod } = await laden();
    mod.showAttrDefs(defs, 'Dim');
    mod.showAttrColumnSelection(['SITENAME', 'WEG', 'Jahr'], 'Dim');
    expect(mod.attrColSelection()).toEqual(['SITENAME', 'Jahr']);
    expect(btn.textContent).toBe('Attributes (2)');
  });

  it('(c3) the definitions of a FOREIGN dimension do not cut', async () => {
    // On a dimension change the state of the new dimension is already there, but the
    // definitions are still those of the old one. An intersection against them would delete
    // valid columns.
    const { mod } = await laden();
    mod.showAttrDefs(defs, 'Alte');
    mod.showAttrColumnSelection(['Fremd1', 'Fremd2'], 'Neue');
    expect(mod.attrColSelection()).toEqual(['Fremd1', 'Fremd2']);
  });

  it('(d) the restored SELECTION ORDER survives the close', async () => {
    const { btn, cbs, mod } = await laden();
    // Reversed to the definition order (SITENAME, Kostenstelle, Jahr).
    mod.showAttrColumnSelection(['Jahr', 'SITENAME'], 'Dim');
    mod.showAttrDefs(defs, 'Dim');
    btn._h!({}); // open
    btn._h!({}); // close without a change
    expect(cbs.setAttrColumns).toHaveBeenCalledWith(['Jahr', 'SITENAME']);
  });
});
