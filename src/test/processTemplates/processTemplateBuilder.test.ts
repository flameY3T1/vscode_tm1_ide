// src/test/processTemplates/processTemplateBuilder.test.ts
import { describe, it, expect } from 'vitest';
import { processToTemplate } from '../../processTemplates/processTemplateBuilder';

describe('processTemplateBuilder', () => {
  const sampleProcess = {
    Name: 'bedrock.cube.data.copy',
    PrologProcedure: 'sSource = pSourceCube;',
    MetadataProcedure: '',
    DataProcedure: '',
    EpilogProcedure: '',
    Parameters: [
      { Name: 'pSourceCube', Type: 'String', Value: '', Prompt: 'Source cube' },
      { Name: 'pTargetCube', Type: 'String', Value: '', Prompt: 'Target cube' },
    ],
    Variables: [],
    DataSource: { Type: 'None' },
  };

  it('captures source process minus identity fields', () => {
    const tpl = processToTemplate(sampleProcess, { name: 'Copy Cube', description: 'desc' });
    expect(tpl.name).toBe('Copy Cube');
    expect(tpl.description).toBe('desc');
    expect(tpl.source.PrologProcedure).toBe('sSource = pSourceCube;');
    expect(tpl.source.Parameters).toHaveLength(2);
    expect(tpl.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(tpl.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('strips Name from source when building template', () => {
    const tpl = processToTemplate(sampleProcess, { name: 'x', description: '' });
    expect((tpl.source as any).Name).toBeUndefined();
  });
});
