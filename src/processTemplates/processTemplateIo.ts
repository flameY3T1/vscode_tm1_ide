import type { ProcessTemplate, ProcessTemplateSource } from './processTemplateTypes';

export function serializeBundle(templates: ProcessTemplate[]): string {
  const out = templates.map(({ name, description, source }) => ({
    name,
    description,
    source,
  }));
  return JSON.stringify(out, null, 2);
}

export function parseBundle(json: string): ProcessTemplate[] {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error('Bundle must contain a JSON array of templates.');
  }
  const out: ProcessTemplate[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const { name, description, source } = item as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim()) {
      continue;
    }
    if (typeof source !== 'object' || source === null) {
      continue;
    }
    out.push({
      id: crypto.randomUUID(),
      name: name.trim(),
      description: typeof description === 'string' ? description : '',
      createdAt: new Date().toISOString(),
      source: source as ProcessTemplateSource,
    });
  }
  return out;
}
