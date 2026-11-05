import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';

// Before `configureProcessEditor` has ever run — e.g. a command firing during
// activation — there is no Memento. Recovery must then be a silent no-op rather
// than throwing on `undefined.globalState`.
vi.mock('../utils/extensionContext', () => ({ getExtensionContext: () => undefined }));

import { offerDraftRecovery } from '../commands/processEditor/draftRecovery';

describe('offerDraftRecovery without an extension context', () => {
  it('returns nothing and asks nothing', async () => {
    await expect(offerDraftRecovery('http://srv|Proc', 'Proc')).resolves.toBeUndefined();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });
});
