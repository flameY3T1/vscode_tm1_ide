import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProcessTemplateStorage } from '../../processTemplates/processTemplateStorage';
import type { ProcessTemplate } from '../../processTemplates/processTemplateTypes';

function makeCtx() {
  const store = new Map<string, any>();
  return {
    globalState: {
      get: <T>(k: string, fallback: T) => store.has(k) ? store.get(k) : fallback,
      update: vi.fn((k: string, v: any) => { store.set(k, v); return Promise.resolve(); }),
    },
  } as any;
}

const sample = (over: Partial<ProcessTemplate> = {}): ProcessTemplate => ({
  id: 'a1', name: 'A', description: '', createdAt: '2026-05-25T00:00:00Z',
  source: { PrologProcedure: '', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '', Parameters: [], Variables: [], DataSource: { Type: 'None' } },
  ...over,
});

describe('ProcessTemplateStorage', () => {
  let ctx: ReturnType<typeof makeCtx>;
  let storage: ProcessTemplateStorage;
  beforeEach(() => { ctx = makeCtx(); storage = new ProcessTemplateStorage(ctx); });

  it('returns empty list initially', () => {
    expect(storage.getAll()).toEqual([]);
  });

  it('saves, retrieves, deletes', async () => {
    await storage.save(sample({ id: 'a1', name: 'A' }));
    await storage.save(sample({ id: 'b2', name: 'B' }));
    expect(storage.getAll()).toHaveLength(2);
    expect(storage.get('a1')?.name).toBe('A');
    await storage.delete('a1');
    expect(storage.getAll()).toHaveLength(1);
    expect(storage.get('a1')).toBeUndefined();
  });

  it('save replaces by id (no duplicates)', async () => {
    await storage.save(sample({ id: 'a1', name: 'A' }));
    await storage.save(sample({ id: 'a1', name: 'A renamed' }));
    expect(storage.getAll()).toHaveLength(1);
    expect(storage.get('a1')?.name).toBe('A renamed');
  });

  describe('getFiltered', () => {
    it('returns all templates when servers field is empty or absent', async () => {
      await storage.save(sample({ id: 't1', servers: undefined }));
      await storage.save(sample({ id: 't2', servers: '' }));
      expect(storage.getFiltered('AnyServer')).toHaveLength(2);
      expect(storage.getFiltered(undefined)).toHaveLength(2);
    });

    it('filters by server name (case-insensitive)', async () => {
      await storage.save(sample({ id: 't1', servers: 'ProdServer;DevServer' }));
      await storage.save(sample({ id: 't2', servers: 'ProdServer' }));
      await storage.save(sample({ id: 't3', servers: '' }));
      expect(storage.getFiltered('prodserver')).toHaveLength(3); // t1 + t2 + t3
      expect(storage.getFiltered('DevServer')).toHaveLength(2);  // t1 + t3
      expect(storage.getFiltered('Other')).toHaveLength(1);      // t3 only
      expect(storage.getFiltered(undefined)).toHaveLength(1);    // t3 only (undefined = no server)
    });
  });
});
