import { describe, it, expect } from 'vitest';
import { runProcess } from '../../../tiSimulator/runner/processRunner';
import { parseCsv } from '../../../tiSimulator/source/csvSource';
import { emptyFixtures } from '../../../tiSimulator/types';

const empty = { prolog: '', metadata: '', data: '', epilog: '' };

describe('runProcess', () => {
  it('runs Prolog assignments + CellPutN', () => {
    const r = runProcess({
      sections: { ...empty, prolog: `x = 42; CellPutN(x, 'Plan', 'Jan');` },
    });
    expect(r.output.getRows()).toHaveLength(1);
    expect(r.output.getRows()[0].value).toBe(42);
  });

  it('iterates Data section per source row', () => {
    const source = parseCsv(
      'Element_1,Umsatz\nElement_1,Aufwand\nElement_2,Umsatz\nElement_2,Aufwand\n',
    );
    const r = runProcess({
      sections: { ...empty, data: `CellPutN(1, 'Plan', vdim_1, vdim_2);` },
      source,
    });
    expect(r.output.getRows()).toHaveLength(4);
    expect(r.output.getRows().map((row) => row.coord)).toEqual([
      ['Element_1', 'Umsatz'],
      ['Element_1', 'Aufwand'],
      ['Element_2', 'Umsatz'],
      ['Element_2', 'Aufwand'],
    ]);
  });

  it('binds process parameters into scope', () => {
    const r = runProcess({
      sections: { ...empty, prolog: `CellPutN(pYear, 'Plan', 'Jan');` },
      parameters: { pYear: 2026 },
    });
    expect(r.output.getRows()[0].value).toBe(2026);
  });

  it('row-scope shadows process-scope', () => {
    const source = parseCsv('A\nB\n');
    const r = runProcess({
      sections: {
        ...empty,
        prolog: `vdim_1 = 'PROC';`,
        data: `CellPutN(1, 'Plan', vdim_1);`,
      },
      source,
    });
    expect(r.output.getRows().map((rw) => rw.coord)).toEqual([['A'], ['B']]);
  });

  it('runs Metadata once per source record (TM1 two-pass) — export TextOutput repeats per row', () => {
    // Regression: Metadata ran a single time, so a per-row export TextOutput in
    // the Metadata section (the common Bedrock/export pattern) emitted nothing.
    const source = parseCsv('A12,100\nA13,200\n');
    const r = runProcess({
      sections: { ...empty, metadata: `TextOutput('exp.txt', vdim_1, NumberToString(NValue));` },
      source,
    });
    const textOps = r.output.getOpRows().filter((o) => o.op === '__TEXTOUTPUT__') as Array<{ op: string; args: string[] }>;
    expect(textOps).toHaveLength(2);
    expect(textOps[0].args).toEqual(['exp.txt', 'A12', '100']);
    expect(textOps[1].args).toEqual(['exp.txt', 'A13', '200']);
  });

  it('skips Data when no source rows + no Data section', () => {
    const r = runProcess({ sections: empty });
    expect(r.output.getRows()).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('aggregates CellIncrementN across rows', () => {
    // Use 2-col all-string input so header-detection does NOT fire.
    const _source = parseCsv('Foo,1\nFoo,2\nFoo,3\nFoo,4\n');
    // Hmm but col-2 is numeric → header detection triggers when row-0 has Foo (non-numeric)
    // + body has numbers. To keep all 4 rows as data, give every column at least one
    // numeric in row-0.
    const source2 = parseCsv('1,1\n1,2\n1,3\n');
    const r = runProcess({
      sections: { ...empty, data: `CellIncrementN(vdim_2, 'Plan', NumberToString(vdim_1));` },
      source: source2,
    });
    const agg = r.output.getAggregated();
    expect(agg.size).toBe(1);
    expect([...agg.values()][0].value).toBe(6);
  });

  it('records parse errors per section', () => {
    const r = runProcess({
      sections: { ...empty, prolog: `@@@ junk;` },
    });
    expect(r.parseErrors.length).toBeGreaterThan(0);
    expect(r.parseErrors[0].section).toBe('prolog');
  });

  it('runs Prolog → Data (with iteration) → Epilog in order', () => {
    const source = parseCsv('A\nB\n');
    const r = runProcess({
      sections: {
        prolog: `CellPutN(0, 'C', 'pre');`,
        metadata: '',
        data: `CellPutN(1, 'C', vdim_1);`,
        epilog: `CellPutN(99, 'C', 'post');`,
      },
      source,
    });
    const coords = r.output.getRows().map((row) => row.coord[0]);
    expect(coords).toEqual(['pre', 'A', 'B', 'post']);
  });

  it('Phase γ: dim-create + subset + attr ops mutate fixtures end-to-end', () => {
    const fx = emptyFixtures();
    const r = runProcess({
      sections: {
        ...empty,
        prolog: `
          DimensionCreate('NewDim');
          DimensionElementInsert('NewDim', '', 'Jan', 'N');
          DimensionElementInsert('NewDim', '', 'Total', 'C');
          ElementAttrPutS('January', 'NewDim', 'NewDim', 'Jan', 'Caption');
          SubsetCreate('NewDim', 's1');
          SubsetElementInsert('NewDim', 's1', 'Jan', 0);
          CellPutN(SubsetGetSize('NewDim', 's1'), 'Plan', ElementAttrGetS('NewDim', 'Jan', 'Caption'));
        `,
      },
      fixtures: fx,
    });
    expect(r.parseErrors).toEqual([]);
    expect(fx.dimensions.get('NewDim')?.length).toBe(2);
    expect(fx.subsets.size).toBe(1);
    expect(fx.attributes.size).toBe(1);
    const rows = r.output.getRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].coord[0]).toBe('January');
    expect(rows[0].value).toBe(1);
  });

  it('FINDING #5: surfaces ONE aggregated warning when cube reads miss the fixtures', () => {
    const fx = emptyFixtures();
    const r = runProcess({
      sections: {
        ...empty,
        prolog: `CellPutN(CellGetN('Plan', 'Jan'), 'Plan', 'x'); CellPutN(CellGetN('Plan', 'Feb'), 'Plan', 'y');`,
      },
      fixtures: fx,
    });
    const missWarnings = r.warnings.filter((w) => w.message.includes('no captured value'));
    expect(missWarnings).toHaveLength(1);
    // aggregated count = 2 distinct uncaptured coords
    expect(missWarnings[0].message).toContain('2');
    expect(fx.cellReadMisses?.size).toBe(2);
  });

  it('FINDING #5: no warning when every cube read hits a fixture', () => {
    const fx = emptyFixtures();
    fx.cubeCells.set('Plan\tJan', 10);
    const r = runProcess({
      sections: { ...empty, prolog: `CellPutN(CellGetN('Plan', 'Jan'), 'Plan', 'x');` },
      fixtures: fx,
    });
    expect(r.warnings.some((w) => w.message.includes('no captured value'))).toBe(false);
  });

  it('Phase γ: ExecuteProcess emits no-op warning + skips', () => {
    const r = runProcess({
      sections: {
        ...empty,
        prolog: `ExecuteProcess('OtherProc'); CellPutN(7, 'Plan', 'Jan');`,
      },
    });
    expect(r.warnings.some((w) => w.message.includes('no-op'))).toBe(true);
    expect(r.output.getRows()).toHaveLength(1);
  });
});
