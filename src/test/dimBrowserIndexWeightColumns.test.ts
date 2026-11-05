import { describe, it, expect } from 'vitest';
import { buildSetExprQuery, parseSetAnswer } from '../tm1Rest/dimensionSetQueryPure';
import { columnValue } from '../webviewClient/dimensionBrowser/viewRender';
import type { DisplayRow } from '../webviewClient/dimensionBrowser/rowsFromAnswer';
import {
  COL_INDEX, COL_WEIGHT, isPseudoCol, realAttrCols, columnWidth,
  PSEUDO_COL_PX, DEFAULT_COL_PX, _resetAttrColumnsForTest,
} from '../webviewClient/dimensionBrowser/attrColumns';

/**
 * Element index and edge weight as columns of their own.
 *
 * The evidence for the two fields was measured live (11.8, 2026-08-25):
 * `Element.Index` and `Member.Weight` are both in `$metadata`, and
 * `Member.Weight` is the weight of the edge to the parent under which the
 * member is qualified in THIS set — the same element under two parents
 * carries two different weights (`M02^PQ01n` = -1, `M01^PQ01n` = 1).
 */
describe('Request: index and weight only on demand', () => {
  it('without a request neither Index nor Weight is in the $select', () => {
    const q = buildSetExprQuery({ kind: 'name' });
    expect(q).not.toContain('Weight');
    expect(q).not.toContain('Index');
  });

  it('Index hangs off the ROW element, not the member', () => {
    const q = buildSetExprQuery({ kind: 'name' }, [], { index: true });
    expect(q).toContain('Element($select=Type,Level,Index)');
    // Not on the member: `Index` is not a property there.
    expect(q).toContain('$expand=Members($select=Name,UniqueName,DisplayInfo');
    expect(q).not.toContain('DisplayInfo,Index');
  });

  it('Weight hangs off the MEMBER, not the element', () => {
    const q = buildSetExprQuery({ kind: 'name' }, [], { weight: true });
    expect(q).toContain('$select=Name,UniqueName,DisplayInfo,Weight');
    expect(q).toContain('Element($select=Type,Level)');
  });

  it('both together', () => {
    const q = buildSetExprQuery({ kind: 'name' }, [], { index: true, weight: true });
    expect(q).toContain('DisplayInfo,Weight');
    expect(q).toContain('Element($select=Type,Level,Index)');
  });

  it('Index gets along with the parent request on the same expand', () => {
    const q = buildSetExprQuery({ kind: 'name', parents: true }, [], { index: true });
    expect(q).toContain('Element($select=Type,Level,Index;$expand=Parents($select=Name))');
  });

  it('the placeholder names NEVER show up in the query', () => {
    // They are webview-internal; passing them on as `rowAttrs` would build a
    // `$select=Attributes/<NUL>index` and with it HTTP 400. The translation into
    // the two flags happens in `viewFetch.ts#fetchRows`, not here — this test
    // only records that the layer below does not know them.
    const q = buildSetExprQuery({ kind: 'name' }, [], { index: true, weight: true });
    expect(q).not.toContain(COL_INDEX);
    expect(q).not.toContain(COL_WEIGHT);
  });
});

const member = (extra: Record<string, unknown>) => ({
  Tuples: [{ Members: [{
    Name: 'e1', UniqueName: '[d].[h].[p^e1]', DisplayInfo: 0,
    Parent: null, Element: { Type: 'Numeric', Level: 0 }, ...extra,
  }] }],
});

