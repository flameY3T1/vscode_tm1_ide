import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../webviewClient/dimensionBrowser/banner', () => ({ flashBanner: vi.fn() }));

import {
  startView, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';

let posted: { type: string; mdx?: string }[] = [];
const post = (m: unknown) => { posted.push(m as never); };
const mdx = () => posted.filter((p) => p.type === 'fetchViewRows').map((p) => p.mdx!);

/**
 * Decision by flameY3T1, 2026-08-23: typing should still show something.
 *
 * The preview is therefore a layer that applies ONLY to fetching and drawing
 * and does NOT lie in the stack. That way "Apply" stays the conclusion —
 * without it nothing has come into being that an `x` would have to take back.
 *
 * The separation is the whole point: if the preview lay in the stack, every
 * typing pause would have to create a layer and the next one remove it again,
 * and the trail would count intents the user never declared.
 */
describe('preview is not a layer', () => {
  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
  });

  it('fetches with the preview layer', () => {
    startView('aa', 'aa', post);
    previewLayer({ kind: 'pattern', pattern: 'bahn*' });
    expect(mdx().at(-1)).toContain('TM1FILTERBYPATTERN({[aa].[aa].Members}, "bahn*")');
  });

  it('the next preview REPLACES the previous one instead of stacking', () => {
    startView('aa', 'aa', post);
    previewLayer({ kind: 'pattern', pattern: 'bah' });
    previewLayer({ kind: 'pattern', pattern: 'bahn' });
    const letzter = mdx().at(-1)!;
    expect(letzter.match(/TM1FILTERBYPATTERN/g)).toHaveLength(1);
    expect(letzter).toContain('"bahn"');
  });

  it('withdrawing it fetches without it again', () => {
    startView('aa', 'aa', post);
    previewLayer({ kind: 'pattern', pattern: 'bahn' });
    previewLayer(null);
    expect(mdx().at(-1)).not.toContain('TM1FILTERBYPATTERN');
  });

  it('the same preview twice does NOT fetch twice', () => {
    startView('aa', 'aa', post);
    previewLayer({ kind: 'attr', attrs: ['SITENAME'], value: 'bahn' });
    const n = mdx().length;
    previewLayer({ kind: 'attr', attrs: ['SITENAME'], value: 'bahn' });
    expect(mdx()).toHaveLength(n);
  });

  it('Apply turns the preview into a layer — and leaves no second one behind', () => {
    startView('aa', 'aa', post);
    previewLayer({ kind: 'pattern', pattern: 'bahn*' });
    applyFilter({ kind: 'pattern', pattern: 'bahn*' });
    const letzter = mdx().at(-1)!;
    expect(letzter.match(/TM1FILTERBYPATTERN/g)).toHaveLength(1);
    // And afterwards it REALLY is in the stack: a new preview goes on top of it
    // instead of replacing it.
    previewLayer({ kind: 'pattern', pattern: '*C' });
    expect(mdx().at(-1)!.match(/TM1FILTERBYPATTERN/g)).toHaveLength(2);
  });

  it('a preview lies ABOVE the stack, not below it', () => {
    startView('aa', 'aa', post);
    applyFilter({ kind: 'type', types: ['C'] });
    previewLayer({ kind: 'pattern', pattern: 'bahn*' });
    const letzter = mdx().at(-1)!;
    expect(letzter.indexOf('ELEMENT_TYPE')).toBeGreaterThan(letzter.indexOf('TM1FILTERBYPATTERN'));
  });

  it('requests the chain projection the preview needs', () => {
    // Otherwise the ancestor carries no attribute value and the preview indents
    // wrongly — exactly the silent fallback the axes exist to prevent.
    startView('aa', 'aa', post);
    previewLayer({ kind: 'attr', attrs: ['SITENAME'], value: 'bahn' });
    const letzte = posted.filter((p) => p.type === 'fetchViewRows').at(-1) as
      { chain?: { kind: string; attr?: string } };
    expect(letzte.chain).toEqual({ kind: 'name', attrs: ['SITENAME'] });
  });
});

// ---------------------------------------------------------------------------

import { trailHtml } from '../webviewClient/dimensionBrowser/viewTrail';
import { initialView, pushIntent } from '../webviewClient/dimensionBrowser/intents';
import { previewLayer } from '../webviewClient/dimensionBrowser/viewLayers';
import { applyFilter } from '../webviewClient/dimensionBrowser/viewLayers';

describe('the trail shows the preview as pending', () => {
  const basis = pushIntent(initialView('tree'),
    { kind: 'filter', layer: { kind: 'type', types: ['C'] } });

  it('gives the preview NO undo x', () => {
    // Otherwise a click on it would remove the topmost REAL layer (`popLayer`
    // reaches into `intents`, where the preview never lies) — an x that deletes
    // something other than what it is labelled with.
    const html = trailHtml(basis, { kind: 'pattern', pattern: 'bahn*' });
    const schwebend = html.slice(html.indexOf('vw-trail-pending'));
    expect(schwebend).not.toContain('vw-trail-pop');
  });

  it('appends it at the very end and marks it as pending', () => {
    const html = trailHtml(basis, { kind: 'pattern', pattern: 'bahn*' });
    expect(html).toContain('vw-trail-pending');
    expect(html.indexOf('vw-trail-pending')).toBeGreaterThan(html.indexOf('vw-trail-chip'));
  });

  it('the x stays on the topmost REAL layer, even with a preview', () => {
    const html = trailHtml(basis, { kind: 'pattern', pattern: 'bahn*' });
    expect(html.indexOf('vw-trail-pop')).toBeLessThan(html.indexOf('vw-trail-pending'));
  });

  it('without a preview unchanged as before', () => {
    expect(trailHtml(basis)).toBe(trailHtml(basis, null));
    expect(trailHtml(basis)).not.toContain('vw-trail-pending');
  });
});
