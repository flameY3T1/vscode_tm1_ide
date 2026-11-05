import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectMode } from '../../../security/core/v12Adapter';
import type { Tm1Config } from '../../../tm1Rest/transport/types';

vi.mock('../../../tm1Rest/client', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../../tm1Rest/client';

const cfg = {} as Tm1Config;

describe('v12Adapter.detectMode', () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it('11.x → v11', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: JSON.stringify({ ProductVersion: '11.8.000' }) });
    expect(await detectMode(cfg)).toBe('v11');
  });
  it('12.x → v12', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: JSON.stringify({ ProductVersion: '12.0.0' }) });
    expect(await detectMode(cfg)).toBe('v12');
  });
  it('error → v11 fallback', async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('boom'));
    expect(await detectMode(cfg)).toBe('v11');
  });
});
