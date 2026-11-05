import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { COL_INDEX, COL_WEIGHT } from '../webviewClient/dimensionBrowser/attrColumns';

/**
 * Fix round 1, finding 2: `attrColsOpen`/`attrColsClose`/`attrColsToggle`/
 * `bindAttrColsOutsideClick` were UNTESTED so far — only `attrColPickerHtml`
 * (pure HTML) had tests. The core statement of the task (several checkmarks,
 * ONE `setAttrColumns` call, triggered on CLOSE) stood only in the
 * comment, not in the test. This file covers exactly that, with a DOM double of its own:
 * button, menu (incl. `innerHTML`/`querySelectorAll`/`contains`,
 * so that the checkbox collection really runs through on close) and a
 * `document` with a real `addEventListener('mousedown', ...)` (no no-op
 * stub as in the older viewControls tests — here the outside click
 * itself is to be checked).
 *
 * Since fix round 2, finding 2, the production code listens on the MENU for a
 * `change` event (delegation — the checkboxes are rebuilt on every open):
 * that is where the SELECTION ORDER comes from. A "click" on a checkbox
 * is therefore two things — setting `.checked` AND reporting the `change`; `hake()`
 * does both. On close `.checked` is still read, that stays
 * the truth about WHICH columns are on (the order comes from the
 * record).
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
  const attrs: Record<string, string> = {};
  let checkboxes: FakeCheckbox[] = [];
  const obj = {
    style: { display: 'none' } as { display: string },
    attrs,
    _change: null as null | ((e: unknown) => void),
    setAttribute(n: string, v: string) { attrs[n] = v; },
    addEventListener(t: string, h: (e: unknown) => void) { if (t === 'change') { obj._change = h; } },
    set innerHTML(html: string) {
      const re = /<input type="checkbox" value="([^"]*)"( checked)?>/g;
      const found: FakeCheckbox[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(html))) { found.push({ value: m[1], checked: !!m[2] }); }
      checkboxes = found;
    },
    get innerHTML() { return ''; },
    contains(node: unknown) { return checkboxes.includes(node as FakeCheckbox); },
    querySelectorAll(sel: string) { return sel.includes('checkbox') ? checkboxes : []; },
    get _checkboxes() { return checkboxes; },
  };
  return obj;
}

function bauDocument(getById: (id: string) => unknown) {
  const obj = {
    getElementById: getById,
    _mousedown: null as null | ((e: unknown) => void),
    addEventListener(t: string, h: (e: unknown) => void) { if (t === 'mousedown') { obj._mousedown = h; } },
  };
  return obj;
}

function bauDom() {
  const btn = bauButton();
  const menu = bauMenu();
  const els: Record<string, unknown> = { 'vw-attrcols-btn': btn, 'vw-attrcols-menu': menu };
  const doc = bauDocument((id: string) => els[id] ?? null);
  (globalThis as unknown as { document: unknown }).document = doc;
  return { btn, menu, doc };
}

/**
 * Clicking a checkbox — setting `.checked` AND reporting the `change`, exactly
 * as a browser does. Both together, because both sides are needed:
 * the close reads the membership from the DOM, the order comes from the
 * record that the event keeps.
 */
