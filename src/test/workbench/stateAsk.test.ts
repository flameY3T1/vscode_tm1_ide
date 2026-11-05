// The state query is a round trip through the message channel.
// Two things can go wrong along the way, and both silently:
//
//  • An answer arrives after the asker has given up — or to an
//    EARLIER question, because the picker window was opened twice. Without a
//    token, the old answer answers the new question.
//  • No answer arrives at all (panel hidden, script dead). Without a cap
//    the picker window hangs.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  nextAskToken, awaitStateReply, resolveStateReply, _pendingCountForTest, _clearAsksForTest,
} from '../../commands/workbench/stateAsk';

beforeEach(() => { _clearAsksForTest(); });

describe('stateAsk', () => {
  it('gives every question its own token', () => {
    expect(nextAskToken()).not.toBe(nextAskToken());
  });

  it('resolves with the state when the answer matches', async () => {
    const token = nextAskToken();
    const p = awaitStateReply(token, 50);
    expect(resolveStateReply(token, { mdx: 'SELECT' })).toBe(true);
    await expect(p).resolves.toEqual({ mdx: 'SELECT' });
  });

  it('discards an answer with a foreign token', async () => {
    const mine = nextAskToken();
    const foreign = nextAskToken();
    const p = awaitStateReply(mine, 50);
    // The late answer to the PREVIOUS question must not answer
    // this one.
    expect(resolveStateReply(foreign, { mdx: 'ALT' })).toBe(false);
    expect(resolveStateReply(mine, { mdx: 'NEU' })).toBe(true);
    await expect(p).resolves.toEqual({ mdx: 'NEU' });
  });

  it('returns undefined when the cap expires', async () => {
    vi.useFakeTimers();
    try {
      const p = awaitStateReply(nextAskToken(), 500);
      vi.advanceTimersByTime(500);
      await expect(p).resolves.toBeUndefined();
    } finally { vi.useRealTimers(); }
  });

  it('leaves nothing behind after the cap', async () => {
    vi.useFakeTimers();
    try {
      const token = nextAskToken();
      const p = awaitStateReply(token, 500);
      vi.advanceTimersByTime(500);
      await p;
      expect(_pendingCountForTest()).toBe(0);
      // An answer that trickles in NOW finds nobody anymore — and
      // does not throw either.
      expect(resolveStateReply(token, { mdx: 'zu spaet' })).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('leaves nothing behind after an answer', async () => {
    const token = nextAskToken();
    const p = awaitStateReply(token, 50);
    resolveStateReply(token, {});
    await p;
    expect(_pendingCountForTest()).toBe(0);
    // The cap must not strike afterwards and resolve a second time.
    expect(resolveStateReply(token, {})).toBe(false);
  });

  it('keeps several concurrent questions apart', async () => {
    const a = nextAskToken();
    const b = nextAskToken();
    const pa = awaitStateReply(a, 50);
    const pb = awaitStateReply(b, 50);
    expect(_pendingCountForTest()).toBe(2);
    resolveStateReply(b, { who: 'b' });
    resolveStateReply(a, { who: 'a' });
    await expect(pa).resolves.toEqual({ who: 'a' });
    await expect(pb).resolves.toEqual({ who: 'b' });
  });
});
