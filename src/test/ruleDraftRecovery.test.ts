import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import {
  saveRuleDraft, hasRuleDraft, loadRuleDraft,
  parkRuleDraft, offerRuleDraftRecovery,
} from '../commands/rule/ruleDraftStore';
import type { DraftMemento } from '../utils/draftStore';

const KEY = 'http://srv:SalesCube';
const RULES = "['Sales'] = N: 42;";

let mem: DraftMemento;
let raw: Record<string, unknown>;

function answersWith(label: string | undefined) {
  (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue(label);
}

beforeEach(() => {
  vi.clearAllMocks();
  raw = {};
  mem = {
    get: <T,>(k: string, d: T) => (raw[k] as T) ?? d,
    update: async (k: string, v: unknown) => { raw[k] = v; },
  };
});

describe('rule draft store', () => {
  it('round-trips the rules text', async () => {
    await saveRuleDraft(mem, KEY, { rulesText: RULES }, 1000);
    expect(loadRuleDraft(mem, KEY)?.rulesText).toBe(RULES);
  });

  it('keeps rule drafts in their own namespace, not the process one', async () => {
    await saveRuleDraft(mem, KEY, { rulesText: RULES }, 1000);
    expect(Object.keys(raw)).toEqual(['tm1.ruleDrafts']);
  });

  it('ignores an entry whose payload has no rules text', () => {
    raw['tm1.ruleDrafts'] = { [KEY]: { savedAt: 1, draft: { sections: {} } } };
    expect(loadRuleDraft(mem, KEY)).toBeUndefined();
    expect(hasRuleDraft(mem, KEY)).toBe(false);
  });

  it('accepts empty rules text — deleting every rule is a real edit', async () => {
    await saveRuleDraft(mem, KEY, { rulesText: '' }, 1000);
    expect(loadRuleDraft(mem, KEY)?.rulesText).toBe('');
  });
});

describe('parkRuleDraft', () => {
  it('parks the code when the editor was dirty', async () => {
    await parkRuleDraft(mem, KEY, 'SalesCube', RULES, true, 5000);
    expect(loadRuleDraft(mem, KEY)?.rulesText).toBe(RULES);
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });

  it('parks nothing when the editor was clean', async () => {
    await parkRuleDraft(mem, KEY, 'SalesCube', RULES, false, 5000);
    expect(hasRuleDraft(mem, KEY)).toBe(false);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('is a no-op without a memento instead of throwing', async () => {
    await expect(parkRuleDraft(undefined, KEY, 'SalesCube', RULES, true, 5000)).resolves.toBeUndefined();
  });

  it('reports a failed park instead of losing the work silently', async () => {
    const broken: DraftMemento = {
      get: <T,>(_k: string, d: T) => d,
      update: async () => { throw new Error('storage full'); },
    };
    await parkRuleDraft(broken, KEY, 'SalesCube', RULES, true, 5000);
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });
});

describe('offerRuleDraftRecovery', () => {
  beforeEach(async () => { await saveRuleDraft(mem, KEY, { rulesText: RULES }, 1000); });

  it('returns the text and consumes the draft when restored', async () => {
    answersWith('Restore');
    expect(await offerRuleDraftRecovery(mem, KEY, 'SalesCube')).toBe(RULES);
    expect(hasRuleDraft(mem, KEY)).toBe(false);
  });

  it('returns nothing and consumes the draft when discarded', async () => {
    answersWith('Discard');
    expect(await offerRuleDraftRecovery(mem, KEY, 'SalesCube')).toBeUndefined();
    expect(hasRuleDraft(mem, KEY)).toBe(false);
  });

  it('KEEPS the draft when the dialog is dismissed', async () => {
    answersWith(undefined);
    expect(await offerRuleDraftRecovery(mem, KEY, 'SalesCube')).toBeUndefined();
    expect(hasRuleDraft(mem, KEY)).toBe(true);
  });

  it('asks as a modal', async () => {
    answersWith('Restore');
    await offerRuleDraftRecovery(mem, KEY, 'SalesCube');
    expect((vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mock.calls[0][1])
      .toMatchObject({ modal: true });
  });

  it('asks nothing when no draft is parked', async () => {
    expect(await offerRuleDraftRecovery(mem, 'http://srv:Other', 'Other')).toBeUndefined();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('asks nothing without a memento', async () => {
    expect(await offerRuleDraftRecovery(undefined, KEY, 'SalesCube')).toBeUndefined();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });
});
