import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

vi.mock('../../webviews/feederAuditWebview', () => ({
  FeederAuditPanel: {
    open: vi.fn(),
    show: vi.fn(),
    zelleZeigen: vi.fn(),
  },
}));

vi.mock('../../commands/processEditor/previewExec', () => ({
  runInlinePreview: vi.fn(),
}));

import { runOverfeedingScan } from '../../commands/cubeViewer/feederAudit';
import { FeederAuditPanel } from '../../webviews/feederAuditWebview';
import { runInlinePreview } from '../../commands/processEditor/previewExec';

const CFG = {
  serverUrl: 'http://tm1.example/api/v1', username: 'admin', password: '', authType: 'basic', version: 'v11',
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  (vscode.window as any).showWarningMessage = vi.fn().mockResolvedValue(undefined);
});

describe('Overfeeding notice', () => {
  it('opens neither a window nor a scan when the undocumented call is not confirmed', async () => {
    await runOverfeedingScan('Sales', ['Region', 'Measure'], CFG, 'server-1');

    expect(vscode.window.showWarningMessage).toHaveBeenCalledOnce();
    expect((vscode.window.showWarningMessage as any).mock.calls[0][1]).toMatchObject({ modal: true });
    expect(FeederAuditPanel.open).not.toHaveBeenCalled();
    expect(runInlinePreview).not.toHaveBeenCalled();
  });
});
