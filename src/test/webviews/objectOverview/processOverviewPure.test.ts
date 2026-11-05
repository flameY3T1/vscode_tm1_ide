import { describe, it, expect } from 'vitest';
import { buildProcessRows, buildProcessKpis, classifyDatasource, usedSections, hasDocComment, procCalls } from '../../../commands/process/processOverviewPure';
import type { RawProcess } from '../../../tm1Rest/processApi';

const p = (o: Partial<RawProcess> & { Name: string }): RawProcess => o;

describe('classifyDatasource', () => {
  it('maps known types', () => {
    expect(classifyDatasource('None')).toBe('none');
    expect(classifyDatasource('ODBC')).toBe('ODBC');
    expect(classifyDatasource('TM1CubeView')).toBe('view');
    expect(classifyDatasource('ASCII')).toBe('file');
    expect(classifyDatasource(undefined)).toBe('none');
  });
});

describe('usedSections', () => {
  it('lists non-empty procedures beyond the generated markers', () => {
    expect(usedSections(p({ Name: 'x', PrologProcedure: 'sTmp = 1;', DataProcedure: '' }))).toEqual(['P']);
  });
});

describe('hasDocComment', () => {
  it('true when prolog starts with a # comment', () => {
    expect(hasDocComment(p({ Name: 'x', PrologProcedure: '#**** doc\r\nsX=1;' }))).toBe(true);
    expect(hasDocComment(p({ Name: 'x', PrologProcedure: 'sX=1;' }))).toBe(false);
  });
});

describe('procCalls', () => {
  it('extracts ExecuteProcess/RunProcess targets', () => {
    const code = "ExecuteProcess('load.a');\r\nnRet = RunProcess('load.b', 'p', 1);";
    expect(procCalls(p({ Name: 'x', PrologProcedure: code })).sort()).toEqual(['load.a', 'load.b']);
  });
});

describe('buildProcessRows + KPIs', () => {
  const raw: RawProcess[] = [
    p({ Name: 'load.sales', Parameters: [{ Name: 'p1' }], DataSource: { Type: 'TM1CubeView' }, PrologProcedure: "#doc\r\nExecuteProcess('util.x');" }),
    p({ Name: 'util.x', DataSource: { Type: 'None' }, PrologProcedure: 'sX=1;' }),
    p({ Name: '}sys.hidden', DataSource: { Type: 'None' } }),
  ];
  const rows = buildProcessRows(raw);
  it('flags control processes', () => {
    expect(rows.find(r => r.id === '}sys.hidden')!.isControl).toBe(true);
    expect(rows.find(r => r.id === 'load.sales')!.isControl).toBe(false);
  });
  it('computes calls / calledBy across the set', () => {
    expect(rows.find(r => r.id === 'load.sales')!.cells.calls).toBe(1);
    expect(rows.find(r => r.id === 'util.x')!.cells.calledBy).toBe(1);
  });
  it('matches calledBy case-insensitively (TM1 process names are case-insensitive at call time)', () => {
    const rawCi: RawProcess[] = [
      p({ Name: 'caller', PrologProcedure: "ExecuteProcess('LOAD.SALES');" }),
      p({ Name: 'load.Sales', DataSource: { Type: 'None' } }),
    ];
    const rowsCi = buildProcessRows(rawCi);
    expect(rowsCi.find(r => r.id === 'load.Sales')!.cells.calledBy).toBe(1);
  });
  it('maps params + datasource + sections', () => {
    const r = rows.find(x => x.id === 'load.sales')!;
    expect(r.cells.params).toBe(1);
    expect(r.cells.datasource).toBe('view');
    expect(r.cells.sections).toEqual(['P']);
  });
  it('KPIs count processes and no-doc', () => {
    const k = buildProcessKpis(rows);
    expect(k.find(x => x.key === 'total')!.value).toBe('3');
    expect(k.find(x => x.key === 'noDoc')!.value).toBe('2'); // util.x + }sys.hidden lack a # doc
  });
});
