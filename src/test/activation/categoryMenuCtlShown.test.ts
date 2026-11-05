import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The category node carries its state in `contextValue`: when the control
 * objects of this group are shown, `.ctlShown` is appended at the end
 * (`tm1TreeDataProvider#_childrenForServerRoot`). A menu entry that compares
 * `viewItem == category-cubes` EXACTLY then no longer matches — and the
 * context menu shrinks to the one entry that knows the suffix.
 *
 * Exactly that was visible live: with control objects shown, only "Hide" was left
 * in the menu, all the rest was missing. This guard therefore does NOT check the
 * spelling of the clauses but their effect: every entry that targets a
 * category node must match it in BOTH states.
 */

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));
const entries: Array<{ command?: string; when?: string; submenu?: string }> =
  pkg.contributes.menus['view/item/context'];

/**
 * Tiny evaluator for the `when` forms that occur here:
 * `viewItem == X`, `viewItem =~ /re/`, joined with `&&`/`||`, plus the
 * constant `view == tm1Explorer`.
 */
function matches(when: string, viewItem: string): boolean {
  const or = when.split('||');
  if (or.length > 1) { return or.some(part => matches(part, viewItem)); }
  const and = when.split('&&');
  if (and.length > 1) { return and.every(part => matches(part, viewItem)); }

  // Parentheses only occur here around flat OR groups that the split
  // above has already taken apart — the leftovers can go.
  const clause = when.trim().replace(/^\(+/, '').replace(/\)+$/, '');
  if (clause === 'view == tm1Explorer') { return true; }
  // Other views (e.g. `tm1.recent`) show no category nodes.
  if (/^view == /.test(clause)) { return false; }
  if (clause === 'false') { return false; }
  const eq = /^viewItem == ([\w.-]+)$/.exec(clause);
  if (eq) { return viewItem === eq[1]; }
  const re = /^viewItem =~ \/(.*)\/$/.exec(clause);
  if (re) { return new RegExp(re[1]).test(viewItem); }
  // `!listMultiSelection` and the like: irrelevant for this guard.
  if (/^!?[\w.]+$/.test(clause)) { return true; }
  throw new Error(`when-Form nicht abgedeckt: "${clause}"`);
}

/** The states a category node can take. */
const CATEGORY_STATES: Record<string, string[]> = {
  cubes: ['category-cubes', 'category-cubes.ctlShown'],
  dimensions: ['category-dimensions', 'category-dimensions.ctlShown'],
  processes: [
    'category-processes',
    'category-processes.ctlShown',
    'category-processes.grouped',
    'category-processes.grouped.ctlShown',
    'category-processes-bedrock',
    'category-processes-bedrock.ctlShown',
    'category-processes-bedrock.grouped',
    'category-processes-bedrock.grouped.ctlShown',
  ],
};

/** Show/Hide are opposite on purpose — they are the same button. */
const DELIBERATELY_EXCLUSIVE = new Set(['tm1.showControlObjects', 'tm1.hideControlObjects']);

describe('category context menu survives shown control objects', () => {
  it('knows the evaluator for every when form that occurs', () => {
    for (const e of entries) {
      if (e.when) { expect(() => matches(e.when as string, 'category-cubes')).not.toThrow(); }
    }
  });

  for (const [group, states] of Object.entries(CATEGORY_STATES)) {
    it(`shows the same entries for "${group}", whether shown or not`, () => {
      const base = states[0];
      const visible = entries.filter(e =>
        e.when && e.command && !DELIBERATELY_EXCLUSIVE.has(e.command) && matches(e.when, base));
      expect(visible.length).toBeGreaterThan(0);

      for (const state of states.slice(1)) {
        // `.grouped` switches the Configure/Reset verb, which is
        // intended. Each state is therefore compared against its twin
        // WITHOUT `.ctlShown`.
        const twin = state.replace('.ctlShown', '');
        const expected = entries.filter(e =>
          e.when && e.command && !DELIBERATELY_EXCLUSIVE.has(e.command) && matches(e.when, twin));
        const actual = entries.filter(e =>
          e.when && e.command && !DELIBERATELY_EXCLUSIVE.has(e.command) && matches(e.when, state));
        expect(actual.map(e => e.command).sort())
          .toEqual(expected.map(e => e.command).sort());
      }
    });
  }

  it('never offers Show and Hide at the same time', () => {
    const show = entries.find(e => e.command === 'tm1.showControlObjects' && e.when);
    const hide = entries.find(e => e.command === 'tm1.hideControlObjects' && e.when);
    for (const state of Object.values(CATEGORY_STATES).flat()) {
      expect(matches(show!.when as string, state)).toBe(!matches(hide!.when as string, state));
    }
  });
});
