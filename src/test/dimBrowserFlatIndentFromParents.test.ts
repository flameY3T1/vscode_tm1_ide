import { describe, it, expect } from 'vitest';

import { rowsFromAnswer } from '../webviewClient/dimensionBrowser/rowsFromAnswer';
import type { AnswerRow } from '../webviewClient/dimensionBrowser/rowsFromAnswer';
import { mdxBase, initialView } from '../webviewClient/dimensionBrowser/intents';
import { buildSetExprQuery } from '../tm1Rest/dimensionSetQueryPure';
import { parseSetAnswer } from '../tm1Rest/dimensionSetQueryPure';

/**
 * Indentation over a FOREIGN set — the stored MDX view.
 *
 * Up to this point the new path drew `base: 'mdx'` flat, and that was
 * honest: the delivered ancestor chain there follows the NATURAL tree,
 * not the list. Measured live on `Reporting/Default` (11.8, 2026-08-23):
 *
 *   P Ergebnis                  chain: (empty)
 *   D PL 010 Umsätze           chain: P Umsatz        ← is NOT in the list
 *   D GUV 006 MaterialCost   chain: D Primärwerte  ← is NOT in the list
 *
 * The server names exactly ONE parent per occurrence, and in a hand-made
 * list that is the first natural one, not the one standing above it.
 * ALL parents answer the question — and they cost nothing of their own: the
 * same query carries them along (200-row window: 456 ms with, 504 ms without, +13 KB).
 *
 * Rule: a row is indented exactly when one of its parents ACTUALLY stands
 * above it. No tree order is claimed, only the visible relationship is
 * drawn.
 */
describe('indentation over a foreign set', () => {
  const z = (name: string, parents: string[], type: 'N' | 'C' = 'C'): AnswerRow => ({
    name, caption: name, type, level: type === 'C' ? 1 : 0,
    // Exactly the situation from the measurement: `parent`/`ancestors` name the
    // natural parent, which does not appear in the list at all.
    parent: 'P Umsatz', ancestors: [{ name: 'P Umsatz', type: 'C', level: 2 }],
    drilled: false, parents,
  });

  // The row axis of `Reporting/Default`, shortened.
  const LISTE: AnswerRow[] = [
    { name: 'P Ergebnis', caption: 'P Ergebnis', type: 'C', level: 3, parent: null, ancestors: [], drilled: false, parents: [] },
    z('D PL 010 Umsätze', ['P Umsatz', 'D Primärwerte', 'P Ergebnis']),
    z('D GUV 006 MaterialCost', ['D Primärwerte', 'P Ergebnis', 'P Aufwand']),
    { name: 'Nebenposten', caption: 'Nebenposten', type: 'C', level: 1, parent: null, ancestors: [], drilled: false, parents: [] },
  ];

  it('indents under the parent that really stands above it', () => {
    const rows = rowsFromAnswer(LISTE, mdxBase('{EXCEPT(…)}'));
    expect(rows.map((r) => `${'  '.repeat(r.depth)}${r.name}`)).toEqual([
      'P Ergebnis',
      '  D PL 010 Umsätze',
      '  D GUV 006 MaterialCost',
      'Nebenposten',
    ]);
  });

  it('the key carries the visible parent, not the natural one', () => {
    const rows = rowsFromAnswer(LISTE, mdxBase('{EXCEPT(…)}'));
    expect(rows[1].key).toBe('P Ergebnis\x00D PL 010 Umsätze');
  });

  it('without a parent above it the row stays flat', () => {
    // The same row ALONE: nobody stands above it, so no indentation.
    const rows = rowsFromAnswer([LISTE[1]], mdxBase('{EXCEPT(…)}'));
    expect(rows[0].depth).toBe(0);
  });

  it('falls back to the named parent when no parent list arrived', () => {
    // Without a requested parent list (`parents` is missing) the previous
    // behaviour remains — the index copy of a `TM1SUBSETALL` set draws flat.
    const ohne: AnswerRow[] = [
      { name: 'a', caption: 'a', type: 'N', level: 0, parent: 'sum', ancestors: [], drilled: false },
      { name: 'sum', caption: 'sum', type: 'C', level: 1, parent: null, ancestors: [], drilled: true },
      { name: 'a', caption: 'a', type: 'N', level: 0, parent: 'sum', ancestors: [], drilled: false },
    ];
    expect(rowsFromAnswer(ohne, initialView('set')).map((r) => r.depth)).toEqual([0, 0, 1]);
  });
});

describe('the parent list is only requested when it is needed', () => {
  it('is in the query when requested', () => {
    const q = buildSetExprQuery({ kind: 'name', parents: true });
    expect(q).toContain('Element($select=Type,Level;$expand=Parents($select=Name))');
  });

  it('is missing when not requested — the window should not pay for it', () => {
    expect(buildSetExprQuery({ kind: 'name' })).not.toContain('Parents(');
  });

  it('the answer carries the parent names on the row', () => {
    const rows = parseSetAnswer({
      Tuples: [{
        Members: [{
          Name: 'D PL 010 Umsätze', DisplayInfo: 0, Parent: { Name: 'P Umsatz', Parent: null },
          Element: { Type: 'Consolidated', Level: 2, Parents: [{ Name: 'P Umsatz' }, { Name: 'P Ergebnis' }] },
        }],
      }],
    });
    expect(rows[0].parents).toEqual(['P Umsatz', 'P Ergebnis']);
  });

  it('without a requested parent list the field stays empty — no empty array as a claim', () => {

    const rows = parseSetAnswer({
      Tuples: [{ Members: [{ Name: 'a', DisplayInfo: 0, Element: { Type: 'Numeric', Level: 0 } }] }],
    });
    expect(rows[0].parents).toBeUndefined();
  });
});
