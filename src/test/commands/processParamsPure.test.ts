import { describe, it, expect } from 'vitest';
import { buildFormHtmlStyled } from '../../commands/processEditor/processParamsPure';
import { parseParametersFromFileContent } from '../../utils/proFile';

describe('parseParametersFromFileContent', () => {
  it('returns empty array when no parameters defined', () => {
    expect(parseParametersFromFileContent('')).toEqual([]);
  });

  it('parses single numeric parameter with default', () => {
    const proFile = [
      '560,1',
      'pCount',
      '561,1',
      '1',
      '590,1',
      'pCount,42',
      '572,0',
    ].join('\n');
    expect(parseParametersFromFileContent(proFile)).toEqual([
      { Name: 'pCount', Type: 1, Value: '42', Prompt: 'pCount' },
    ]);
  });

  it('parses single string parameter with quoted default', () => {
    const proFile = [
      '560,1',
      'pName',
      '561,1',
      '2',
      '590,1',
      'pName,"hello world"',
      '572,0',
    ].join('\n');
    expect(parseParametersFromFileContent(proFile)).toEqual([
      { Name: 'pName', Type: 2, Value: 'hello world', Prompt: 'pName' },
    ]);
  });

  it('uses 637 block for prompts/descriptions', () => {
    const proFile = [
      '560,1',
      'pX',
      '561,1',
      '1',
      '637,1',
      'pX,"X-Wert"',
      '572,0',
    ].join('\n');
    expect(parseParametersFromFileContent(proFile)).toEqual([
      { Name: 'pX', Type: 1, Value: '', Prompt: 'X-Wert' },
    ]);
  });

  it('parses multiple parameters', () => {
    const proFile = [
      '560,3',
      'A',
      'B',
      'C',
      '561,3',
      '1',
      '2',
      '1',
      '590,3',
      'A,1',
      'B,"hello"',
      'C,3.14',
      '572,0',
    ].join('\n');
    const result = parseParametersFromFileContent(proFile);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ Name: 'A', Type: 1, Value: '1', Prompt: 'A' });
    expect(result[1]).toEqual({ Name: 'B', Type: 2, Value: 'hello', Prompt: 'B' });
    expect(result[2]).toEqual({ Name: 'C', Type: 1, Value: '3.14', Prompt: 'C' });
  });

  it('handles CRLF line endings', () => {
    const proFile = '560,1\r\npX\r\n561,1\r\n1\r\n572,0';
    const result = parseParametersFromFileContent(proFile);
    expect(result).toEqual([{ Name: 'pX', Type: 1, Value: '', Prompt: 'pX' }]);
  });

  it('falls back to type=1 when no type block', () => {
    const proFile = '560,1\npX\n572,0';
    expect(parseParametersFromFileContent(proFile)[0].Type).toBe(1);
  });

  it('falls back to empty value when no 590 block', () => {
    const proFile = '560,1\npX\n561,1\n2\n572,0';
    expect(parseParametersFromFileContent(proFile)[0].Value).toBe('');
  });

  it('falls back to Name as Prompt when no 637 block', () => {
    const proFile = '560,1\npX\n572,0';
    expect(parseParametersFromFileContent(proFile)[0].Prompt).toBe('pX');
  });

  it('only parses blocks before 572', () => {
    const proFile = [
      '560,1',
      'pX',
      '572,1',
      'somecode',
      '590,1',
      'pX,99',
    ].join('\n');
    expect(parseParametersFromFileContent(proFile)[0].Value).toBe('');
  });

  it('handles unquoted strings in 590 block', () => {
    const proFile = '560,1\npX\n561,1\n2\n590,1\npX,raw\n572,0';
    expect(parseParametersFromFileContent(proFile)[0].Value).toBe('raw');
  });

  it('preserves comma inside quoted value', () => {
    const proFile = '560,1\npX\n561,1\n2\n590,1\npX,"a,b,c"\n572,0';
    expect(parseParametersFromFileContent(proFile)[0].Value).toBe('a,b,c');
  });

  it('parses missing prolog (no 572) by scanning whole file', () => {
    const proFile = '560,1\npX\n561,1\n1\n590,1\npX,7';
    const r = parseParametersFromFileContent(proFile);
    expect(r[0].Value).toBe('7');
  });

  it('parses out-of-order blocks', () => {
    const proFile = [
      '561,1',
      '2',
      '590,1',
      'pX,"v"',
      '560,1',
      'pX',
      '572,0',
    ].join('\n');
    const r = parseParametersFromFileContent(proFile);
    expect(r).toEqual([{ Name: 'pX', Type: 2, Value: 'v', Prompt: 'pX' }]);
  });

  it('skips malformed 590 entry without comma', () => {
    const proFile = '560,1\npX\n561,1\n1\n590,1\nbroken-no-comma\n572,0';
    expect(parseParametersFromFileContent(proFile)[0].Value).toBe('');
  });
});

