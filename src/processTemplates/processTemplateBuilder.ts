import { randomUUID } from 'crypto';
import { ProcessTemplate, ProcessTemplateSource } from './processTemplateTypes';

export function processToTemplate(
  process: Record<string, any>,
  meta: { name: string; description: string },
): ProcessTemplate {
  const source: ProcessTemplateSource = {
    PrologProcedure:   process.PrologProcedure   ?? '',
    MetadataProcedure: process.MetadataProcedure ?? '',
    DataProcedure:     process.DataProcedure     ?? '',
    EpilogProcedure:   process.EpilogProcedure   ?? '',
    Parameters:        Array.isArray(process.Parameters) ? process.Parameters : [],
    Variables:         Array.isArray(process.Variables)  ? process.Variables  : [],
    DataSource:        process.DataSource ?? { Type: 'None' },
  };
  return {
    id: randomUUID(),
    name: meta.name,
    description: meta.description,
    createdAt: new Date().toISOString(),
    source,
  };
}
