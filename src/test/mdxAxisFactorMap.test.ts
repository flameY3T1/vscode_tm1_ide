import { describe, it, expect } from 'vitest';

import { mapAxisFactorForDim, axisFactorForDim } from '../mdx/axisFactorsPure';

/**
 * Update the factor of ONE dimension in the existing MDX — and touch nothing
 * else.
 *
 * Why this needs its own function (finding 2026-08-23): the first attempt
 * wrote the collapse state into `buildCurrentMdx`, and that REBUILDS the axis
 * from the matrix tuples. So the existing expression was gone before the
 * collapse got its turn — out of
 *   `{DRILLDOWNMEMBER(…MEMBERS…)} * {[ValueFields]…[Wert und Menge^Wert], …}`
 * came a flat tuple list in which the second ValueFields row was missing and
 * the names came from the DISPLAY (alias!), not from the dimension.
 *
 * The server path does it right: it WRAPS the existing expression
 * (`DRILLUPMEMBER(<previous>, {member})`). This function does exactly that for
 * the local path, which saves the server round trip.
 */
describe('mapAxisFactorForDim', () => {
  // The bug report itself, cut down to what is needed: two dimensions on the
  // row axis, three on the column axis, expressions instead of name lists.
  const MDX = [
    'SELECT NON EMPTY {[Jahre].[Jahre].[2025]} * {DRILLUPMEMBER(DRILLDOWNMEMBER({[Monate].[Monate].[PM12]} , {[Monate].[Monate].[PM12]}) , {[Monate].[Monate].[PM12]})}',
    ' * {TM1FILTERBYLEVEL([Datenarten].[Datenarten].MEMBERS , 0)} ON COLUMNS ,',
    ' NON EMPTY {DRILLDOWNMEMBER([Konten].[Konten].MEMBERS , {[Konten].[Konten].[Umsätze]})}',
    ' * {[ValueFields].[ValueFields].[Wert und Menge^Wert],[ValueFields].[ValueFields].[SuWertfelder^Menge]} ON ROWS',
    ' FROM [Top_Level_Cube] WHERE ([Stations].[Stations].[CC2026_A12_C])',
  ].join('');

  const wrapUp = (factor: string): string => `{DRILLUPMEMBER(${factor}, {[Konten].[Konten].[Ergebnis]})}`;

  it('wraps exactly the factor of the dimension', () => {
    const out = mapAxisFactorForDim(MDX, 'Konten', wrapUp);
    expect(out).toContain('{DRILLUPMEMBER({DRILLDOWNMEMBER([Konten].[Konten].MEMBERS , {[Konten].[Konten].[Umsätze]})}, {[Konten].[Konten].[Ergebnis]})}');
  });

  it('leaves everything else untouched, character for character', () => {
    const out = mapAxisFactorForDim(MDX, 'Konten', wrapUp) as string;
    // The only difference from the original is the shell around the Konten factor.
    const factor = axisFactorForDim(MDX, 'Konten') as string;
    expect(out.replace(wrapUp(factor), factor)).toBe(MDX);
  });

  it('keeps the second axis dimension untouched', () => {
    const out = mapAxisFactorForDim(MDX, 'Konten', wrapUp) as string;
    expect(out).toContain('[ValueFields].[ValueFields].[Wert und Menge^Wert],[ValueFields].[ValueFields].[SuWertfelder^Menge]');
  });

  it('keeps the column axis untouched', () => {
    const out = mapAxisFactorForDim(MDX, 'Konten', wrapUp) as string;
    expect(out).toContain('{TM1FILTERBYLEVEL([Datenarten].[Datenarten].MEMBERS , 0)} ON COLUMNS');
  });

  it('also hits a dimension on the column axis', () => {
    const out = mapAxisFactorForDim(MDX, 'Jahre', (f) => `HEAD(${f})`) as string;
    expect(out).toContain('NON EMPTY HEAD({[Jahre].[Jahre].[2025]}) *');
  });

  it('knows the function form of the cross product', () => {
    const mdx = 'SELECT CROSSJOIN({[A].[A].MEMBERS}, {[B].[B].MEMBERS}) ON COLUMNS, {[C].[C].MEMBERS} ON ROWS FROM [Cube]';
    const out = mapAxisFactorForDim(mdx, 'B', (f) => `X(${f})`);
    expect(out).toBe('SELECT CROSSJOIN({[A].[A].MEMBERS}, X({[B].[B].MEMBERS})) ON COLUMNS, {[C].[C].MEMBERS} ON ROWS FROM [Cube]');
  });

  it('null when the dimension is not unambiguously on one axis', () => {
    // Only in the WHERE — the same rule as `axisFactorForDim`.
    expect(mapAxisFactorForDim(MDX, 'Stations', wrapUp)).toBeNull();
    expect(mapAxisFactorForDim(MDX, 'Gibtsnicht', wrapUp)).toBeNull();
  });

  it('null for two factors of the same dimension', () => {
    const mdx = 'SELECT {[A].[A].[x]} * {[A].[A].[y]} ON COLUMNS, {[C].[C].MEMBERS} ON ROWS FROM [Cube]';
    expect(mapAxisFactorForDim(mdx, 'A', (f) => `X(${f})`)).toBeNull();
  });

  it('null when it is not a SELECT', () => {
    expect(mapAxisFactorForDim('[Konten].[Konten].MEMBERS', 'Konten', wrapUp)).toBeNull();
  });
});
