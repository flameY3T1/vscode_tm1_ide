// Click test "test2view" (2026-08-24): two Cube Viewers on the same cube,
// one in a detached window, one in the IDE. Both were saved
// correctly — on restore only ONE opened, and it showed an MDX
// that first had to be executed.
//
// Two causes, both captured here:
//
//  1. The view name determines the panel key
//     (`${server}:${cube}:${sicht}` versus `${server}:${cube}`). If it is missing,
//     both windows build the same one, and `CubeViewerManager.open` turns
//     the second call into a `reveal()` of the first.
//  2. Until then `initialMdx` meant "show for editing". For
//     restoring it has to mean "execute".
import { describe, it, expect, vi, beforeEach } from 'vitest';

const open = vi.fn();
vi.mock('../../commands/cubeViewer/manager', () => ({
  CubeViewerManager: { open: (...a: unknown[]) => open(...a) },
}));

import { WINDOW_KINDS } from '../../commands/workbench/windowKinds';
import type { ReopenContext } from '../../commands/workbench/windowKinds';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const CFG = { serverUrl: 'http://tm1:8001' } as Tm1Config;
const RCTX = {} as ReopenContext;

beforeEach(() => open.mockReset());

describe('tm1CubeViewer.reopen', () => {
  it('passes the view name on — it is the identity of the window', async () => {
    await WINDOW_KINDS.tm1CubeViewer.reopen!(
      { kind: 'tm1CubeViewer', target: 'Top_Level_Cube',
        state: { viewName: 'APS', isPrivate: true, mdx: 'SELECT 1' } },
      CFG, RCTX,
    );
    const [cube, , viewName, isPrivate, mdx] = open.mock.calls[0];
    expect(cube).toBe('Top_Level_Cube');
    expect(viewName).toBe('APS');
    expect(isPrivate).toBe(true);
    expect(mdx).toBe('SELECT 1');
  });

  it('requests EXECUTING the expression, not editing it', () => {
    void WINDOW_KINDS.tm1CubeViewer.reopen!(
      { kind: 'tm1CubeViewer', target: 'C', state: { mdx: 'SELECT 1' } }, CFG, RCTX,
    );
    expect(open.mock.calls[0][5]).toBe(true);
  });

  it('distinguishes two windows on the same cube', async () => {
    // The core of the bug: with the same cube AND a missing view name both
    // build the same key. With a view name there are two.
    const w = (state: unknown) => ({ kind: 'tm1CubeViewer', target: 'Top_Level_Cube', state });
    await WINDOW_KINDS.tm1CubeViewer.reopen!(w({ mdx: 'A' }), CFG, RCTX);
    await WINDOW_KINDS.tm1CubeViewer.reopen!(w({ viewName: 'APS', mdx: 'B' }), CFG, RCTX);
    const schluessel = open.mock.calls.map(([cube, , view, priv]) =>
      view ? `${cube}:${view}${priv ? ':priv' : ''}` : `${cube}`);
    expect(new Set(schluessel).size).toBe(2);
  });

  it('opens as before without a saved state', async () => {
    await WINDOW_KINDS.tm1CubeViewer.reopen!({ kind: 'tm1CubeViewer', target: 'C' }, CFG, RCTX);
    const [cube, , viewName, isPrivate, mdx] = open.mock.calls[0];
    expect(cube).toBe('C');
    expect(viewName).toBeUndefined();
    expect(isPrivate).toBeUndefined();
    expect(mdx).toBeUndefined();
  });
});
