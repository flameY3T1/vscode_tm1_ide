// Snippet storage ran without any test until 2026-08-29 — it was a
// line-for-line copy of `ProcessTemplateStorage`. When merging onto
// `namedStore`, this test covers the four operations and the visibility.
import { describe, it, expect, beforeEach } from 'vitest';
import type * as vscode from 'vscode';
import { SnippetStorage, type TiSnippet } from '../../snippets/snippetStorage';

let gs: Map<string, unknown>;
let storage: SnippetStorage;

function snip(id: string, extra: Partial<TiSnippet> = {}): TiSnippet {
  return { id, trigger: `t${id}`, name: `N${id}`, description: '', body: 'x', ...extra };
}

beforeEach(() => {
  gs = new Map<string, unknown>();
  const ctx = {
    globalState: {
      get: (k: string, dflt?: unknown) => (gs.has(k) ? gs.get(k) : dflt),
      update: (k: string, v: unknown) => { gs.set(k, v); return Promise.resolve(); },
    },
  } as unknown as vscode.ExtensionContext;
  storage = new SnippetStorage(ctx);
});

describe('SnippetStorage', () => {
  it('creates, reads back and changes in place', async () => {
    await storage.save(snip('a'));
    await storage.save(snip('b'));
    expect(storage.getAll().map(s => s.id)).toEqual(['a', 'b']);

    await storage.save(snip('a', { name: 'neu' }));
    expect(storage.getAll()).toHaveLength(2);
    expect(storage.get('a')?.name).toBe('neu');
    // The order is kept: a change does not append at the end.
    expect(storage.getAll().map(s => s.id)).toEqual(['a', 'b']);
  });

  it('empty storage returns an empty list, not undefined', () => {
    expect(storage.getAll()).toEqual([]);
    expect(storage.get('fehlt')).toBeUndefined();
  });

  it('deletes exactly one entry', async () => {
    await storage.save(snip('a'));
    await storage.save(snip('b'));
    await storage.delete('a');
    expect(storage.getAll().map(s => s.id)).toEqual(['b']);
  });

  it('getFiltered respects the scope', async () => {
    await storage.save(snip('frei'));
    await storage.save(snip('nurProd', { servers: 'Prod' }));
    expect(storage.getFiltered('Prod').map(s => s.id)).toEqual(['frei', 'nurProd']);
    expect(storage.getFiltered('Dev').map(s => s.id)).toEqual(['frei']);
    expect(storage.getFiltered(undefined).map(s => s.id)).toEqual(['frei']);
  });
});