describe('parseSetAnswer carries index and weight', () => {
  it('without a request both fields stay absent, even if the server sends them', () => {
    const r = parseSetAnswer(
      member({ Weight: -1, Element: { Type: 'Numeric', Level: 0, Index: 7 } }),
    )[0]!;
    expect(r.index).toBeUndefined();
    expect(r.weight).toBeUndefined();
  });

  it('requested and delivered: both present', () => {
    const r = parseSetAnswer(
      member({ Weight: -1, Element: { Type: 'Numeric', Level: 0, Index: 7 } }),
      '', [], { index: true, weight: true },
    )[0]!;
    expect(r.index).toBe(7);
    expect(r.weight).toBe(-1);
  });

  it('weight 0 is a VALUE, not an absence', () => {
    // A root without a parent carries 0 live (`[Monate].[Monate].[SuMonate]`).
    // A `||` instead of the `typeof` check silently turned that into "not requested".
    const r = parseSetAnswer(member({ Weight: 0 }), '', [], { weight: true })[0]!;
    expect(r.weight).toBe(0);
  });

  it('requested but not delivered: the field is missing instead of claiming 0', () => {
    const r = parseSetAnswer(member({}), '', [], { index: true, weight: true })[0]!;
    expect(r.index).toBeUndefined();
    expect(r.weight).toBeUndefined();
  });
});

const zeile = (o: Partial<DisplayRow>): DisplayRow => ({
  name: 'e1', caption: 'E1', type: 'N', level: 0, parent: null,
  drilled: false, ancestors: [], depth: 0, key: 'k', ...o,
}) as DisplayRow;

describe('Display: the placeholder columns read their own fields', () => {
  it('index and weight do NOT come from attrs', () => {
    const r = zeile({ index: 7, weight: -1, attrs: { [COL_INDEX]: 'falsch' } });
    expect(columnValue(r, COL_INDEX)).toBe('7');
    expect(columnValue(r, COL_WEIGHT)).toBe('-1');
  });

  it('zero is shown, not swallowed', () => {
    const r = zeile({ index: 0, weight: 0 });
    expect(columnValue(r, COL_INDEX)).toBe('0');
    expect(columnValue(r, COL_WEIGHT)).toBe('0');
  });

  it('if the value is missing, the cell stays empty instead of showing undefined', () => {
    expect(columnValue(zeile({}), COL_INDEX)).toBe('');
    expect(columnValue(zeile({}), COL_WEIGHT)).toBe('');
  });

  it('real attributes keep going through attrs', () => {
    expect(columnValue(zeile({ attrs: { SITENAME: 'Depot' } }), 'SITENAME')).toBe('Depot');
  });
});

describe('Placeholders vs. real columns', () => {
  it('realAttrCols leaves exactly the real names, in order', () => {
    expect(realAttrCols(['Jahr', COL_WEIGHT, 'SITENAME', COL_INDEX])).toEqual(['Jahr', 'SITENAME']);
  });

  it('isPseudoCol matches only the two', () => {
    expect(isPseudoCol(COL_INDEX)).toBe(true);
    expect(isPseudoCol(COL_WEIGHT)).toBe(true);
    expect(isPseudoCol('index')).toBe(false);
    expect(isPseudoCol('Weight')).toBe(false);
  });

  it('they start narrower than an attribute column — short numbers', () => {
    _resetAttrColumnsForTest();
    expect(columnWidth(COL_INDEX)).toBe(PSEUDO_COL_PX);
    expect(columnWidth('SITENAME')).toBe(DEFAULT_COL_PX);
  });
});

/**
 * The translation point: `viewFetch.ts#fetchRows` turns the placeholders of the
 * column state into the two wire flags. If that goes wrong, a
 * NUL name travels to the host as `rowAttrs` and turns into a
 * `$select=Attributes/<NUL>index` there — HTTP 400 or, worse, the silent
 * fallback to the whole attribute collection.
 */
