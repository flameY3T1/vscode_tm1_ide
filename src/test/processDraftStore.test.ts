import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveDraft, loadDraft, clearDraft, hasDraft,
  type ProcessDraft, type DraftMemento,
} from '../commands/processEditor/draftStore';
import { MAX_DRAFTS } from '../utils/draftStore';

/** Minimal in-memory stand-in for `vscode.Memento`. */
function fakeMemento(): DraftMemento & { raw: Record<string, unknown> } {
  const raw: Record<string, unknown> = {};
  return {
    raw,
    get<T>(key: string, fallback: T): T { return (raw[key] as T) ?? fallback; },
    async update(key: string, value: unknown): Promise<void> {
      if (value === undefined) { delete raw[key]; } else { raw[key] = value; }
    },
  };
}

const draft = (prolog: string): ProcessDraft => ({
  sections: { prolog, metadata: '', data: '', epilog: '' },
  parameters: [], dataSource: { Type: 'None' }, variables: [],
});

let mem: ReturnType<typeof fakeMemento>;
beforeEach(() => { mem = fakeMemento(); });

describe('process draft store', () => {
  it('round-trips a draft under its panel key', async () => {
    await saveDraft(mem, 'srv|Proc', draft('x = 1;'), 1000);
    expect(loadDraft(mem, 'srv|Proc')?.sections.prolog).toBe('x = 1;');
  });

  it('reports a stored draft without loading it', async () => {
    expect(hasDraft(mem, 'srv|Proc')).toBe(false);
    await saveDraft(mem, 'srv|Proc', draft('x'), 1000);
    expect(hasDraft(mem, 'srv|Proc')).toBe(true);
  });

  it('keeps drafts of different processes apart', async () => {
    await saveDraft(mem, 'srv|A', draft('aaa'), 1000);
    await saveDraft(mem, 'srv|B', draft('bbb'), 1000);
    expect(loadDraft(mem, 'srv|A')?.sections.prolog).toBe('aaa');
    expect(loadDraft(mem, 'srv|B')?.sections.prolog).toBe('bbb');
  });

  it('keeps the same process on two servers apart', async () => {
    await saveDraft(mem, 'srvA|Proc', draft('from-a'), 1000);
    await saveDraft(mem, 'srvB|Proc', draft('from-b'), 1000);
    expect(loadDraft(mem, 'srvA|Proc')?.sections.prolog).toBe('from-a');
    expect(loadDraft(mem, 'srvB|Proc')?.sections.prolog).toBe('from-b');
  });

  it('overwrites an older draft of the same process', async () => {
    await saveDraft(mem, 'srv|Proc', draft('old'), 1000);
    await saveDraft(mem, 'srv|Proc', draft('new'), 2000);
    expect(loadDraft(mem, 'srv|Proc')?.sections.prolog).toBe('new');
  });

  it('clears a draft', async () => {
    await saveDraft(mem, 'srv|Proc', draft('x'), 1000);
    await clearDraft(mem, 'srv|Proc');
    expect(loadDraft(mem, 'srv|Proc')).toBeUndefined();
    expect(hasDraft(mem, 'srv|Proc')).toBe(false);
  });

  it('clearing a draft leaves the others alone', async () => {
    await saveDraft(mem, 'srv|A', draft('aaa'), 1000);
    await saveDraft(mem, 'srv|B', draft('bbb'), 1000);
    await clearDraft(mem, 'srv|A');
    expect(loadDraft(mem, 'srv|B')?.sections.prolog).toBe('bbb');
  });

  it('drops the oldest draft once the cap is reached', async () => {
    for (let i = 0; i < MAX_DRAFTS + 5; i++) {
      await saveDraft(mem, `srv|P${i}`, draft(`p${i}`), 1000 + i);
    }
    // The five oldest are gone, the newest survive.
    expect(loadDraft(mem, 'srv|P0')).toBeUndefined();
    expect(loadDraft(mem, 'srv|P4')).toBeUndefined();
    expect(loadDraft(mem, `srv|P${MAX_DRAFTS + 4}`)).toBeTruthy();
  });

  it('never stores more than the cap', async () => {
    for (let i = 0; i < MAX_DRAFTS + 20; i++) {
      await saveDraft(mem, `srv|P${i}`, draft('x'), 1000 + i);
    }
    const stored = mem.raw['tm1.processDrafts'] as Record<string, unknown>;
    expect(Object.keys(stored).length).toBe(MAX_DRAFTS);
  });

  it('re-saving an existing key does not consume a new slot', async () => {
    for (let i = 0; i < MAX_DRAFTS; i++) {
      await saveDraft(mem, `srv|P${i}`, draft('x'), 1000 + i);
    }
    await saveDraft(mem, 'srv|P0', draft('updated'), 9999);
    const stored = mem.raw['tm1.processDrafts'] as Record<string, unknown>;
    expect(Object.keys(stored).length).toBe(MAX_DRAFTS);
    expect(loadDraft(mem, 'srv|P0')?.sections.prolog).toBe('updated');
  });

  it('survives a corrupt store instead of throwing', () => {
    mem.raw['tm1.processDrafts'] = 'not an object';
    expect(loadDraft(mem, 'srv|Proc')).toBeUndefined();
    expect(hasDraft(mem, 'srv|Proc')).toBe(false);
  });

  it('ignores an entry that is missing its sections', async () => {
    mem.raw['tm1.processDrafts'] = { 'srv|Proc': { savedAt: 1, draft: { parameters: [] } } };
    expect(loadDraft(mem, 'srv|Proc')).toBeUndefined();
  });

  it('reports when the draft was saved', async () => {
    await saveDraft(mem, 'srv|Proc', draft('x'), 4711);
    expect(loadDraft(mem, 'srv|Proc')?.savedAt).toBe(4711);
  });
});
