import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerWindow, clearWindowsForTest } from '../../workbench/windowRegistry';
import { collectCandidates, candidatesToSaved } from '../../commands/workbench/collectWindows';
import { resolveStateReply } from '../../commands/workbench/stateAsk';
import { STATE_ASK_TIMEOUT_MS } from '../../commands/workbench/askPanelState';

const SRV = 'https://h:12354';

describe('collectCandidates', () => {
  beforeEach(() => clearWindowsForTest());

  it('keeps only the windows of the asked-for server', async () => {
    registerWindow({ kind: 'tm1CubeViewer', rawKey: `${SRV}:Reporting`, panel: {}, serverId: SRV, target: 'Reporting' });
    registerWindow({ kind: 'tm1CubeViewer', rawKey: 'https://other:Absatz', panel: {}, serverId: 'https://other', target: 'Absatz' });
    expect((await collectCandidates(SRV)).map(c => c.label)).toEqual(['Reporting']);
  });

  it('drops transient windows', async () => {
    registerWindow({ kind: 'tm1DimensionBrowserSelection', rawKey: `${SRV}::sel#1`, panel: {}, serverId: SRV });
    expect(await collectCandidates(SRV)).toEqual([]);
  });

  it('finds a window registered under the server URL when asked with the profile id + that URL', async () => {
    // Reproduces the bug this test was added to catch: `Workbench.serverId`
    // (and the id `tm1.workbench.save` looks the window up with) is the
    // PROFILE id, but every manager registers its panels under the server
    // URL — a plain `sid !== serverId` comparison never matched anything.
    const PROFILE_ID = '1699999999999';
    registerWindow({ kind: 'tm1CubeViewer', rawKey: `${SRV}:Reporting`, panel: {}, serverId: SRV, target: 'Reporting' });
    expect(await collectCandidates(PROFILE_ID)).toEqual([]);
    expect((await collectCandidates(PROFILE_ID, SRV)).map(c => c.label)).toEqual(['Reporting']);
  });

  it('derives serverId from the raw key when the registrant did not know it', async () => {
    registerWindow({ kind: 'tm1SomethingUnlisted', rawKey: `${SRV}::Reporting`, panel: {} });
    const out = await collectCandidates(SRV);
    expect(out).toHaveLength(1);
    expect(out[0].group).toBe('Other');
  });

  it('puts a kind without a state contract into Other and gives it no preview', async () => {
    registerWindow({ kind: 'tm1.messageLog', rawKey: SRV, panel: {}, serverId: SRV });
    expect((await collectCandidates(SRV))[0].description).toBeUndefined();
  });
});

describe('candidatesToSaved', () => {
  it('keeps only the chosen ones, in the listed order', () => {
    const all = [
      { id: 'a', kind: 'k', group: 'g', label: 'A', saved: { kind: 'k', target: 'A' }, checked: true, open: true },
      { id: 'b', kind: 'k', group: 'g', label: 'B', saved: { kind: 'k', target: 'B' }, checked: true, open: true },
      { id: 'c', kind: 'k', group: 'g', label: 'C', saved: { kind: 'k', target: 'C' }, checked: true, open: true },
    ];
    expect(candidatesToSaved(all, ['c', 'a']).map(w => w.target)).toEqual(['A', 'C']);
  });

  it('ignores an id that is not in the list', () => {
    const all = [{ id: 'a', kind: 'k', group: 'g', label: 'A', saved: { kind: 'k', target: 'A' }, checked: true, open: true }];
    expect(candidatesToSaved(all, ['ghost'])).toEqual([]);
  });
});

