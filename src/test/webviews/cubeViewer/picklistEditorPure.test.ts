import { describe, it, expect } from 'vitest';
import { buildPicklistOptions } from '../../../webviewClient/cubeViewerMonaco/picklistOptionsPure';

// Stands in for the l10n formatting function that `editor.ts` really passes in
// (`fmt(L, 'picklistForeignValue', v)`); the pure module itself must not
// import l10n, see picklistOptionsPure.ts.
const foreignLabel = (v: string): string => `${v} (not in list)`;

describe('buildPicklistOptions', () => {
  it('returns the list unchanged when the value is in it', () => {
    expect(buildPicklistOptions(['A', 'B'], 'B', foreignLabel)).toEqual([
      { value: 'A', label: 'A', foreign: false },
      { value: 'B', label: 'B', foreign: false },
    ]);
  });

  it('prepends an old value that is not in the list', () => {
    // Otherwise merely OPENING the editor would change the cell value.
    expect(buildPicklistOptions(['A', 'B'], 'ALT', foreignLabel)[0])
      .toEqual({ value: 'ALT', label: 'ALT (not in list)', foreign: true });
  });

  it('treats the empty value as not foreign to the list', () => {
    expect(buildPicklistOptions(['A'], '', foreignLabel).some((o) => o.foreign)).toBe(false);
  });

  it('does not duplicate an entry that is already in the list', () => {
    expect(buildPicklistOptions(['A', 'B'], 'A', foreignLabel)).toHaveLength(2);
  });

  it('passes the old value unchanged to foreignLabel', () => {
    expect(buildPicklistOptions(['A'], 'ALT', (v) => `[${v}]`)[0].label).toBe('[ALT]');
  });
});
