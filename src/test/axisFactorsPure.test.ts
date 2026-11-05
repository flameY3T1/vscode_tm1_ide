import { describe, it, expect } from 'vitest';
import { axisFactorForDim, splitCrossjoinFactors, dimOfSetExpr } from '../mdx/axisFactorsPure';

// The view that triggered the finding (flameY3T1, 2026-08-20): an
// MDX view whose row axis carries the collapse state as a DRILL*MEMBER chain.
// Exactly this chain is what the filter chip should pass on to the Dimension Browser.
const D = '[Konten_Top_Level_Cube].[Konten_Top_Level_Cube]';
const KONTEN_SET = `{DRILLDOWNMEMBER(DRILLDOWNMEMBER(DRILLDOWNMEMBER(DRILLDOWNMEMBER(DRILLDOWNMEMBER(DRILLUPMEMBER(DRILLUPMEMBER(${D}.MEMBERS , {${D}.[Umsätze]}) , {${D}.[Ergebnis (EBIT)]}) , {${D}.[Ergebnis (EBIT)]}) , {${D}.[Summe Erträge]}) , {${D}.[Umsätze]}) , {${D}.[Primäraufwand]}) , {${D}.[MaterialCost]})}`;
const MONATE_SET = '{DRILLUPMEMBER(DRILLDOWNMEMBER({[Monate].[Monate].[PM12]} , {[Monate].[Monate].[PM12]}) , {[Monate].[Monate].[PM12]})}';
const DATENARTEN_SET = '{TM1FILTERBYLEVEL([Datenarten].[Datenarten].MEMBERS , 0)}';
const VALUEFIELDS_SET = '{[ValueFields].[ValueFields].[Wert und Menge^Wert],[ValueFields].[ValueFields].[SuWertfelder^Menge]}';
const VIEW_MDX = `SELECT NON EMPTY {[Jahre].[Jahre].[2025]} * ${MONATE_SET} * ${DATENARTEN_SET} ON COLUMNS , NON EMPTY ${KONTEN_SET} * ${VALUEFIELDS_SET} ON ROWS FROM [Top_Level_Cube] WHERE ([Stations].[Stations].[CC2026_A12_C],[Datenquellen].[Datenquellen].[Eingabe_Top_Level_Cube])`;

describe('splitCrossjoinFactors', () => {
  it('splits at the top-level stars', () => {
    expect(splitCrossjoinFactors('{A} * {B} * {C}')).toEqual(['{A}', '{B}', '{C}']);
  });

  it('leaves a star inside parentheses alone', () => {
    expect(splitCrossjoinFactors('{FOO({A} * {B})} * {C}')).toEqual(['{FOO({A} * {B})}', '{C}']);
  });

  it('resolves CROSSJOIN — nested too', () => {
    expect(splitCrossjoinFactors('CROSSJOIN(CROSSJOIN({A}, {B}), {C})')).toEqual(['{A}', '{B}', '{C}']);
  });

  it('mixes both notations', () => {
    expect(splitCrossjoinFactors('CROSSJOIN({A}, {B}) * {C}')).toEqual(['{A}', '{B}', '{C}']);
  });

  it('returns a single factor unchanged', () => {
    expect(splitCrossjoinFactors('  {A}  ')).toEqual(['{A}']);
  });

  it('leaves a `*` in an element name alone', () => {
    expect(splitCrossjoinFactors('{[D].[D].[a*b]} * {[E].[E].[x]}'))
      .toEqual(['{[D].[D].[a*b]}', '{[E].[E].[x]}']);
  });

  it('leaves a `*` in a string literal alone', () => {
    expect(splitCrossjoinFactors('{TM1FILTERBYPATTERN([D].[D].MEMBERS, "a*b")} * {[E].[E].[x]}'))
      .toEqual(['{TM1FILTERBYPATTERN([D].[D].MEMBERS, "a*b")}', '{[E].[E].[x]}']);
  });
});

