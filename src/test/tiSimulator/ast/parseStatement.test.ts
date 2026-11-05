import { describe, it, expect } from 'vitest';
import { parseStatements } from '../../../tiSimulator/ast/parseStatement';

describe('parseStatements', () => {
  it('parses a single assignment', () => {
    const r = parseStatements(`x = 1;`);
    expect(r.errors).toEqual([]);
    expect(r.statements).toEqual([
      { kind: 'assign', target: 'x', value: { kind: 'numLit', value: 1 }, line: 1 },
    ]);
  });

  it('parses a CellPutN statement', () => {
    const r = parseStatements(`CellPutN(100, 'Plan', 'Jan');`);
    expect(r.errors).toEqual([]);
    expect(r.statements[0]).toMatchObject({
      kind: 'call',
      name: 'CellPutN',
      line: 1,
    });
    expect((r.statements[0] as { args: unknown[] }).args).toHaveLength(3);
  });

  it('treats blank + comment lines as noop', () => {
    const r = parseStatements(`# comment\n\n// also comment\nx = 1;`);
    expect(r.statements.filter((s) => s.kind === 'noop')).toHaveLength(3);
    expect(r.statements.filter((s) => s.kind === 'assign')).toHaveLength(1);
  });

  it('parses assignment with arithmetic rhs', () => {
    const r = parseStatements(`y = v1 + 2;`);
    expect(r.errors).toEqual([]);
    expect((r.statements[0] as { value: { kind: string } }).value.kind).toBe('binary');
  });

  it('parses multi-line continuation', () => {
    const src = `CellPutN(100,\n 'Plan',\n 'Jan');`;
    const r = parseStatements(src);
    expect(r.errors).toEqual([]);
    expect(r.statements.filter((s) => s.kind === 'call')).toHaveLength(1);
  });

  it('records errors for unrecognised statements', () => {
    const r = parseStatements(`@@@ junk @@@;`);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  // Live processes name variables nSchlüssel / sPrimärkosten (12 of 280 failed
  // to parse with an ASCII-only identifier class).
  it('accepts non-ASCII letters in identifiers', () => {
    const r = parseStatements(`nSchlüssel = nWert * 2;\nCellPutN(nSchlüssel, 'C', 'Ä');`);
    expect(r.errors).toEqual([]);
    expect(r.statements[0]).toMatchObject({ kind: 'assign', target: 'nSchlüssel' });
    expect(r.statements[1]).toMatchObject({ kind: 'call', name: 'CellPutN' });
    expect((r.statements[1] as { args: unknown[] }).args[0]).toEqual({ kind: 'ident', name: 'nSchlüssel' });
  });

  it('rejects a bare identifier that is no statement (typo, stray variable)', () => {
    expect(parseStatements(`vCount;`).errors.length).toBe(1);
    expect(parseStatements(`IF(1=1);\nENDIFF;`).errors.length).toBeGreaterThan(0);
  });

  it('reads a bare identifier statement as a zero-argument call', () => {
    const r = parseStatements(`SaveDataAll;`);
    expect(r.errors).toEqual([]);
    expect(r.statements).toEqual([{ kind: 'call', name: 'SAVEDATAALL', args: [], line: 1 }]);
  });

  it('preserves line numbers', () => {
    const r = parseStatements(`x = 1;\ny = 2;`);
    const stmts = r.statements.filter((s) => s.kind === 'assign');
    expect(stmts[0].line).toBe(1);
    expect(stmts[1].line).toBe(2);
  });

  it('parses CellPutN without trailing semicolon', () => {
    const r = parseStatements(`CellPutN(100, 'Plan', 'Jan')`);
    expect(r.errors).toEqual([]);
    expect(r.statements[0].kind).toBe('call');
  });

  it('records error for malformed assignment rhs', () => {
    const r = parseStatements(`x = 1 + ;`);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
