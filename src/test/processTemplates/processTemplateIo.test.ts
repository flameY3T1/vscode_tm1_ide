import { describe, it, expect } from 'vitest';
import { serializeBundle, parseBundle } from '../../processTemplates/processTemplateIo';
import type { ProcessTemplate } from '../../processTemplates/processTemplateTypes';

const tpl: ProcessTemplate = {
  id: 'a1',
  name: 'A',
  description: 'desc',
  createdAt: '2026-05-25T00:00:00Z',
  source: {
    PrologProcedure: 'p;',
    MetadataProcedure: '',
    DataProcedure: '',
    EpilogProcedure: '',
    Parameters: [],
    Variables: [],
    DataSource: { Type: 'None' },
  },
};

describe('processTemplateIo', () => {
  it('serializes array of templates omitting ids', () => {
    const json = serializeBundle([tpl]);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('A');
    expect(parsed[0].id).toBeUndefined();
  });

  it('parses bundle generating fresh ids + timestamps', () => {
    const out = parseBundle(
      JSON.stringify([{ name: 'X', description: '', source: tpl.source }])
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(out[0].name).toBe('X');
    expect(out[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('rejects non-array JSON', () => {
    expect(() => parseBundle('{}')).toThrow();
  });

  it('skips entries missing required fields', () => {
    const out = parseBundle(
      JSON.stringify([
        { description: 'no name' },
        { name: 'OK', description: '', source: tpl.source },
      ])
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('OK');
  });
});
