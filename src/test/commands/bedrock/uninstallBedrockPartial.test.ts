import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

/**
 * Regression: a failed delete was swallowed and Bedrock still flagged as
 * uninstalled — "Bedrock uninstalled (0/180)" with every process still there.
 */

const deleteProcess = vi.fn();
const setBedrockInstalled = vi.fn();
vi.mock('../../../serverState/state', () => ({ getServerConfig: () => ({ serverUrl: 'http://x' }) }));
vi.mock('../../../providers/fetchNames', () => ({ fetchNamesOrThrow: async () => ['}bedrock.a', '}bedrock.b', 'Other'] }));
vi.mock('../../../tm1Rest/processApi', () => ({ deleteProcess: (...a: unknown[]) => deleteProcess(...a) }));
vi.mock('../../../bedrock/bedrockStateCache', () => ({ setBedrockInstalled: (...a: unknown[]) => setBedrockInstalled(...a) }));

import { uninstallBedrock } from '../../../commands/bedrock/uninstallBedrock';

beforeEach(() => {
  deleteProcess.mockReset();
  setBedrockInstalled.mockReset();
  (vscode.window.showWarningMessage as any).mockReset();
  (vscode.window.showInformationMessage as any).mockReset();
  // The modal confirmation answers "Delete all".
  (vscode.window.showWarningMessage as any).mockImplementationOnce(async (_m: string, _o: unknown, label: string) => label);
});

describe('uninstallBedrock', () => {
  it('keeps the installed flag and names the reason when a delete fails', async () => {
    deleteProcess.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('in use by chore'));

    await uninstallBedrock({ meta: { serverId: 's1' } });

    expect(setBedrockInstalled).not.toHaveBeenCalled();
    const warning = (vscode.window.showWarningMessage as any).mock.calls.at(-1)[0] as string;
    expect(warning).toContain('1/2');
    expect(warning).toContain('}bedrock.b: in use by chore');
  });

  it('flags Bedrock as uninstalled when every delete succeeds', async () => {
    deleteProcess.mockResolvedValue(undefined);

    await uninstallBedrock({ meta: { serverId: 's1' } });

    expect(setBedrockInstalled).toHaveBeenCalledWith('s1', false);
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });
});
