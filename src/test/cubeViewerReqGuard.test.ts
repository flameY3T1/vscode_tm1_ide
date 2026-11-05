import { describe, it, expect } from 'vitest';
import { nextReqId, isCurrentResponse } from '../webviewClient/cubeViewerMonaco/reqGuard';

describe('reqGuard', () => {
  it('nextReqId increments and returns the new value', () => {
    const s = { _reqSent: 0 };
    expect(nextReqId(s)).toBe(1);
    expect(nextReqId(s)).toBe(2);
    expect(s._reqSent).toBe(2);
  });

  it('accepts a response whose reqId matches the latest sent', () => {
    expect(isCurrentResponse(5, 5)).toBe(true);
  });

  it('drops a stale response (reqId older than latest sent)', () => {
    expect(isCurrentResponse(4, 5)).toBe(false);
  });

  // Review 2026-11-02, C4/C8: an unversioned reply was accepted and could land
  // after, and over, a newer request.
  it('drops an unversioned (undefined) response — it belongs to no request', () => {
    expect(isCurrentResponse(undefined, 5)).toBe(false);
  });
});
