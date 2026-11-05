import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { isV12Active, isV12FromServer } from '../utils/v12Mode';
import type { Tm1Config } from '../tm1Rest/transport/types';

/**
 * The switch was the only way in, so working against a v12 database produced no v12 warnings
 * until someone remembered to click it. The server is the stronger signal: connected to v12,
 * the restrictions are real. The switch stays for the other direction — reviewing code bound
 * for v12 from an 11.x connection, or with no connection at all.
 */
function setSetting(v12Mode: boolean): void {
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
    get: (key: string, dflt?: unknown) => (key === 'v12Mode' ? v12Mode : dflt),
  } as unknown as vscode.WorkspaceConfiguration);
}

const v11 = { serverUrl: 'http://x', username: 'u', password: 'p', authType: 'basic' } as unknown as Tm1Config;
const v12 = { ...v11, version: 'v12' } as unknown as Tm1Config;

describe('isV12Active', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('follows the setting when there is no server context', () => {
    setSetting(true);
    expect(isV12Active(undefined)).toBe(true);
    setSetting(false);
    expect(isV12Active(undefined)).toBe(false);
  });

  it('is on for a v12 server even with the switch off', () => {
    setSetting(false);
    expect(isV12Active(v12)).toBe(true);
  });

  it('stays on for an 11.x server when the switch is on', () => {
    setSetting(true);
    expect(isV12Active(v11)).toBe(true);
  });

  it('is off for an 11.x server with the switch off', () => {
    setSetting(false);
    expect(isV12Active(v11)).toBe(false);
  });

  it('reports server-driven only when the switch did not ask for it', () => {
    setSetting(false);
    expect(isV12FromServer(v12)).toBe(true);
    // Switch on: the status bar keeps its "click to disable" wording.
    setSetting(true);
    expect(isV12FromServer(v12)).toBe(false);
  });
});
