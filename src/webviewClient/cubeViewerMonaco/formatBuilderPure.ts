/**
 * Building blocks of the format dialog ↔ TM1 format string.
 *
 * `buildFormat` only produces strings TM1 renders as intended; every
 * combination was checked against the server (11.8, 2026-09-27, see
 * `formatBuilderPure.test.ts`). `parseFormat` reads back what `buildFormat`
 * wrote, so pattern and blocks stay in step; anything else is "custom".
 */

export interface FormatBlocks {
  decimals: number;
  group: boolean;
  negative: 'minus' | 'parens';
  zero: 'zero' | 'blank' | 'dash';
  /** Free text behind the number (€, Stk, …); always quoted. */
  unit: string;
  /** Thousands / millions. TM1 scales only without decimals, so a scale
   *  forces `decimals` to 0. */
  scale: 'none' | 'k' | 'm';
  percent: boolean;
}

export const DEFAULT_BLOCKS: FormatBlocks = {
  decimals: 0, group: true, negative: 'minus', zero: 'zero', unit: '', scale: 'none', percent: false,
};

export const MAX_DECIMALS = 6;

export function buildFormat(b: FormatBlocks): string {
  const decimals = b.scale === 'none' ? Math.max(0, Math.min(MAX_DECIMALS, Math.floor(b.decimals))) : 0;
  let num = (b.group ? '#,##0' : '0') + (decimals ? '.' + '0'.repeat(decimals) : '');
  if (b.scale === 'k') { num += ','; }
  if (b.scale === 'm') { num += ',,'; }
  if (b.percent) { num += '%'; }
  const unit = b.unit.replace(/"/g, '');
  const pos = num + (unit ? ` "${unit}"` : '');
  const neg = b.negative === 'parens' ? `(${pos})` : `-${pos}`;
  if (b.zero !== 'zero') { return `${pos};${neg};${b.zero === 'dash' ? '"–"' : '""'}`; }
  return b.negative === 'parens' ? `${pos};${neg}` : pos;
}

const NUM = /^(#,##0|0)(?:\.(0{1,6}))?(,{0,2})(%?)(?: "([^"]*)")?$/;

/** Blocks for a string `buildFormat` wrote, `null` for anything else. */
export function parseFormat(f: string): FormatBlocks | null {
  const secs = f.split(';');
  if (secs.length > 3) { return null; }
  const m = NUM.exec(secs[0]);
  if (!m) { return null; }
  const b: FormatBlocks = {
    decimals: m[2]?.length ?? 0,
    group: m[1] === '#,##0',
    negative: 'minus',
    zero: 'zero',
    unit: m[5] ?? '',
    scale: m[3] === ',' ? 'k' : m[3] === ',,' ? 'm' : 'none',
    percent: m[4] === '%',
  };
  if (secs.length >= 2) {
    if (secs[1] === `(${secs[0]})`) { b.negative = 'parens'; }
    else if (secs[1] !== `-${secs[0]}`) { return null; }
  }
  if (secs.length === 3) {
    if (secs[2] === '"–"') { b.zero = 'dash'; }
    else if (secs[2] === '""') { b.zero = 'blank'; }
    else { return null; }
  }
  return buildFormat(b) === f ? b : null;
}
