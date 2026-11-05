import { describe, it, expect } from 'vitest';
import { evalStatement } from '../../../tiSimulator/eval/evalStatement';
import { Scope } from '../../../tiSimulator/eval/scope';
import { OutputCollector } from '../../../tiSimulator/output/outputCollector';
import { parseStatements } from '../../../tiSimulator/ast/parseStatement';
import { emptyFixtures, type SimWarning } from '../../../tiSimulator/types';
import type { SubProcessModule, SubProcessLoader } from '../../../tiSimulator/eval/subProcess';

function runWithLoader(src: string, loader: SubProcessLoader) {
  const stmts = parseStatements(src).statements;
  const output = new OutputCollector();
  const warnings: SimWarning[] = [];
  const scope = new Scope();
  for (const s of stmts) {
    evalStatement(s, { scope, output, warnings, section: 'prolog', subProcessLoader: loader });
  }
  return { output, warnings };
}

function makeModule(src: string, parameterNames: string[] = []): SubProcessModule {
  return {
    sections: { prolog: src, metadata: '', data: '', epilog: '' },
    parameterNames,
  };
}

describe('evalStatement: ExecuteProcess sub-process descent', () => {
  it('runs sub-source body when loader returns module', () => {
    const sub = makeModule(`CellPutN(100, 'Plan', 'Jan');`);
    const loader: SubProcessLoader = (name) => (name === 'Sub' ? sub : undefined);

    const r = runWithLoader(`ExecuteProcess('Sub');`, loader);

    const rows = r.output.getRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ op: 'CellPutN', cube: 'Plan', coord: ['Jan'], value: 100 });
  });

  it('falls back to no-op warning when loader returns undefined', () => {
    const loader: SubProcessLoader = () => undefined;
    const r = runWithLoader(`ExecuteProcess('Missing');`, loader);
    expect(r.output.getRows()).toHaveLength(0);
    expect(r.warnings.some((w) => /not executed by simulator/.test(w.message))).toBe(true);
  });

  it('binds positional args to sub parameter names', () => {
    const sub = makeModule(`CellPutN(amount, 'Plan', region);`, ['amount', 'region']);
    const loader: SubProcessLoader = (n) => (n === 'Sub' ? sub : undefined);
    const r = runWithLoader(`ExecuteProcess('Sub', 42, 'EMEA');`, loader);
    const rows = r.output.getRows();
    expect(rows[0]).toEqual({ op: 'CellPutN', cube: 'Plan', coord: ['EMEA'], value: 42 });
  });

  it('sub has its own scope — does not leak vars back to parent', () => {
    const sub = makeModule(`leaked = 999;`);
    const loader: SubProcessLoader = (n) => (n === 'Sub' ? sub : undefined);
    const stmts = parseStatements(`ExecuteProcess('Sub'); CellPutN(leaked, 'C', 'X');`).statements;
    const output = new OutputCollector();
    const warnings: SimWarning[] = [];
    const scope = new Scope();
    for (const s of stmts) {
      evalStatement(s, { scope, output, warnings, section: 'prolog', subProcessLoader: loader });
    }
    expect(scope.get('leaked')).toBeUndefined();
  });

  it('detects cycle: A → A → warn, no infinite recursion', () => {
    const sub = makeModule(`ExecuteProcess('A');`);
    const loader: SubProcessLoader = (n) => (n === 'A' ? sub : undefined);
    const r = runWithLoader(`ExecuteProcess('A');`, loader);
    expect(r.warnings.some((w) => /cycle|recursion/i.test(w.message))).toBe(true);
  });

  it('enforces max depth (default 16)', () => {
    const loader: SubProcessLoader = (name) => {
      const m = name.match(/^A(\d+)$/);
      if (!m) return undefined;
      const n = Number(m[1]);
      return makeModule(`ExecuteProcess('A${n + 1}');`);
    };
    const stmts = parseStatements(`ExecuteProcess('A0');`).statements;
    const output = new OutputCollector();
    const warnings: SimWarning[] = [];
    const scope = new Scope();
    for (const s of stmts) {
      evalStatement(s, { scope, output, warnings, section: 'prolog', subProcessLoader: loader });
    }
    expect(warnings.some((w) => /depth/i.test(w.message))).toBe(true);
  });

  it('iterates sub data-section over module.source rows binding variables', () => {
    const sub: SubProcessModule = {
      sections: {
        prolog: '',
        metadata: '',
        data: `CellPutN(vValue, 'Cube', vTime);`,
        epilog: '',
      },
      parameterNames: [],
      source: {
        rows: [
          ['Jan', 10],
          ['Feb', 20],
        ],
        columnTypes: ['String', 'Numeric'],
      },
      variableNames: ['vTime', 'vValue'],
    };
    const loader: SubProcessLoader = (n) => (n === 'Sub' ? sub : undefined);
    const r = runWithLoader(`ExecuteProcess('Sub');`, loader);
    const rows = r.output.getRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ op: 'CellPutN', cube: 'Cube', coord: ['Jan'], value: 10 });
    expect(rows[1]).toEqual({ op: 'CellPutN', cube: 'Cube', coord: ['Feb'], value: 20 });
  });

  it('ITEMSKIP in sub data-row only skips current row, continues with next', () => {
    const sub: SubProcessModule = {
      sections: {
        prolog: '',
        metadata: '',
        data: `IF(vSkip = 1); ITEMSKIP; ENDIF;\nCellPutN(vValue, 'Cube', vKey);`,
        epilog: '',
      },
      parameterNames: [],
      source: {
        rows: [
          ['A', 1, 1],
          ['B', 0, 2],
          ['C', 1, 3],
        ],
        columnTypes: ['String', 'Numeric', 'Numeric'],
      },
      variableNames: ['vKey', 'vSkip', 'vValue'],
    };
    const loader: SubProcessLoader = (n) => (n === 'Sub' ? sub : undefined);
    const r = runWithLoader(`ExecuteProcess('Sub');`, loader);
    const rows = r.output.getRows();
    // Only B (vSkip=0) survives
    expect(rows).toHaveLength(1);
    expect(rows[0].coord).toEqual(['B']);
  });

  it('no source: ITEMSKIP in sub data-section aborts section (no fall-through ghost writes)', () => {
    // Repro of live bug: sub has no source rows bound in simulator (DataSource).
    // First IF guards undefined var → ITEMSKIP → must NOT continue to CellPutN.
    const sub: SubProcessModule = {
      sections: {
        prolog: '',
        metadata: '',
        data: `IF(DIMIX('D', vMissing) = 0); ITEMSKIP; ENDIF;\nCellPutN(vValue, 'Cube', 'X');`,
        epilog: '',
      },
      parameterNames: [],
    };
    const loader: SubProcessLoader = (n) => (n === 'Sub' ? sub : undefined);
    const r = runWithLoader(`ExecuteProcess('Sub');`, loader);
    // Ghost write would have value=0; we want zero rows emitted at all.
    expect(r.output.getRows()).toHaveLength(0);
  });

  it('non-literal first arg → no-op (cannot resolve sub name statically)', () => {
    const loader: SubProcessLoader = (_n) => makeModule(`CellPutN(1, 'C', n);`);
    const stmts = parseStatements(`name = 'X'; ExecuteProcess(name);`).statements;
    const output = new OutputCollector();
    const warnings: SimWarning[] = [];
    const scope = new Scope();
    for (const s of stmts) {
      evalStatement(s, { scope, output, warnings, section: 'prolog', subProcessLoader: loader });
    }
    expect(output.getRows()).toHaveLength(0);
  });

  // TM1 keeps NewDateFormatter handles per process (review 2026-10-20).
  it('sub starts without the parent date formatters and hands them back', () => {
    const sub = makeModule(`n = NewDateFormatter('', 'Etc/UTC'); CellPutN(n, 'C', 'Sub');`);
    const loader: SubProcessLoader = (n) => (n === 'Sub' ? sub : undefined);
    const stmts = parseStatements(
      `a = NewDateFormatter('', 'Europe/Berlin'); ExecuteProcess('Sub'); b = NewDateFormatter(''); CellPutN(b, 'C', 'Parent');`,
    ).statements;
    const output = new OutputCollector();
    const fixtures = emptyFixtures();
    const scope = new Scope();
    for (const s of stmts) {
      evalStatement(s, { scope, output, warnings: [], section: 'prolog', fixtures, subProcessLoader: loader });
    }
    expect(output.getRows().map((r) => (r as { value: number }).value)).toEqual([0, 1]);
  });
});
