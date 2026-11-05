import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleSpreadMessage } from '../../commands/cubeViewer/spread';
import * as api from '../../cubeViewer/cubeSpreadApi';

afterEach(() => vi.restoreAllMocks());

describe('handleSpreadMessage', () => {
  it('calls spreadCell with all args and returns ok=true on 2xx', async () => {
    const spy = vi.spyOn(api, 'spreadCell').mockResolvedValue({ statusCode: 204, body: '', headers: {} } as any);
    const res = await handleSpreadMessage({
      cubeName: 'Sales', dimensions: ['M'], coordinates: ['Q1'],
      method: 'repeat', value: 100, ri: 0, ci: 0, config: undefined as never,
    });
    expect(spy).toHaveBeenCalledWith('Sales', 'repeat', ['M'], ['Q1'], 100, undefined);
    expect(res.ok).toBe(true);
  });

  it('classifies DataSpreadFailed payload as spread-failed', async () => {
    vi.spyOn(api, 'spreadCell').mockResolvedValue({
      statusCode: 400,
      body: JSON.stringify({ error: { message: 'DataSpreadFailed' } }),
    } as any);
    const res = await handleSpreadMessage({
      cubeName: 'C', dimensions: ['D'], coordinates: ['x'],
      method: 'proportional', value: 10, ri: 1, ci: 2, config: undefined as never,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('spread-failed');
  });

  it('classifies 403 as security', async () => {
    vi.spyOn(api, 'spreadCell').mockResolvedValue({ statusCode: 403, body: '{"error":{"message":"no"}}' } as any);
    const res = await handleSpreadMessage({
      cubeName: 'C', dimensions: ['D'], coordinates: ['x'],
      method: 'clear', value: 0, ri: 0, ci: 0, config: undefined as never,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('security');
  });

  it('classifies 404 as not-found', async () => {
    vi.spyOn(api, 'spreadCell').mockResolvedValue({ statusCode: 404, body: '' } as any);
    const res = await handleSpreadMessage({
      cubeName: 'C', dimensions: ['D'], coordinates: ['x'],
      method: 'repeat', value: 1, ri: 0, ci: 0, config: undefined as never,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('not-found');
  });

  it('catches thrown errors as network', async () => {
    vi.spyOn(api, 'spreadCell').mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    const res = await handleSpreadMessage({
      cubeName: 'C', dimensions: ['D'], coordinates: ['x'],
      method: 'repeat', value: 1, ri: 0, ci: 0, config: { serverUrl: 'https://tm1host:8010' } as never,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) { expect(res.error.kind).toBe('network'); expect(res.error.message).toContain('refused'); }
  });
});
