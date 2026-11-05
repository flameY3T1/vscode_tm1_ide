import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../tm1Rest/client', () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from '../../tm1Rest/client';
import { traceRule, traceFeeders, checkFeeders, TraceHttpError } from '../../tm1Rest/cellTraceApi';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const cfg = { serverUrl: 'https://s', authType: 'Basic' } as unknown as Tm1Config;

beforeEach(() => vi.mocked(apiRequest).mockReset());

describe('traceRule', () => {
  it('POSTs a ONE-level TraceCellCalculation with Tuple bind, timeout 0, and maps the node', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ Type: 'Rule', Status: 'Data', Value: 1, Statements: ['r'], Tuple: [{ Name: 'PAQ' }], Components: [{ Type: 'Simple', Value: 1 }] }),
    });
    const node = await traceRule('C', ['D'], ['E'], cfg);
    expect(node.type).toBe('Rule');
    expect(node.components).toHaveLength(1);
    const [method, path, body, timeout, passedCfg] = vi.mocked(apiRequest).mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toContain("Cubes('C')/tm1.TraceCellCalculation?");
    // Path form only — the options form `Components($select=…)` is a 400 Code 278.
    expect(path).toContain('$select=Type,Value,Status,Statements,Components/Type,');
    expect(path).toContain('Components/Tuple($select=Name),Components/Cube($select=Name)');
    expect(path).not.toContain('Components(');
    expect(JSON.parse(body as string)).toEqual({ 'Tuple@odata.bind': ["Dimensions('D')/Hierarchies('D')/Elements('E')"] });
    expect(timeout).toBe(0);
    expect(passedCfg).toBe(cfg);
  });
  it('throws TraceHttpError on non-2xx with the server message', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 400, body: JSON.stringify({ error: { message: 'bad' } }) });
    await expect(traceRule('C', ['D'], ['E'], cfg)).rejects.toThrow(TraceHttpError);
    await expect(traceRule('C', ['D'], ['E'], cfg)).rejects.toThrow(/bad/);
  });
  it('extracts the object-shape { value } error.message (not [object Object])', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 400, body: JSON.stringify({ error: { message: { value: 'bad-obj' } } }) });
    await expect(traceRule('C', ['D'], ['E'], cfg)).rejects.toThrow(/bad-obj/);
  });
});

describe('traceFeeders', () => {
  it('POSTs TraceFeeders with FedCells/Tuple expand and maps result', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: JSON.stringify({ Statements: ['f'], FedCells: [{ Tuple: [{ Name: 'A' }], Fed: true }] }) });
    const r = await traceFeeders('C', ['D'], ['E'], cfg);
    expect(r.fedCells[0]).toEqual({ tuple: ['A'], fed: true, value: null });
    const [, path] = vi.mocked(apiRequest).mock.calls[0];
    expect(path).toContain("Cubes('C')/tm1.TraceFeeders?$expand=FedCells/Tuple($select=Name)");
  });
});

describe('checkFeeders', () => {
  it('POSTs CheckFeeders and maps the value[] collection', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: JSON.stringify({ value: [{ Tuple: [{ Name: 'A' }], Fed: false }] }) });
    const r = await checkFeeders('C', ['D'], ['E'], cfg);
    expect(r).toEqual([{ tuple: ['A'], fed: false, value: null }]);
    const [, path] = vi.mocked(apiRequest).mock.calls[0];
    expect(path).toContain("Cubes('C')/tm1.CheckFeeders?$expand=Tuple($select=Name)");
  });
});