describe('buildFormHtmlStyled', () => {
  it('returns DOCTYPE HTML', () => {
    const html = buildFormHtmlStyled('P', [], 'Run');
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('embeds process name (escaped)', () => {
    const html = buildFormHtmlStyled('My<Proc>', [], 'Run');
    expect(html).toContain('My&lt;Proc&gt;');
  });

  it('embeds button label (escaped)', () => {
    const html = buildFormHtmlStyled('P', [], 'Run "now"');
    expect(html).toContain('Run &quot;now&quot;');
  });

  it('shows parameter count badge', () => {
    const params = [
      { Name: 'a', Type: 1, Value: '', Prompt: '' },
      { Name: 'b', Type: 2, Value: '', Prompt: '' },
    ];
    expect(buildFormHtmlStyled('P', params, 'Run')).toContain('2 Parameter');
  });

  it('emits Numeric type badge for Type=1', () => {
    const params = [{ Name: 'pNum', Type: 1, Value: '0', Prompt: 'pNum' }];
    const html = buildFormHtmlStyled('P', params, 'Run');
    expect(html).toContain('type-badge numeric');
    expect(html).toContain('type="number"');
  });

  it('emits String type badge for Type=2', () => {
    const params = [{ Name: 'pStr', Type: 2, Value: 'x', Prompt: 'pStr' }];
    const html = buildFormHtmlStyled('P', params, 'Run');
    expect(html).toContain('type-badge string');
    expect(html).toContain('type="text"');
  });

  it('escapes HTML in param Name + Value', () => {
    const params = [{ Name: '<x>', Type: 1, Value: '"v"', Prompt: '' }];
    const html = buildFormHtmlStyled('P', params, 'Run');
    expect(html).toContain('&lt;x&gt;');
    expect(html).toContain('&quot;v&quot;');
  });

  it('marks first input as autofocus', () => {
    const params = [
      { Name: 'a', Type: 1, Value: '', Prompt: '' },
      { Name: 'b', Type: 1, Value: '', Prompt: '' },
    ];
    const html = buildFormHtmlStyled('P', params, 'Run');
    const firstAutofocus = html.indexOf('autofocus');
    const secondAutofocus = html.indexOf('autofocus', firstAutofocus + 1);
    expect(firstAutofocus).toBeGreaterThan(-1);
    expect(secondAutofocus).toBe(-1);
  });

  it('omits description div when Prompt is empty', () => {
    const params = [{ Name: 'a', Type: 1, Value: '', Prompt: '' }];
    const html = buildFormHtmlStyled('P', params, 'Run');
    expect(html).not.toContain('class="param-desc"');
  });

  it('emits description div when Prompt is set', () => {
    const params = [{ Name: 'a', Type: 1, Value: '', Prompt: 'Bitte eingeben' }];
    const html = buildFormHtmlStyled('P', params, 'Run');
    expect(html).toContain('class="param-desc"');
    expect(html).toContain('Bitte eingeben');
  });
});
