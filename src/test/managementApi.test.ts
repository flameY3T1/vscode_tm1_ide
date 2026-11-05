import { describe, it, expect } from 'vitest';
import { parseInstances, parseDatabases } from '../tm1Rest/managementApi';

describe('management parse', () => {
  it('parses instances', () => {
    const body = JSON.stringify({ value: [{ ID: 'tm1-i-x', Name: 'tm1' }] });
    expect(parseInstances(body)).toEqual([{ id: 'tm1-i-x', name: 'tm1' }]);
  });
  it('parses databases (Name only)', () => {
    const body = JSON.stringify({ value: [{ Name: 'tm1_v12_test' }, { Name: 'other' }] });
    expect(parseDatabases(body)).toEqual(['tm1_v12_test', 'other']);
  });
  it('empty/malformed → []', () => {
    expect(parseInstances('nope')).toEqual([]);
    expect(parseDatabases('{}')).toEqual([]);
  });
  it('keeps a Name-only instance (no ID) — payload is unverified, id stays best-effort', () => {
    const body = JSON.stringify({ value: [{ Name: 'tm1' }] });
    expect(parseInstances(body)).toEqual([{ id: '', name: 'tm1' }]);
  });
  it('C4: null/primitive elements are skipped, valid entries survive', () => {
    const inst = JSON.stringify({ value: [null, { ID: 'i', Name: 'tm1' }, 'x'] });
    expect(parseInstances(inst)).toEqual([{ id: 'i', name: 'tm1' }]);
    const db = JSON.stringify({ value: [null, { Name: 'db1' }, 42] });
    expect(parseDatabases(db)).toEqual(['db1']);
  });
});