describe('viewFetch#fetchRows translates the placeholders into flags', () => {
  it('sends only the real attributes as rowAttrs, the placeholders as flags', async () => {
    (globalThis as Record<string, unknown>).__l10n = {
      vwBaseMembers: 'Baum', vwBaseAll: 'Alle', vwBaseRoots: 'Wurzeln',
      vwTrailKept: 'behalten ({0})', vwTrailRemoved: 'entfernt ({0})',
      vwBaseExplicit: 'Auswahl ({0})', loaded: '{0} von {1}',
      ctxOnlyThis: 'Nur dieses Element',
    };
    const el = () => ({
      innerHTML: '', textContent: '', style: {} as Record<string, string>,
      classList: {
        contains: () => false, toggle: () => {}, add: () => {}, remove: () => {},
      },
      setAttribute: () => {}, addEventListener: () => {},
      insertAdjacentHTML: () => {}, querySelectorAll: () => [],
      offsetWidth: 100, offsetHeight: 100,
      scrollTop: 0, clientHeight: 100, scrollHeight: 100,
    });
    const els: Record<string, unknown> = {};
    (globalThis as unknown as { document: unknown }).document = {
      getElementById: (id: string) => (els[id] ??= el()),
      addEventListener: () => {},
    };
    (globalThis as unknown as { window: unknown }).window = { innerWidth: 800, innerHeight: 600 };

    const { startView, applyCtxAction, _resetViewPathForTest } =
      await import('../webviewClient/dimensionBrowser/viewPath');
    const { setAttrColumns } = await import('../webviewClient/dimensionBrowser/attrColumns');

    const posted: Record<string, unknown>[] = [];
    _resetViewPathForTest();
    _resetAttrColumnsForTest();
    startView('aa', 'aa', (m) => posted.push(m as Record<string, unknown>));

    // Order deliberately mixed — it must not disturb the split.
    setAttrColumns(['Jahr', COL_WEIGHT, 'SITENAME']);
    posted.length = 0;
    applyCtxAction('only-this', 'd');

    const anfrage = posted.filter((p) => p.type === 'fetchViewRows').pop()!;
    expect(anfrage.rowAttrs).toEqual(['Jahr', 'SITENAME']);
    expect(anfrage.rowWeight).toBe(true);
    expect(anfrage.rowIndex).toBe(false);
  });
});

/**
 * The guard for a real click-test bug (2026-08-25).
 *
 * The placeholders were first prefixed with a NUL. Measured (jsdom, at the
 * parser entry AS WELL AS via `innerHTML`): the HTML tokenizer replaces U+0000 in
 * an attribute value with U+FFFD. The name came back from the DOM as `<FFFD>index`,
 * so it was no longer a placeholder but an "attribute" that does
 * not exist — and all three symptoms followed from that at once: empty column,
 * replacement character in the header row, the button did not count the choice.
 *
 * The tests above did NOT find this, because they repeated the sentinel literally
 * instead of using the constant. A test that re-writes the constant
 * cannot find a wrong constant — that is why they all use
 * `COL_INDEX`/`COL_WEIGHT` now, and here is the PROPERTY that
 * actually matters.
 */
describe('The placeholder must survive an HTML attribute intact', () => {
  it('no U+0000 — the tokenizer turns it into U+FFFD', () => {
    for (const c of [COL_INDEX, COL_WEIGHT]) {
      expect(c).not.toContain('\u0000');
      expect(c).not.toContain('\uFFFD');
    }
  });

  it('the prefix lies in the Private Use Area — neither a control character nor a noncharacter', () => {
    for (const c of [COL_INDEX, COL_WEIGHT]) {
      const cp = c.codePointAt(0)!;
      expect(cp).toBeGreaterThanOrEqual(0xE000);
      expect(cp).toBeLessThanOrEqual(0xF8FF);
    }
  });

  it('the two differ and neither is an ordinary attribute name', () => {
    expect(COL_INDEX).not.toBe(COL_WEIGHT);
    // What TM1's OData parser would let through as `Attributes/<name>` — that is exactly
    // what they must NOT be, otherwise they would be a possible real name.
    for (const c of [COL_INDEX, COL_WEIGHT]) {
      expect(/^[A-Za-z_][A-Za-z0-9_]*$/.test(c)).toBe(false);
    }
  });
});
