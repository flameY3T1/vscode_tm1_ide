import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tm1Rest/client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../tm1Rest/transientProcess', () => ({ executeTransientProcess: vi.fn() }));

import { apiRequest } from '../tm1Rest/client';
import { executeTransientProcess } from '../tm1Rest/transientProcess';
import { setDefaultMember } from '../tm1Rest/defaultMemberApi';

const mockApi = apiRequest as unknown as ReturnType<typeof vi.fn>;
const mockExec = executeTransientProcess as unknown as ReturnType<typeof vi.fn>;
const CFG = { serverUrl: 'http://x', username: 'u', password: 'p', authType: 'basic' } as never;
const LABELS = {
  unknownElement: 'Element "{0}" gibt es in Hierarchie "{1}" nicht.',
  verifyFailed: 'Gesetzt wurde "{0}", TM1 benutzt weiterhin "{1}".',
  resetFailed: 'Zuruecksetzen wirkte nicht — es steht weiterhin "{0}".',
};

beforeEach(() => { mockApi.mockReset(); mockExec.mockReset(); });

/** Existence check of the target element. */
function mockElementExists(ok: boolean): void {
  mockApi.mockResolvedValueOnce(ok
    ? { statusCode: 200, body: JSON.stringify({ Name: 'A' }) }
    : { statusCode: 404, body: '{"error":{"code":"278"}}' });
}

/** Reading back: collective MDX plus one GET .../DefaultMember. */
function mockReadback(explicit: string, effective: string | null): void {
  mockApi.mockResolvedValueOnce({
    statusCode: 201, body: JSON.stringify({ Cells: [{ Ordinal: 0, Value: explicit }] }),
  });
  mockApi.mockResolvedValueOnce(effective === null
    ? { statusCode: 204, body: '' }
    : { statusCode: 200, body: JSON.stringify({ Name: effective }) });
}

describe('setDefaultMember', () => {
  it('aborts on an unknown element WITHOUT writing', async () => {
    mockElementExists(false);

    await expect(setDefaultMember('D', 'D', 'Gibtsnicht', CFG, LABELS))
      .rejects.toThrow(/gibt es in Hierarchie/);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('writes the cell and refresh in ONE transient process', async () => {
    mockElementExists(true);
    mockExec.mockResolvedValueOnce(undefined);
    mockReadback('A', 'A');

    await setDefaultMember('D', 'alt', 'A', CFG, LABELS);

    const spec = mockExec.mock.calls[0][1] as { prolog: string };
    expect(spec.prolog).toContain("CellPutS('A','}HierarchyProperties','D:alt','hierarchy0','defaultMember');");
    expect(spec.prolog).toContain("RefreshMdxHierarchy('D:alt');");
  });

  it('throws when the effective value does not match after writing', async () => {
    mockElementExists(true);
    mockExec.mockResolvedValueOnce(undefined);
    mockReadback('A', 'Top');

    await expect(setDefaultMember('D', 'D', 'A', CFG, LABELS))
      .rejects.toThrow(/benutzt weiterhin "Top"/);
  });

  it('accepts differing upper/lower case when reading back', async () => {
    mockElementExists(true);
    mockExec.mockResolvedValueOnce(undefined);
    mockReadback('a', 'a');

    const state = await setDefaultMember('D', 'D', 'A', CFG, LABELS);

    expect(state.effective).toBe('a');
  });

  it('resets with null: no existence check, empty string in the cell', async () => {
    mockExec.mockResolvedValueOnce(undefined);
    mockReadback('', 'Top');

    const state = await setDefaultMember('D', 'D', null, CFG, LABELS);

    const spec = mockExec.mock.calls[0][1] as { prolog: string };
    expect(spec.prolog).toContain("CellPutS('','}HierarchyProperties','D','hierarchy0','defaultMember');");
    expect(state.explicit).toBe('');
  });

  it('throws when something is still set after the reset', async () => {
    mockExec.mockResolvedValueOnce(undefined);
    mockReadback('A', 'A');

    await expect(setDefaultMember('D', 'D', null, CFG, LABELS))
      .rejects.toThrow(/weiterhin "A"/);
  });

  it('passes an error of the transient process through unchanged', async () => {
    mockElementExists(true);
    mockExec.mockRejectedValueOnce(new Error('boom'));

    await expect(setDefaultMember('D', 'D', 'A', CFG, LABELS)).rejects.toThrow('boom');
  });
});
