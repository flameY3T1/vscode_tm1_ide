import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

import { offerDraftRecovery } from '../commands/processEditor/draftRecovery';
import { configureProcessEditor } from '../commands/processEditor/state';
import { saveDraft, hasDraft, type DraftMemento } from '../commands/processEditor/draftStore';

const KEY = 'http://srv|MyProcess';
const DRAFT = {
  sections: { prolog: 'sRecovered = 1;', metadata: '', data: '', epilog: '' },
  parameters: [], dataSource: { Type: 'None' }, variables: [],
};

let mem: DraftMemento;

/** Makes the modal answer with `label`; `undefined` models Esc / dismiss. */
function answersWith(label: string | undefined) {
  (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue(label);
}

beforeEach(async () => {
  vi.clearAllMocks();
  const raw: Record<string, unknown> = {};
  mem = {
    get: <T,>(k: string, d: T) => (raw[k] as T) ?? d,
    update: async (k: string, v: unknown) => { raw[k] = v; },
  };
  configureProcessEditor({ context: { globalState: mem } as never });
  await saveDraft(mem, KEY, DRAFT, 1_700_000_000_000);
});

describe('offerDraftRecovery', () => {
  it('returns the draft and consumes it when the user restores', async () => {
    answersWith('Restore');
    const out = await offerDraftRecovery(KEY, 'MyProcess');

    expect(out?.sections.prolog).toBe('sRecovered = 1;');
    expect(hasDraft(mem, KEY)).toBe(false);
  });

  it('returns nothing and consumes the draft when the user discards', async () => {
    answersWith('Discard');
    const out = await offerDraftRecovery(KEY, 'MyProcess');

    expect(out).toBeUndefined();
    expect(hasDraft(mem, KEY)).toBe(false);
  });

  it('KEEPS the draft when the dialog is dismissed', async () => {
    // Esc is "not now", not "throw my work away" — the prompt returns next open.
    answersWith(undefined);
    const out = await offerDraftRecovery(KEY, 'MyProcess');

    expect(out).toBeUndefined();
    expect(hasDraft(mem, KEY)).toBe(true);
  });

  it('asks nothing when no draft is parked', async () => {
    const out = await offerDraftRecovery('http://srv|Untouched', 'Untouched');

    expect(out).toBeUndefined();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('asks as a MODAL so the choice cannot be missed', async () => {
    answersWith('Restore');
    await offerDraftRecovery(KEY, 'MyProcess');

    const opts = (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(opts).toMatchObject({ modal: true });
  });

});
