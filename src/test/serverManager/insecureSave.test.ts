import { describe, it, expect, beforeEach, vi } from 'vitest';

// form.ts pulls in the connection module, which imports the REST transport —
// mock it away, the gate under test is pure/UI-only.
vi.mock('../../tm1Client', () => ({
  apiRequest: vi.fn(),
  setConfigOverride: vi.fn(),
  closeSession: vi.fn().mockResolvedValue(undefined),
}));
// tm1Rest/ modules import tm1Rest/client directly; same doubles there (docs/architecture/import-rules.md).
vi.mock('../../tm1Rest/client', async () => await import('../../tm1Client'));
vi.mock('../../tm1Rest/transport/session', () => ({
  _clearAuthFailed: vi.fn(),
}));

import * as vscode from 'vscode';
import {
  classifyInsecureSave,
  insecureSaveMessage,
  confirmInsecureSave,
} from '../../commands/serverManager/form';

const showWarning = vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>;

describe('classifyInsecureSave', () => {
  it('is "none" for https with certificate verification on', () => {
    expect(classifyInsecureSave({ serverUrl: 'https://host:8010', rejectUnauthorized: true })).toBe('none');
  });

  it('is "http" for plain HTTP with verification on', () => {
    expect(classifyInsecureSave({ serverUrl: 'http://host:8010', rejectUnauthorized: true })).toBe('http');
  });

  it('is "tls" for https with verification off', () => {
    expect(classifyInsecureSave({ serverUrl: 'https://host:8010', rejectUnauthorized: false })).toBe('tls');
  });

  it('is "both" when plain HTTP and verification off apply together', () => {
    expect(classifyInsecureSave({ serverUrl: 'http://host:8010', rejectUnauthorized: false })).toBe('both');
  });

  it('classifies the NORMALIZED url — a schemeless host becomes https, not plain HTTP', () => {
    expect(classifyInsecureSave({ serverUrl: 'host:8010', rejectUnauthorized: true })).toBe('none');
    expect(classifyInsecureSave({ serverUrl: '  http://host:8010/  ', rejectUnauthorized: true })).toBe('http');
  });
});

describe('insecureSaveMessage', () => {
  it('returns nothing for "none"', () => {
    expect(insecureSaveMessage('none')).toBeUndefined();
  });

  it('returns one distinct message per kind', () => {
    const http = insecureSaveMessage('http');
    const tls = insecureSaveMessage('tls');
    const both = insecureSaveMessage('both');
    expect(http).toMatch(/Plain HTTP/);
    expect(tls).toMatch(/[Cc]ertificate verification is disabled/);
    // Merged case: ONE modal naming both problems, not two stacked warnings.
    expect(both).toMatch(/Plain HTTP/);
    expect(both).toMatch(/certificate verification disabled/);
    expect(new Set([http, tls, both]).size).toBe(3);
  });
});

describe('confirmInsecureSave', () => {
  beforeEach(() => {
    showWarning.mockReset();
    showWarning.mockResolvedValue(undefined);
  });

  it('does not prompt at all for a secure profile', async () => {
    await expect(confirmInsecureSave({ serverUrl: 'https://host:8010', rejectUnauthorized: true })).resolves.toBe(true);
    expect(showWarning).not.toHaveBeenCalled();
  });

  it('prompts modally and proceeds when "Save anyway" is picked (tls downgrade)', async () => {
    showWarning.mockResolvedValue('Save anyway');
    await expect(confirmInsecureSave({ serverUrl: 'https://host:8010', rejectUnauthorized: false })).resolves.toBe(true);
    expect(showWarning).toHaveBeenCalledTimes(1);
    const [message, opts, label] = showWarning.mock.calls[0];
    expect(message).toMatch(/certificate verification is disabled/i);
    expect(opts).toEqual({ modal: true });
    expect(label).toBe('Save anyway');
  });

  it('aborts when the modal is dismissed (tls downgrade)', async () => {
    showWarning.mockResolvedValue(undefined);
    await expect(confirmInsecureSave({ serverUrl: 'https://host:8010', rejectUnauthorized: false })).resolves.toBe(false);
  });

  it('gates plain HTTP exactly the same way', async () => {
    showWarning.mockResolvedValue(undefined);
    await expect(confirmInsecureSave({ serverUrl: 'http://host:8010', rejectUnauthorized: true })).resolves.toBe(false);
    expect(showWarning).toHaveBeenCalledTimes(1);
    expect(showWarning.mock.calls[0][0]).toMatch(/Plain HTTP/);
  });

  it('raises only ONE merged modal when both downgrades apply', async () => {
    showWarning.mockResolvedValue('Save anyway');
    await expect(confirmInsecureSave({ serverUrl: 'http://host:8010', rejectUnauthorized: false })).resolves.toBe(true);
    expect(showWarning).toHaveBeenCalledTimes(1);
    expect(showWarning.mock.calls[0][0]).toMatch(/Plain HTTP and certificate verification disabled/);
  });
});