describe('dimOfSetExpr', () => {
  it('reads the dimension from the first bracketing', () => {
    expect(dimOfSetExpr(KONTEN_SET)).toBe('Konten_Top_Level_Cube');
    expect(dimOfSetExpr(MONATE_SET)).toBe('Monate');
    expect(dimOfSetExpr(DATENARTEN_SET)).toBe('Datenarten');
  });

  it('turns `]]` back into a `]`', () => {
    expect(dimOfSetExpr('{[Kon]]ten].[Kon]]ten].MEMBERS}')).toBe('Kon]ten');
  });

  it('returns null without bracketing', () => {
    expect(dimOfSetExpr('{}')).toBeNull();
  });
});

describe('axisFactorForDim', () => {
  it('returns the row factor of the triggering view', () => {
    expect(axisFactorForDim(VIEW_MDX, 'Konten_Top_Level_Cube')).toBe(KONTEN_SET);
  });

  it('also finds the column factors', () => {
    expect(axisFactorForDim(VIEW_MDX, 'Monate')).toBe(MONATE_SET);
    expect(axisFactorForDim(VIEW_MDX, 'Datenarten')).toBe(DATENARTEN_SET);
    expect(axisFactorForDim(VIEW_MDX, 'ValueFields')).toBe(VALUEFIELDS_SET);
  });

  it('strips a NON EMPTY before the first factor', () => {
    expect(axisFactorForDim(VIEW_MDX, 'Jahre')).toBe('{[Jahre].[Jahre].[2025]}');
  });

  it('returns null for a dimension in the WHERE — it is on no axis', () => {
    expect(axisFactorForDim(VIEW_MDX, 'Stations')).toBeNull();
    expect(axisFactorForDim(VIEW_MDX, 'Datenquellen')).toBeNull();
  });

  it('returns null for an unknown dimension', () => {
    expect(axisFactorForDim(VIEW_MDX, 'Gibtsnicht')).toBeNull();
  });

  it('copes with numeric axes', () => {
    const mdx = 'SELECT {[A].[A].MEMBERS} ON 0, {[B].[B].MEMBERS} * {[C].[C].MEMBERS} ON 1 FROM [Cube]';
    expect(axisFactorForDim(mdx, 'C')).toBe('{[C].[C].MEMBERS}');
  });

  it('takes an axis with only one dimension as a whole', () => {
    const mdx = 'SELECT {[A].[A].MEMBERS} ON 0, {[B].[B].MEMBERS} ON 1 FROM [Cube]';
    expect(axisFactorForDim(mdx, 'B')).toBe('{[B].[B].MEMBERS}');
  });

  it('returns null when a factor mixes several dimensions', () => {
    // A factor that names the target dimension only as an extra does NOT describe
    // its set — setting it as the base would claim a foreign axis.
    const mdx = 'SELECT {[A].[A].MEMBERS} ON 0, {FILTER([B].[B].MEMBERS, [C].[C].[x] > 0)} ON 1 FROM [Cube]';
    expect(axisFactorForDim(mdx, 'C')).toBeNull();
    expect(axisFactorForDim(mdx, 'B')).toBe('{FILTER([B].[B].MEMBERS, [C].[C].[x] > 0)}');
  });

  it('returns null when the same dimension stands twice on one axis', () => {
    const mdx = 'SELECT {[A].[A].MEMBERS} ON 0, {[B].[B].[x]} * {[B].[B].[y]} ON 1 FROM [Cube]';
    expect(axisFactorForDim(mdx, 'B')).toBeNull();
  });

  it('strips an appended DIMENSION PROPERTIES', () => {
    const mdx = 'SELECT {[A].[A].MEMBERS} ON 0, {[B].[B].MEMBERS} DIMENSION PROPERTIES [B].[B].[Caption] ON 1 FROM [Cube]';
    expect(axisFactorForDim(mdx, 'B')).toBe('{[B].[B].MEMBERS}');
  });

  it('tolerates garbage instead of MDX', () => {
    expect(axisFactorForDim('', 'B')).toBeNull();
    expect(axisFactorForDim('kein mdx', 'B')).toBeNull();
  });
});
