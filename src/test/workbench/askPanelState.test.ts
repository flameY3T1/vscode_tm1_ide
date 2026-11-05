// The bridge between `capture` and the webview: post a question, wait for the
// answer, respect the cap.
//
// What can go wrong here and is therefore pinned down:
//  • The panel is dead — `postMessage` throws. Then the whole collection must
//    NOT fall over; only this one window may stay unread.
//  • No answer arrives. Then the cap has to kick in, not the user.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as vscode from 'vscode';
import { askPanelState, STATE_ASK_TIMEOUT_MS } from '../../commands/workbench/askPanelState';
import { resolveStateReply, _clearAsksForTest, _pendingCountForTest } from '../../commands/workbench/stateAsk';

beforeEach(() => { _clearAsksForTest(); });

/** A panel that records every posted message. */
function fakePanel(onPost?: (m: { type: string; token: string }) => void) {
  const posted: Array<{ type: string; token: string }> = [];
  const panel = {
    webview: {
      postMessage: (m: { type: string; token: string }) => {
        posted.push(m);
        onPost?.(m);
        return Promise.resolve(true);
      },
    },
  } as unknown as vscode.WebviewPanel;
  return { panel, posted };
}

describe('askPanelState', () => {
  it('asks with a token and returns the answer to it', async () => {
    const { panel, posted } = fakePanel(m => {
      // The webview answers immediately — simulated synchronously here.
      resolveStateReply(m.token, { mdx: 'SELECT' });
    });
    await expect(askPanelState(panel)).resolves.toEqual({ mdx: 'SELECT' });
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('requestState');
    expect(posted[0].token).toBeTruthy();
  });

  it('returns undefined when nobody answers', async () => {
    vi.useFakeTimers();
    try {
      const { panel } = fakePanel();
      const p = askPanelState(panel);
      vi.advanceTimersByTime(STATE_ASK_TIMEOUT_MS);
      await expect(p).resolves.toBeUndefined();
    } finally { vi.useRealTimers(); }
  });

  it('does not fall over when the panel is already disposed', async () => {
    // `panel.webview` throws for a disposed panel. A window that is
    // closed while collecting must not topple the collection.
    const dead = {
      get webview(): never { throw new Error('Webview is disposed'); },
    } as unknown as vscode.WebviewPanel;
    await expect(askPanelState(dead)).resolves.toBeUndefined();
    // And nothing stays pending that would trigger the cap later.
    expect(_pendingCountForTest()).toBe(0);
  });

  it('keeps two windows apart', async () => {
    const tokens: string[] = [];
    const a = fakePanel(m => { tokens.push(m.token); });
    const b = fakePanel(m => { tokens.push(m.token); });
    const pa = askPanelState(a.panel);
    const pb = askPanelState(b.panel);
    expect(tokens[0]).not.toBe(tokens[1]);
    resolveStateReply(tokens[1], { who: 'b' });
    resolveStateReply(tokens[0], { who: 'a' });
    await expect(pa).resolves.toEqual({ who: 'a' });
    await expect(pb).resolves.toEqual({ who: 'b' });
  });
});
