// src/test/serverConfig/configDiff.test.ts
import { describe, it, expect } from 'vitest';
import { coerceType, buildDiff, type DiffEntry } from '../../serverConfig/configDiff';

describe('coerceType', () => {
  it('coerces string→number for numeric param', () => {
    expect(coerceType('42', { type: 'number' })).toBe(42);
  });
  // Measured on 2026-09-18 on 11.8 (IntegratedSecurityMode): a string returns
  // `400 code 278 Invalid enum value encountered in payload.`, the bare number
  // returns `200`. An enum made up entirely of digits therefore goes out as a number.
  it('sends a digits-only enum as a number, a named enum as a string', () => {
    expect(coerceType('2', { type: 'enum', enumValues: ['1', '2', '3'] })).toBe(2);
    expect(coerceType('ipv6', { type: 'enum', enumValues: ['ipv4', 'ipv6'] })).toBe('ipv6');
  });

  it('throws on non-numeric for numeric param', () => {
    expect(() => coerceType('abc', { type: 'number' })).toThrow();
  });
  it('coerces "true"/"false"/"1"/"0" → bool', () => {
    expect(coerceType('true', { type: 'bool' })).toBe(true);
    expect(coerceType('false', { type: 'bool' })).toBe(false);
    expect(coerceType('1', { type: 'bool' })).toBe(true);
    expect(coerceType('0', { type: 'bool' })).toBe(false);
  });
  it('throws if enum value not in list', () => {
    expect(() => coerceType('xyz', { type: 'enum', enumValues: ['a','b'] })).toThrow();
  });
  it('passes through string', () => {
    expect(coerceType('hello', { type: 'string' })).toBe('hello');
  });
  it('treats undefined def as string passthrough', () => {
    expect(coerceType('raw', undefined)).toBe('raw');
  });
  it('rejects empty/whitespace string for numeric param', () => {
    expect(() => coerceType('', { type: 'number' })).toThrow();
    expect(() => coerceType('   ', { type: 'number' })).toThrow();
  });
  it('rejects Infinity/-Infinity for numeric param', () => {
    expect(() => coerceType('Infinity', { type: 'number' })).toThrow();
    expect(() => coerceType('-Infinity', { type: 'number' })).toThrow();
  });
  it('throws clear error if enum def is missing enumValues', () => {
    expect(() => coerceType('a', { type: 'enum' })).toThrow(/Enum definition/);
    expect(() => coerceType('a', { type: 'enum', enumValues: [] })).toThrow(/Enum definition/);
  });
});

describe('buildDiff', () => {
  it('returns empty for identical maps', () => {
    const orig = new Map<string, unknown>([['A', 1], ['B', 'x']]);
    const edited = new Map<string, unknown>([['A', 1], ['B', 'x']]);
    expect(buildDiff(orig, edited)).toEqual([]);
  });

  it('detects changed value', () => {
    const orig = new Map<string, unknown>([['MTQ', 'ALL']]);
    const edited = new Map<string, unknown>([['MTQ', 'AUTO']]);
    const diff = buildDiff(orig, edited);
    expect(diff).toEqual<DiffEntry[]>([
      { name: 'MTQ', oldValue: 'ALL', newValue: 'AUTO' },
    ]);
  });

  it('ignores keys present only in original (no removals exposed)', () => {
    const orig = new Map<string, unknown>([['A', 1], ['B', 2]]);
    const edited = new Map<string, unknown>([['A', 1]]);
    expect(buildDiff(orig, edited)).toEqual([]);
  });

  it('detects newly added keys', () => {
    const orig = new Map<string, unknown>();
    const edited = new Map<string, unknown>([['NewParam', 'v']]);
    expect(buildDiff(orig, edited)).toEqual<DiffEntry[]>([
      { name: 'NewParam', oldValue: undefined, newValue: 'v' },
    ]);
  });

  it('treats string-vs-number with same lexical content as different', () => {
    const orig = new Map<string, unknown>([['Port', 5000]]);
    const edited = new Map<string, unknown>([['Port', '5000']]);
    expect(buildDiff(orig, edited).length).toBe(1);
  });

  it('treats two empty arrays as equal (postMessage-clone scenario)', () => {
    const orig = new Map<string, unknown>([['ClientCAMURIs', []]]);
    const edited = new Map<string, unknown>([['ClientCAMURIs', []]]);
    expect(buildDiff(orig, edited)).toEqual([]);
  });

  it('treats arrays with same content but different refs as equal', () => {
    const orig = new Map<string, unknown>([['List', ['a', 'b']]]);
    const edited = new Map<string, unknown>([['List', ['a', 'b']]]);
    expect(buildDiff(orig, edited)).toEqual([]);
  });

  it('treats arrays with different order as different', () => {
    const orig = new Map<string, unknown>([['List', ['a', 'b']]]);
    const edited = new Map<string, unknown>([['List', ['b', 'a']]]);
    expect(buildDiff(orig, edited).length).toBe(1);
  });
});
