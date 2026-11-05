// The arithmetic of the virtualization, without a DOM.
//
// Taken over from the old drawing path (`cbd31110^:render.ts#_drawViewport`),
// but there it was computed with a constant `ROW_H = 22`. Here the height is a
// parameter, because it is measured and may be fractional (22.547 at
// font size 13).
import { describe, it, expect } from 'vitest';
import { viewportRange, spacerHtml } from '../webviewClient/dimensionBrowser/viewRender';

describe('viewportRange', () => {
  it('returns an empty window for an empty list', () => {
    const a = viewportRange(0, 0, 600, 22, 12);
    expect(a).toEqual({ start: 0, end: 0, topPx: 0, botPx: 0, scrollTop: 0 });
  });

  it('shows everything when the list is shorter than the window', () => {
    const a = viewportRange(10, 0, 600, 22, 12);
    expect(a.start).toBe(0);
    expect(a.end).toBe(10);
    expect(a.topPx).toBe(0);
    expect(a.botPx).toBe(0);
  });

  it('paints no top spacer at the start', () => {
    const a = viewportRange(100000, 0, 600, 22, 12);
    expect(a.start).toBe(0);
    expect(a.topPx).toBe(0);
    // 600/22 = 27.3 → rounded up 28, plus 12 buffer
    expect(a.end).toBe(40);
    expect(a.botPx).toBeCloseTo((100000 - 40) * 22, 5);
  });

  it('computes both spacers in the middle', () => {
    const a = viewportRange(100000, 22000, 600, 22, 12);
    // 22000/22 = 1000, minus 12 buffer
    expect(a.start).toBe(988);
    expect(a.end).toBe(1040);
    expect(a.topPx).toBeCloseTo(988 * 22, 5);
    expect(a.botPx).toBeCloseTo((100000 - 1040) * 22, 5);
  });

  it('CLAMPS a scroll position above the content height', () => {
    // After a dim switch or a filter shrink, `scrollTop` stands
    // above the new content height; the browser has not clamped it yet.
    // Without the clamp the window computes itself out of nothing but spacers and paints
    // NOTHING until someone scrolls (scar 1 from the spec).
    const a = viewportRange(50, 90000, 600, 22, 12);
    expect(a.scrollTop).toBe(Math.max(0, 50 * 22 - 600));
    expect(a.end).toBe(50);
    expect(a.botPx).toBe(0);
  });

  it('never clamps below zero', () => {
    const a = viewportRange(5, 0, 600, 22, 12);
    expect(a.scrollTop).toBe(0);
  });

  it('carries a fractional row height through', () => {
    // 13px font with the old padding gives 22.000 — with the new one 22.547.
    // The arithmetic must handle both, otherwise it depends on the CSS rule.
    const a = viewportRange(1000, 2254.7, 600, 22.547, 12);
    expect(a.start).toBe(88);
    expect(a.topPx).toBeCloseTo(88 * 22.547, 5);
    expect(a.topPx + a.botPx + (a.end - a.start) * 22.547).toBeCloseTo(1000 * 22.547, 5);
  });

  it('falls back to 22 when the height is unusable', () => {
    // Without layout (jsdom-free, container display:none) the measurement returns 0.
    // A division by 0 would give Infinity and an empty window — the
    // fallback therefore belongs in the arithmetic, not only in the measurement.
    const a = viewportRange(1000, 0, 600, 0, 12);
    expect(Number.isFinite(a.end)).toBe(true);
    expect(a.end).toBe(40);
  });

  it('falls back to a default viewport when the height is 0 as well', () => {
    // Container without layout: neither viewport nor row height can be measured.
    const a = viewportRange(100000, 0, 0, 0, 12);
    expect(a.end).toBe(Math.ceil(800 / 22) + 12);
  });

  it('keeps a partially visible row in the window', () => {
    // floor, not round: at scrollTop 15, row 0 is still visible.
    const a = viewportRange(1000, 15, 600, 22, 0);
    expect(a.start).toBe(0);
  });

  it('draws real rows after the clamp, not only spacers', () => {
    const a = viewportRange(50, 90000, 600, 22, 12);
    expect(a.start).toBeLessThan(a.end);
  });

  it('draws no extra row when the window divides evenly', () => {
    // 600 / 25 = 24 exactly. An epsilon on `ceil` turned that into 25.
    const a = viewportRange(1000, 0, 600, 25, 0);
    expect(a.end).toBe(24);
  });

  it('absorbs a floating-point remainder in the floor', () => {
    // 2254.7 / 22.547 is mathematically 100, in IEEE 99.99999999999999.
    const a = viewportRange(1000, 2254.7, 600, 22.547, 0);
    expect(a.start).toBe(100);
  });
});

/**
 * Fix round 2, finding 3: as soon as an attribute column is selected, the
 * header row stands IN THE FLOW above the `<tbody>`. The real maximum scroll position
 * of the container is therefore larger by its height — the clamp computed it without it and
 * visibly snapped back at the end of the list (`drawWindow` writes the
 * clamped value back, `bindScroll` calls it on every scroll).
 */
describe('viewportRange — the header row in the flow', () => {
  it('without a header row it computes bit-identically to omitting the parameter', () => {
    const ohne = viewportRange(100000, 22000, 600, 22, 12);
    const mitNull = viewportRange(100000, 22000, 600, 22, 12, 0);
    expect(mitNull).toEqual(ohne);
  });

  it('raises the maximum position by the header row height', () => {
    // 50 rows at 22 = 1100 content, 28 header row, 600 viewport:
    // the container scrolls up to 1100 + 28 - 600 = 528, not up to 500.
    const a = viewportRange(50, 90000, 600, 22, 12, 28);
    expect(a.scrollTop).toBe(50 * 22 + 28 - 600);
  });

  it('lets the LAST row really be reached at the end', () => {
    const a = viewportRange(50, 90000, 600, 22, 12, 28);
    expect(a.end).toBe(50);
    expect(a.botPx).toBe(0);
  });

  it('computes the row positions WITHIN the body, not the container', () => {
    // Position 1028 minus 28 header row = 1000 in the body → row 45.
    const a = viewportRange(1000, 1028, 600, 22, 12, 28);
    expect(a.start).toBe(Math.floor(1000 / 22) - 12);
  });

  it('never clamps below zero, even with a header row', () => {
    const a = viewportRange(5, 0, 600, 22, 12, 28);
    expect(a.scrollTop).toBe(0);
    expect(a.start).toBe(0);
  });
});

describe('spacerHtml', () => {
  it('paints nothing at height 0', () => {
    expect(spacerHtml(0)).toBe('');
  });

  it('carries no data-idx — click, context menu and drag must not hit it', () => {
    const h = spacerHtml(1234);
    expect(h).not.toContain('data-idx');
    expect(h).toContain('class="vspacer"');
    expect(h).toContain('aria-hidden="true"');
    expect(h).toContain('height:1234px');
  });

  it('does not round away fractional heights', () => {
    expect(spacerHtml(22.5)).toContain('height:22.5px');
  });
});
