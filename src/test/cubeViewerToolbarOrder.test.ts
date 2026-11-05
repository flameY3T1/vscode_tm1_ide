// The action bar of the cube viewer has a reading order that comes from clicking:
// first WHAT is shown (the view), then WHAT YOU DO WITH IT (reload,
// save). The button stood before the selection, i.e. to the left of the object
// it refers to.
//
// The test pins down the order, because it stands in no identifier and
// can silently slip back on the next rework of the bar.
//
// WORDING, second round (instruction flameY3T1, 2026-08-26): the button was briefly called
// "Reload" — like the same action in the Dimension Browser. Since the bar carries TWO
// buttons, that no longer works: "Reload view" fetches the
// saved view fresh from the server and throws away the working state, the
// other one only fetches the numbers and keeps it. Two neighbours that are both
// called "reload" cannot be told apart — the distinction in
// place beats the consistency with the Dimension Browser.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import * as vscode from 'vscode';
import { getCubeViewerBody } from '../commands/cubeViewer/htmlBody';
import { buildCubeViewerL10n } from '../commands/cubeViewer/cubeViewerL10n';

function body(): string {
  const webview = { asWebviewUri: (u: unknown) => String(u) } as unknown as vscode.Webview;
  // The mock's `Uri.joinPath` reads `fsPath` — a bare `{ path }` is not enough.
  const uri = vscode.Uri.file('/ext');
  return getCubeViewerBody(webview, uri, buildCubeViewerL10n());
}

describe('Cube Viewer action bar', () => {
  it('calls the number refresh "Refresh", not "Reload"', () => {
    const t = buildCubeViewerL10n();
    expect(t.reload).toBe('Refresh');
    // The old identifier is gone, not merely unused: otherwise the
    // map has a second word ready for the same action.
    expect((t as Record<string, unknown>).refresh).toBeUndefined();
  });

  it('calls the second button "Reload view" and says in the title what gets lost', () => {
    const t = buildCubeViewerL10n();
    expect(t.reloadView).toBe('Reload view');
    // The button discards filters and context selection. If that is not in the title,
    // you click it once and your work is gone, without having been warned.
    expect(t.reloadViewTitle).toContain('discarded');
  });

  it('puts "Reload view" between the selection and the number refresh', () => {
    const html = body();
    const select = html.indexOf('id="view-select"');
    const reloadView = html.indexOf('id="btn-reload-view"');
    const refresh = html.indexOf('id="btn-refresh"');
    expect(reloadView).toBeGreaterThan(select);
    expect(reloadView).toBeLessThan(refresh);
  });

  it('starts disabled — without a chosen view the button has no target', () => {
    expect(body()).toMatch(/id="btn-reload-view"[^>]*disabled/);
  });

  it('puts the view selection before the reload button', () => {
    const html = body();
    const select = html.indexOf('id="view-select"');
    const reload = html.indexOf('id="btn-refresh"');
    expect(select).toBeGreaterThan(-1);
    expect(reload).toBeGreaterThan(-1);
    expect(select).toBeLessThan(reload);
  });

  it('keeps the label "View:" directly in front of the selection', () => {
    const html = body();
    const label = html.indexOf('for="view-select"');
    const select = html.indexOf('id="view-select"');
    expect(label).toBeGreaterThan(-1);
    expect(label).toBeLessThan(select);
  });

  it('keeps the id and icon of the button, so that operation notices nothing', () => {
    const html = body();
    expect(html).toContain('id="btn-refresh"');
    expect(html).toContain('refresh.svg');
  });

  it('does not touch auto-reload — it is still called Auto-Refresh', () => {
    const t = buildCubeViewerL10n();
    expect(t.autoRefresh).toBe('Auto-refresh');
  });
});

// ── Wiring: source scan instead of DOM ───────────────────────────────────────
//
// `src/webviewClient/cubeViewerMonaco/**` runs in the webview and has no
// DOM environment here (vitest runs without jsdom, the directory is also excluded from
// coverage). The button can therefore only be secured via the source —
// little, but better than nothing: otherwise it drops away silently, because its failure
// looks like "no click" and like nothing else.
describe('wiring of "Reload view"', () => {
  const picker = readFileSync('src/webviewClient/cubeViewerMonaco/viewPicker.ts', 'utf8');
  const dom = readFileSync('src/webviewClient/cubeViewerMonaco/dom.ts', 'utf8');

  it('sends the same command as a change in the dropdown', () => {
    expect(picker).toContain('btnReloadView.addEventListener');
    // `switchView` is the path that clears the user filters on the host side and
    // re-reads the view on the server side. A message type of its own would not do that.
    expect(picker).toMatch(/btnReloadView\.addEventListener[\s\S]{0,600}type: 'switchView'/);
  });

  it('disables it as long as no view is chosen', () => {
    expect(picker).toContain("r.viewSelect.value === '__none__'");
    // Second lock: during a load it is dead as well.
    expect(dom).toContain('r.btnReloadView.disabled = on');
  });
});

// The mock has no real l10n bundle: `vscode.l10n.t` returns the source.
vi.mock('vscode', async () => await import('./__mocks__/vscode'));

// The swap button does NOT sit in the action bar, but on the divider
// between the row and column zone (instruction flameY3T1, 2026-08-27): where the
// swap takes place, and in view anyway when dragging chips. The test
// pins down the place, because a rework of the bar would otherwise silently pull it to where
// all the other buttons stand.
describe('Cube Viewer axis swap button', () => {
  it('sits between the row and the column zone', () => {
    const html = body();
    const rows = html.indexOf('id="zone-rows"');
    const swap = html.indexOf('id="btn-swap-axes"');
    const cols = html.indexOf('id="zone-cols"');
    expect(swap).toBeGreaterThan(rows);
    expect(swap).toBeLessThan(cols);
  });

  it('says in the title that nothing is re-read', () => {
    const t = buildCubeViewerL10n();
    expect(t.swapAxes).toBe('Swap axes');
    // Without this addition you take the button for a server query and
    // avoid it on large views — yet that is exactly where it is cheap.
    expect(t.swapAxesTitle).toContain('not read again');
  });

  it('uses a symbol that exists in both themes', () => {
    expect(body()).toContain('swap-axes.svg');
    for (const theme of ['light', 'dark']) {
      expect(readFileSync(`media/icons/${theme}/swap-axes.svg`, 'utf8')).toContain('<svg');
    }
  });
});