// ── The cap and its note ─────────────────────────────────────────────────
// A window whose state could not be read is still
// saved — but this has to be shown BEFOREHAND. Otherwise you save in good
// faith and only notice the loss when restoring.
describe('collectCandidates: unread state', () => {
  beforeEach(() => clearWindowsForTest());

  // Both tests here run over the CAP (`STATE_ASK_TIMEOUT_MS`, 500 ms)
  // and use fake timers for it, like the sister file
  // `askPanelState.test.ts`. Previously this used the real wall clock — 500 ms
  // of waiting per test, which made this file the third slowest of the
  // suite.
  it('notes on the window when the webview did not answer', async () => {
    // A panel whose `postMessage` goes nowhere: `askPanelState` runs
    // into the cap, `capture` returns `stateRead: false`.
    const stumm = { webview: { postMessage: () => Promise.resolve(true) } };
    registerWindow({
      kind: 'tm1DimensionBrowser', rawKey: `${SRV}::Kunde`, panel: stumm,
      serverId: SRV, target: 'Kunde',
    });
    vi.useFakeTimers();
    try {
      const lauf = collectCandidates(SRV);
      await vi.advanceTimersByTimeAsync(STATE_ASK_TIMEOUT_MS);
      const out = await lauf;
      expect(out).toHaveLength(1);
      expect(out[0].description).toBeTruthy();
      expect((out[0].saved.state as { stateRead?: boolean }).stateRead).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('collects concurrently, not one after the other', async () => {
    // Five silent windows: one after the other that would be five caps, concurrently
    // one.
    //
    // This is proven via the CALL ORDER, not via the clock: all
    // five questions must be OUT before the first cap even
    // expires. A wall-clock measurement ("under 1500 ms") said the same only
    // indirectly, cost half a second of real runtime and could
    // occasionally have been off on a busy machine.
    const gefragt: string[] = [];
    for (let i = 0; i < 5; i++) {
      registerWindow({
        kind: 'tm1DimensionBrowser', rawKey: `${SRV}::D${i}`,
        panel: { webview: { postMessage: () => { gefragt.push(`D${i}`); return Promise.resolve(true); } } },
        serverId: SRV, target: `D${i}`,
      });
    }

    vi.useFakeTimers();
    try {
      const lauf = collectCandidates(SRV);
      // No time has passed yet — and still all five questions are
      // already out. One after the other, exactly ONE would be visible here.
      expect(gefragt).toEqual(['D0', 'D1', 'D2', 'D3', 'D4']);

      // ONE cap is enough for all five. One after the other would need five.
      await vi.advanceTimersByTimeAsync(STATE_ASK_TIMEOUT_MS);
      const out = await lauf;
      expect(out).toHaveLength(5);
      expect(out.every(c => (c.saved.state as { stateRead?: boolean }).stateRead === false)).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('takes the state when the webview answers', async () => {
    const panel = {
      webview: {
        postMessage: (m: { token: string }) => {
          // The webview answers — here without the detour through the router.
          setTimeout(() => resolveStateReply(m.token, { hierarchy: 'Regionen' }), 0);
          return Promise.resolve(true);
        },
      },
    };
    registerWindow({
      kind: 'tm1DimensionBrowser', rawKey: `${SRV}::Kunde`, panel,
      serverId: SRV, target: 'Kunde',
    });
    const out = await collectCandidates(SRV);
    const st = out[0].saved.state as { stateRead?: boolean; hierarchy?: string };
    expect(st.stateRead).toBe(true);
    expect(st.hierarchy).toBe('Regionen');
  });
});

// ── Editing: the union of what is saved and what is open ──────────────────
// A saved workbench contains windows that are not open right now.
// They must not silently disappear when editing — and a window that is
// BOTH must not appear twice.
describe('collectCandidates: edit mode', () => {
  beforeEach(() => clearWindowsForTest());

  const panel = () => ({ webview: { postMessage: () => Promise.resolve(true) } });

  it('appends saved but closed windows — checked', async () => {
    const out = await collectCandidates(SRV, undefined, [
      { kind: 'tm1ProcessEditor', target: 'Zu' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('Zu');
    expect(out[0].checked).toBe(true);
    expect(out[0].open).toBe(false);
  });

  it('treats an open window that is not in yet as unchecked', async () => {
    registerWindow({ kind: 'tm1ProcessEditor', rawKey: `${SRV}::Neu`, panel: panel(), serverId: SRV, target: 'Neu' });
    const out = await collectCandidates(SRV, undefined, []);
    expect(out).toHaveLength(1);
    expect(out[0].checked).toBe(false);
    expect(out[0].open).toBe(true);
  });

  it('merges a window that is saved AND open', async () => {
    registerWindow({ kind: 'tm1ProcessEditor', rawKey: `${SRV}::Beides`, panel: panel(), serverId: SRV, target: 'Beides' });
    const out = await collectCandidates(SRV, undefined, [{ kind: 'tm1ProcessEditor', target: 'Beides' }]);
    expect(out).toHaveLength(1);
    expect(out[0].checked).toBe(true);
    // Open means: its state is asked for afresh, the old one is not kept.
    expect(out[0].open).toBe(true);
  });

  it('keeps two Cube Viewers on the same cube apart', async () => {
    // Without the view name in the identity, these would wrongly be two
    // entries for ONE window — or worse, one for two.
    const out = await collectCandidates(SRV, undefined, [
      { kind: 'tm1CubeViewer', target: 'C', state: { viewName: 'A' } },
      { kind: 'tm1CubeViewer', target: 'C', state: {} },
    ]);
    expect(out).toHaveLength(2);
    expect(out.every(c => c.checked)).toBe(true);
  });

  it('puts saved windows first, new ones after them', async () => {
    registerWindow({ kind: 'tm1ProcessEditor', rawKey: `${SRV}::Neu`, panel: panel(), serverId: SRV, target: 'Neu' });
    const out = await collectCandidates(SRV, undefined, [{ kind: 'tm1ProcessEditor', target: 'Alt' }]);
    expect(out.map(c => c.label)).toEqual(['Alt', 'Neu']);
  });

  it('behaves as before without edit mode: everything checked', async () => {
    registerWindow({ kind: 'tm1ProcessEditor', rawKey: `${SRV}::X`, panel: panel(), serverId: SRV, target: 'X' });
    const out = await collectCandidates(SRV);
    expect(out[0].checked).toBe(true);
    expect(out[0].open).toBe(true);
  });
});
