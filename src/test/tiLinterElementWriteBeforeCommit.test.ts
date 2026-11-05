/**
 * `element-write-before-commit` — writes to an element that a non-Direct
 * insert created in the same Prolog/Metadata. Expectations come from the live
 * TM1 11.8 probe of 2026-10-09 (see the rule's header comment), not from the
 * documentation. Parsed with the real TI parser so argument tokens match
 * production.
 */
import { describe, expect, it } from 'vitest';
import { lintTiAst } from '../tiLogicVisualizer/tiLinter';
import type { LintOptions } from '../tiLogicVisualizer/tiLinter';
import { parseTiCode } from '../tiLogicVisualizer/tiParser';
import type { TiAst } from '../tiLogicVisualizer/types';

const parse = (code: string): TiAst => {
  const r = parseTiCode(code);
  if (!r.ok) { throw new Error(r.error.message); }
  return r.ast;
};

const RULE = 'element-write-before-commit';

function hits(code: string, section: 'prolog' | 'metadata' | 'data' | 'epilog', options?: LintOptions) {
  return lintTiAst(parse(code), undefined, undefined, undefined, section, options)
    .filter(d => d.ruleId === RULE);
}

describe('element-write-before-commit', () => {
  it('flags CellPutN on a non-Direct element in the same Prolog (measured: fails)', () => {
    const code = "DimensionElementInsert('D', '', 'e', 'N');\nCellPutN(5, 'C', 'e', 'm');";
    expect(hits(code, 'prolog')).toHaveLength(1);
  });

  it('flags AttrPutS/AttrPutN in the Prolog (measured: fail, attribute not written)', () => {
    const code = "DimensionElementInsert('D', '', 'e', 'N');\nAttrPutS('x', 'D', 'e', 'sA');\nAttrPutN(7, 'D', 'e', 'nA');";
    expect(hits(code, 'prolog')).toHaveLength(2);
  });

  it('flags the same writes in the Metadata when the insert is in the Metadata too', () => {
    const code = "DimensionElementInsert('D', '', 'e', 'N');\nAttrPutS('x', 'D', 'e', 'sA');";
    expect(hits(code, 'metadata')).toHaveLength(1);
  });

  it('flags a Metadata write when the insert was in the earlier Prolog (measured: fails)', () => {
    const prolog = parse("DimensionElementInsert('D', '', 'e', 'N');");
    const metadata = "CellPutN(3, 'C', 'e', 'm');";
    const r = hits(metadata, 'metadata', { previousAsts: [prolog] });
    expect(r).toHaveLength(1);
  });

  it('is silent for the same writes in Epilog or Data (measured: succeed)', () => {
    const code = "DimensionElementInsert('D', '', 'e', 'N');\nCellPutN(4, 'C', 'e', 'm');";
    expect(hits(code, 'data')).toHaveLength(0);
    expect(hits(code, 'epilog')).toHaveLength(0);
  });

  it('is silent for a Direct insert (measured: writable immediately)', () => {
    const code = "DimensionElementInsertDirect('D', '', 'e', 'N');\nCellPutN(6, 'C', 'e', 'm');\nAttrPutS('y', 'D', 'e', 'sA');";
    expect(hits(code, 'prolog')).toHaveLength(0);
  });

  it('is silent for a write to an element that was not inserted here', () => {
    const code = "DimensionElementInsert('D', '', 'other', 'N');\nCellPutN(1, 'C', 'e', 'm');";
    expect(hits(code, 'prolog')).toHaveLength(0);
  });

  it('is silent when the pending change sits on ANOTHER dimension (measured: unaffected)', () => {
    const code = "DimensionElementInsert('M', '', 'm2', 'N');\nDimensionElementInsertDirect('D', '', 'e', 'N');\nCellPutN(10, 'C', 'e', 'm');";
    expect(hits(code, 'prolog')).toHaveLength(0);
  });

  it('flags a Direct insert AFTER a non-Direct one on the same dimension (measured: fails)', () => {
    const code = "DimensionElementInsert('D', '', 'x', 'N');\nDimensionElementInsertDirect('D', '', 'e', 'N');\nCellPutN(6, 'C', 'e', 'm');";
    expect(hits(code, 'prolog')).toHaveLength(1);
  });

  it('flags a hierarchy insert written in the same Prolog (measured: fails)', () => {
    const code = "HierarchyElementInsert('D', 'D', '', 'e', 'N');\nElementAttrPutS('s', 'D', 'D', 'e', 'sA');";
    expect(hits(code, 'prolog')).toHaveLength(1);
  });

  it('is silent for a ComponentAdd write-target in Epilog (measured: succeeds)', () => {
    const code = "DimensionElementInsertDirect('D', '', 'P', 'C');\nDimensionElementComponentAdd('D', 'P', 'e', 1);";
    expect(hits(code, 'epilog')).toHaveLength(0);
  });
});
