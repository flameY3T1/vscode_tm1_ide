import { describe, it, expect } from 'vitest';
import { sortViewsForPicker, viewOptionValue, viewOptionLabel, parseViewOptionValue } from '../webviewClient/cubeViewerMonaco/viewPickerPure';
import { DYNAMIC_SUBSET_MARK } from '../utils/dynamicSubsetMark';

/**
 * `viewPicker.ts` itself cannot run without jsdom (which does not exist here),
 * so the ordering and the option value live next to it and are checked here.
 */

describe('viewOptionValue', () => {
  it('carries the origin along in the value', () => {
    expect(viewOptionValue('Default', false)).toBe('pub:Default');
    expect(viewOptionValue('Default', true)).toBe('priv:Default');
  });

  it('separates public and private views of the same name', () => {
    expect(viewOptionValue('X', false)).not.toBe(viewOptionValue('X', true));
  });
});

describe('parseViewOptionValue', () => {
  it('recovers name and origin', () => {
    expect(parseViewOptionValue('pub:Default')).toEqual({ name: 'Default', isPrivate: false });
    expect(parseViewOptionValue('priv:Default')).toEqual({ name: 'Default', isPrivate: true });
  });

  it('is the inverse of viewOptionValue — also for names with a colon', () => {
    for (const [name, isPrivate] of [['A:B', false], ['pub:tricky', true], ['X', true]] as const) {
      expect(parseViewOptionValue(viewOptionValue(name, isPrivate))).toEqual({ name, isPrivate });
    }
  });

  it('returns null for the placeholder and anything unexpected', () => {
    expect(parseViewOptionValue('__none__')).toBeNull();
    expect(parseViewOptionValue('')).toBeNull();
  });
});

describe('sortViewsForPicker', () => {
  const v = (name: string, isPrivate?: boolean) => ({ name, isPrivate });

  it('sorts by name instead of in server order', () => {
    // This is how the server delivers: first all NativeViews, then all MDX views
    // (live 11.8 on `Reporting`). Unsorted, the MDX block stands at the very bottom.
    const server = [v('zz_Perf_Native_Blatt'), v('Ansicht1'), v('Standard'), v('Default')];
    expect(sortViewsForPicker(server).map((x) => x.name))
      .toEqual(['Ansicht1', 'Default', 'Standard', 'zz_Perf_Native_Blatt']);
  });

  it('keeps public before private, regardless of the name', () => {
    const mixed = [v('AAA', true), v('zzz', false)];
    expect(sortViewsForPicker(mixed).map((x) => [x.name, !!x.isPrivate]))
      .toEqual([['zzz', false], ['AAA', true]]);
  });

  it('sorts umlauts like their base letter (display order)', () => {
    const names = sortViewsForPicker([v('Zeta'), v('Ärger'), v('Alpha')]).map((x) => x.name);
    expect(names).toEqual(['Alpha', 'Ärger', 'Zeta']);
  });

  it('ignores upper/lower case', () => {
    expect(sortViewsForPicker([v('beta'), v('Alpha')]).map((x) => x.name))
      .toEqual(['Alpha', 'beta']);
  });

  it('leaves the input unchanged', () => {
    const input = [v('B'), v('A')];
    sortViewsForPicker(input);
    expect(input.map((x) => x.name)).toEqual(['B', 'A']);
  });
});

/**
 * The marker says "the content comes from an MDX expression" and is therefore
 * the same as on the dynamic subset — an `<option>` only renders text, so
 * it must go into the LABEL. It must never stand in the value: `change` reads the
 * view name back from the value.
 */
describe('viewOptionLabel — MDX marker', () => {
  it('appends the marker only to MDX views', () => {
    expect(viewOptionLabel('Umsatz', true)).toBe(`Umsatz  ${DYNAMIC_SUBSET_MARK}`);
    expect(viewOptionLabel('Umsatz', false)).toBe('Umsatz');
  });

  it('uses the same marker as the dynamic subset', () => {
    expect(DYNAMIC_SUBSET_MARK).toBe('{}');
  });

  it('leaves the option value untouched', () => {
    expect(viewOptionValue('Umsatz', false)).toBe('pub:Umsatz');
    expect(viewOptionLabel('Umsatz', true)).not.toBe(viewOptionValue('Umsatz', false));
  });
});
