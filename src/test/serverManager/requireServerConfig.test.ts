// Two situations, two sentences — until 2026-08-29 the distinction existed only in
// `confirmAndRun` and was missing from the other twelve call sites.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';

vi.mock('../../serverState/state', () => ({
  getServerConfig: vi.fn(),
}));

import { getServerConfig } from '../../serverState/state';
import {
  requireServerConfig, requireServerConfigOrThrow, serverConfigError,
} from '../../serverState/requireServerConfig';

const CFG = { serverUrl: 'https://h:8010' } as never;

beforeEach(() => {
  vi.mocked(getServerConfig).mockReset();
  vi.mocked(vscode.window.showErrorMessage).mockClear?.();
});

describe('requireServerConfig', () => {
  it('returns the config and reports nothing', () => {
    vi.mocked(getServerConfig).mockReturnValue(CFG);
    expect(requireServerConfig('srv-1')).toBe(CFG);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('without serverId: wiring error, NOT "not connected"', () => {
    // A tree node without `meta.serverId` is a bug on our side —
    // the server can be perfectly well connected. The old sentence made the
    // user doubt their connection.
    expect(requireServerConfig(undefined)).toBeUndefined();
    expect(getServerConfig).not.toHaveBeenCalled();
    const gezeigt = vi.mocked(vscode.window.showErrorMessage).mock.calls[0][0] as string;
    expect(gezeigt).toContain('no server reference');
    expect(gezeigt).not.toContain('No server connected');
  });

  it('with serverId but without a connection: "not connected"', () => {
    vi.mocked(getServerConfig).mockReturnValue(undefined);
    expect(requireServerConfig('srv-1')).toBeUndefined();
    expect(vi.mocked(vscode.window.showErrorMessage).mock.calls[0][0]).toContain('No server connected');
  });
});

describe('requireServerConfigOrThrow', () => {
  it('throws with the same sentence instead of reporting', () => {
    vi.mocked(getServerConfig).mockReturnValue(undefined);
    expect(() => requireServerConfigOrThrow('srv-1')).toThrow(/No server connected/);
    expect(() => requireServerConfigOrThrow(undefined)).toThrow(/no server reference/);
    // The throwing path does NOT report by itself — otherwise the user would see the message
    // twice, once from here and once from the caller's `catch`.
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('returns the config on success', () => {
    vi.mocked(getServerConfig).mockReturnValue(CFG);
    expect(requireServerConfigOrThrow('srv-1')).toBe(CFG);
  });
});

describe('serverConfigError', () => {
  it('hands out the sentence without showing it', () => {
    expect(serverConfigError('srv-1')).toContain('No server connected');
    expect(serverConfigError(undefined)).toContain('no server reference');
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });
});
