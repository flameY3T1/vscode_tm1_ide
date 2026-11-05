// Regression guard (source scan) against falling back to sending the full
// axis metadata (Task 5-8 of the axis-meta scoping plan, 2026-08-10).
//
// `axisMeta.ts` may pass the full parent map from the structure cache to the
// outside ONLY via `scopeParentMaps` (cut down to the ancestor hull of the visible rows/columns)
// — no longer passed through raw as `struct.parents`
// or via `.map((s) => s.parents)`. Counter-measurement 2026-08-11:
// with 8333 visible rows, the open payload consisted to 94 % of full
// parent maps that the client never needed.
//
// `grid.ts` may no longer derive `hasChildren` itself from the parent map
// (`for (const c in pmap) { set[pmap[c]] = true; }` — a full scan
// over exactly the map that no longer arrives from the server at all), but
// must use the `matrix.rowHasChildren`/`colHasChildren` supplied by the
// server.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', 'commands', 'cubeViewer');

describe('axis metadata stays scoped', () => {
  it('axisMeta.ts passes no unscoped parent map through', () => {
    const s = readFileSync(join(SRC, 'axisMeta.ts'), 'utf8');
    // The full map may leave the module only via scopeParentMaps.
    expect(s).toContain('scopeParentMaps');
    expect(s).not.toMatch(/parents:\s*struct\.parents/);
    expect(s).not.toMatch(/\.map\(\(s\) => s\.parents\)/);
  });

  it('grid.ts does not derive hasChildren by itself again', () => {
    // Since W3 (2026-10-05) the per-render axis context lives in gridAxes.ts.
    const g = readFileSync(join(__dirname, '..', 'webviewClient', 'cubeViewerMonaco', 'gridAxes.ts'), 'utf8');
    expect(g).toContain('matrix.rowHasChildren');
    // The old full scan: for (const c in pmap) { set[pmap[c]] = true; }
    expect(g).not.toMatch(/set\[pmap\[c\]\]\s*=\s*true/);
  });

  // The scoping makes `hasChildren` the ONLY source for the expand triangle.
  // A `cellData` sender that forgets it delivers a grid without triangles —
  // and that only shows up when clicking, because the numbers are right. After the rework
  // that was the case for 3 of 6 senders (filter/pivot refresh and "Run MDX").
  it('EVERY cellData sender sends hasChildren for both axes', () => {
    const files = ['view.ts', 'messaging.ts'];
    let senders = 0;
    for (const f of files) {
      const s = readFileSync(join(SRC, f), 'utf8');
      let at = s.indexOf("type: 'cellData'");
      while (at >= 0) {
        senders += 1;
        const block = s.slice(at, at + 900);
        expect(block, `${f} @ ${at}: rowHasChildren fehlt`).toMatch(/rowHasChildren:/);
        expect(block, `${f} @ ${at}: colHasChildren fehlt`).toMatch(/colHasChildren:/);
        at = s.indexOf("type: 'cellData'", at + 1);
      }
    }
    // Since 2026-10-04 all five grid paths go through ONE sender,
    // `postDecoratedMatrix` in view.ts (review B1). A second sender would be a
    // new hand-written copy — route it through the helper instead.
    expect(senders).toBe(1);
  });

  // Since the scoping, drilling down is host business. The focus mode built its
  // child index from the (multi-parent only) `all` map and with that no longer expanded
  // anything; the children are already available in the host answer path.
  it('grid.ts passes the host children into the focus/collapse tail', () => {
    const g = readFileSync(join(__dirname, '..', 'webviewClient', 'cubeViewerMonaco', 'gridClick.ts'), 'utf8');
    expect(g).toContain('_focusOrCollapseTail(t, immediate, descendants)');
  });
});