function hake(menu: ReturnType<typeof bauMenu>, name: string, an = true): void {
  // By the NAME, not by the position: since the list puts two
  // placeholder columns (Index/Weight) in front, an index access would
  // silently look at a different checkbox than the comment next to it claims.
  const cb = menu._checkboxes.find((c) => c.value === name);
  if (!cb) { throw new Error(`kein Kaestchen namens ${JSON.stringify(name)} im Menue`); }
  cb.checked = an;
  menu._change!({ target: cb });
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

describe('attribute column menu — open/close/outside click', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    // The remaining buttons (vw-btn-keep etc.) are deliberately missing in this slim
    // double — `bind()` reports that loudly via `console.warn`, which here would
    // only be noise; exactly this behavior has its own test file
    // (dimBrowserViewControls.test.ts, "console.warn names the missing id").
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { warnSpy.mockRestore(); });

  async function aufbauen() {
    const { btn, menu, doc } = bauDom();
    const cbs = bauCbs();
    const { initViewControls, showAttrDefs } =
      await import('../webviewClient/dimensionBrowser/viewControls');
    initViewControls(cbs);
    showAttrDefs(defs);
    return { btn, menu, doc, cbs };
  }

  it('several checkmarks, then close: setAttrColumns EXACTLY ONCE with all chosen names in selection order', async () => {
    const { btn, menu, cbs } = await aufbauen();
    btn._h!({}); // open
    // REVERSED to the definition order (SITENAME, Kostenstelle, Jahr) —
    // otherwise selection and definition order would coincide and the
    // test would not tell the two apart (fix round 2, finding 2: exactly that is
    // what it slipped past).
    hake(menu, 'Jahr');
    hake(menu, 'SITENAME');
    btn._h!({}); // close (toggle)
    expect(cbs.setAttrColumns).toHaveBeenCalledTimes(1);
    expect(cbs.setAttrColumns).toHaveBeenCalledWith(['Jahr', 'SITENAME']);
  });

  it('an unchecked checkbox drops out, the others keep their place', async () => {
    const { btn, menu, cbs } = await aufbauen();
    btn._h!({}); // open
    hake(menu, 'Jahr');
    hake(menu, 'Kostenstelle');
    hake(menu, 'SITENAME');
    hake(menu, 'Kostenstelle', false);
    btn._h!({}); // close
    expect(cbs.setAttrColumns).toHaveBeenCalledWith(['Jahr', 'SITENAME']);
  });

  it('as long as the menu is open, setAttrColumns was NOT called', async () => {
    const { btn, menu, cbs } = await aufbauen();
    btn._h!({}); // open
    hake(menu, 'Kostenstelle');
    expect(cbs.setAttrColumns).not.toHaveBeenCalled();
    expect(menu.style.display).not.toBe('none');
  });

  it('closing without a change reports the same list again on the next open/close', async () => {
    const { btn, menu, cbs } = await aufbauen();
    btn._h!({}); // open
    hake(menu, 'Jahr');
    btn._h!({}); // close -> call 1: ['Jahr']
    btn._h!({}); // open again, preset with 'Jahr'
    btn._h!({}); // close without further change -> call 2: ['Jahr'] again
    expect(cbs.setAttrColumns).toHaveBeenCalledTimes(2);
    expect(cbs.setAttrColumns).toHaveBeenNthCalledWith(1, ['Jahr']);
    expect(cbs.setAttrColumns).toHaveBeenNthCalledWith(2, ['Jahr']);
  });

  it('an outside click closes the menu and reports the selection', async () => {
    const { btn, menu, doc, cbs } = await aufbauen();
    btn._h!({}); // open
    hake(menu, 'Jahr');
    doc._mousedown!({ target: { fremd: true } });
    expect(menu.style.display).toBe('none');
    expect(cbs.setAttrColumns).toHaveBeenCalledTimes(1);
    expect(cbs.setAttrColumns).toHaveBeenCalledWith(['Jahr']);
  });

  it('a click INSIDE the menu (on a checkbox) does NOT close', async () => {
    const { btn, menu, doc, cbs } = await aufbauen();
    btn._h!({}); // open
    const kaestchen = menu._checkboxes[0];
    doc._mousedown!({ target: kaestchen });
    expect(menu.style.display).not.toBe('none');
    expect(cbs.setAttrColumns).not.toHaveBeenCalled();
  });

  it('a click on the button itself is exempt from the outside click (no double toggle)', async () => {
    const { btn, doc, cbs } = await aufbauen();
    btn._h!({}); // open
    doc._mousedown!({ target: btn });
    expect(cbs.setAttrColumns).not.toHaveBeenCalled();
  });

  it('Index and Weight are selectable and stand in selection order between the attributes', async () => {
    const { btn, menu, cbs } = await aufbauen();
    btn._h!({});
    hake(menu, 'Jahr');
    hake(menu, COL_WEIGHT);
    hake(menu, 'SITENAME');
    btn._h!({});
    expect(cbs.setAttrColumns).toHaveBeenCalledWith(['Jahr', COL_WEIGHT, 'SITENAME']);
  });

  it('a later attrDefs answer does NOT cut away the placeholders', async () => {
    // They stand in no attribute definition — without the exception in
    // `trimAttrColumns` they would disappear on every refill of the list.
    const { btn, menu, cbs } = await aufbauen();
    const { showAttrDefs, attrColSelection } =
      await import('../webviewClient/dimensionBrowser/viewControls');
    btn._h!({});
    hake(menu, COL_INDEX);
    hake(menu, 'Jahr');
    btn._h!({});
    expect(cbs.setAttrColumns).toHaveBeenCalledWith([COL_INDEX, 'Jahr']);
    showAttrDefs(defs);
    expect(attrColSelection()).toEqual([COL_INDEX, 'Jahr']);
  });

  it('opening again shows the last closed selection preset', async () => {
    const { btn, menu } = await aufbauen();
    btn._h!({}); // open
    hake(menu, 'Jahr');
    btn._h!({}); // close
    btn._h!({}); // open again
    const jahr = menu._checkboxes.find((c) => c.value === 'Jahr');
    expect(jahr?.checked).toBe(true);
  });
});
