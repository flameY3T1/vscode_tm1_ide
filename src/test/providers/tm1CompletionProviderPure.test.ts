import { describe, it, expect } from 'vitest';
import { parseDsVariables } from '../../providers/tm1CompletionProviderPure';

describe('parseDsVariables', () => {
  it('returns empty array when no 577/578 blocks exist', () => {
    expect(parseDsVariables('602,"X"\n572,0\n573,0\n574,0\n575,0\n')).toEqual([]);
  });

  it('parses names + types from 577/578 blocks before prolog', () => {
    const text = [
      '602,"MyProc"',
      '577,2',
      'vName',
      'vAge',
      '578,2',
      '2',
      '1',
      '572,0',
      '573,0',
      '574,0',
      '575,0',
    ].join('\n');
    expect(parseDsVariables(text)).toEqual([
      { Name: 'vName', Type: 'String' },
      { Name: 'vAge',  Type: 'Numeric' },
    ]);
  });

  it('defaults missing type to String (2)', () => {
    const text = [
      '577,1',
      'vOnly',
      '572,0',
    ].join('\n');
    expect(parseDsVariables(text)).toEqual([{ Name: 'vOnly', Type: 'String' }]);
  });

  it('treats invalid type number as String (NaN -> fallback 2)', () => {
    const text = [
      '577,1',
      'vBad',
      '578,1',
      'not-a-number',
      '572,0',
    ].join('\n');
    expect(parseDsVariables(text)).toEqual([{ Name: 'vBad', Type: 'String' }]);
  });

  it('ignores 577/578 blocks after the prolog marker', () => {
    const text = [
      '572,0',
      '577,1',
      'vShouldNotBeFound',
    ].join('\n');
    expect(parseDsVariables(text)).toEqual([]);
  });

  it('trims whitespace from variable names', () => {
    const text = [
      '577,1',
      '  vSpaced  ',
      '572,0',
    ].join('\n');
    expect(parseDsVariables(text)).toEqual([{ Name: 'vSpaced', Type: 'String' }]);
  });

  it('handles CRLF line endings', () => {
    const text = '577,1\r\nvCrlf\r\n572,0\r\n';
    expect(parseDsVariables(text)).toEqual([{ Name: 'vCrlf', Type: 'String' }]);
  });

  it('uses 577 count to slice exact name window (extra lines after block ignored)', () => {
    const text = [
      '577,2',
      'vA',
      'vB',
      'vC_not_part_of_577_block',
      '572,0',
    ].join('\n');
    const out = parseDsVariables(text);
    expect(out.map(x => x.Name)).toEqual(['vA', 'vB']);
  });

  it('returns empty when 577 block missing but 578 present', () => {
    const text = [
      '578,1',
      '1',
      '572,0',
    ].join('\n');
    expect(parseDsVariables(text)).toEqual([]);
  });
});
