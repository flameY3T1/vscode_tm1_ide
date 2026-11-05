import { describe, it, expect } from 'vitest';
import { formatTm1, validateTm1Format } from '../../webviewClient/cubeViewerMonaco/tm1FormatPure';
import * as fs from 'fs';
import * as path from 'path';

interface Cell { format: string; value: number; tm1: string }
const cells = (JSON.parse(fs.readFileSync(path.join(__dirname, 'tm1FormatFixture.json'), 'utf8')) as { cells: Cell[] }).cells;

/** Differences we accept on purpose, each with its reason. Anything else
 *  that differs fails the test. */
const KNOWN: Record<string, string> = {
  'dd.mm.yyyy @ 1000000000': 'year 2739807 is beyond the JavaScript Date range',
  'yyyy-mm-dd @ 1000000000': 'year 2739807 is beyond the JavaScript Date range',
  ' #,##0 @ -1234.5': 'TM1 moves a leading unquoted space to the end; nobody formats like that on purpose',
};

/** Formats TM1 does not answer with "error" but that the helper still
 *  rejects, because the result is empty or garbage. */
const STRICTER = new Set(['#,##0:', ':#,##0', '#,##0/', '/#,##0', '_#,##0', '*#,##0']);

const key = (c: Cell) => `${c.format} @ ${c.value}`;

describe('formatTm1 against the live 11.8 measurement', () => {
  it('fixture is the measured set', () => {
    expect(cells.length).toBeGreaterThan(500);
  });

  it('renders every measured cell like TM1, except the listed differences', () => {
    const diffs = cells
      .filter((c) => !(key(c) in KNOWN) && !STRICTER.has(c.format))
      .map((c) => ({ c, got: formatTm1(c.value, c.format) }))
      .filter(({ c, got }) => got !== c.tm1)
      .map(({ c, got }) => `${key(c)}: tm1=${JSON.stringify(c.tm1)} ours=${JSON.stringify(got)}`);
    expect(diffs).toEqual([]);
  });

  it('rejects exactly the formats TM1 answered with "error"', () => {
    const byFormat = new Map<string, boolean>();
    for (const c of cells) { byFormat.set(c.format, (byFormat.get(c.format) ?? false) || c.tm1 === 'error'); }
    const wrong = [...byFormat].filter(([f, err]) => validateTm1Format(f).ok === (err || STRICTER.has(f))).map(([f, err]) => `${f} (tm1 error: ${err})`);
    expect(wrong).toEqual([]);
  });
});

describe('validateTm1Format reasons', () => {
  it.each([
    ['', 'empty'],
    ["IIF(1=1,'0','0.0')", 'expression'],
    ['Standard', 'namedFormat'],
    ['b:#,##0', 'prefix'],
    ['#,##0;[Red]-#,##0', 'colour'],
    ['#,##0 €', 'unquotedText'],
    ['#,##0 "€', 'unclosedQuote'],
    ['0;0;0;0', 'tooManySections'],
    ['#,##0:', 'timePattern'],
  ])('%j → %s', (f, reason) => {
    const r = validateTm1Format(f);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe(reason); }
  });

  it('uses the given separators', () => {
    expect(formatTm1(-1234567.375, '#,##0.00;(#,##0.00)', { dec: '.', grp: ',' })).toBe('(1,234,567.38)');
  });
});
