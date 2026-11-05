import { describe, it, expect, vi } from 'vitest';

// Since 2026-08-22 the trail reads its texts from the l10n bundle instead of carrying them
// in hard-coded German (flameY3T1: English source text, DE as localization).
// `viewTrail` fetches the map when the module loads — so the stub has to come BEFORE the import,
// hence `vi.hoisted`. The values here are the GERMAN ones, so that the
// expectations below stay unchanged and keep checking the meaning.
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__l10n = {
    vwBaseMembers: 'Baum', vwBaseAll: 'Alle', vwBaseRoots: 'Wurzeln',
    vwBaseExplicit: 'feste Reihenfolge ({0})',
    vwTrailPattern: 'Name {0}', vwTrailType: 'Typ {0}', vwTrailLevel: 'Ebene {0}',
    vwTrailCollapsed: 'zugeklappt {0}', vwTrailKept: 'behalten ({0})',
    vwTrailRemoved: 'entfernt ({0})',
    vwTrailPopTitle: 'Diese Schicht zuruecknehmen',
  };
});

import { trailHtml, layerLabel, chainFor } from '../webviewClient/dimensionBrowser/viewTrail';
import { initialView, pushIntent } from '../webviewClient/dimensionBrowser/intents';

describe('layerLabel', () => {
  it('names the pattern', () => {
    expect(layerLabel({ kind: 'pattern', pattern: '*x*' })).toBe('Name *x*');
  });
  it('names the types', () => {
    expect(layerLabel({ kind: 'type', types: ['N', 'C'] })).toBe('Typ N, C');
  });
  it('names the level', () => {
    expect(layerLabel({ kind: 'level', levels: [0] })).toBe('Ebene 0');
  });
});

describe('trailHtml', () => {
  it('shows only the base with an empty stack, without a withdrawal', () => {
    const html = trailHtml(initialView('tree'));
    expect(html).toContain('Baum');
    expect(html).not.toContain('vw-trail-pop');
  });

  it('gives the withdrawal ONLY to the last chip', () => {
    let v = pushIntent(initialView('tree'), { kind: 'filter', layer: { kind: 'type', types: ['C'] } });
    v = pushIntent(v, { kind: 'collapse', member: 'xxx' });
    const html = trailHtml(v);
    // Two layers, but exactly one withdrawal — that is the point-in-time-x semantics.
    expect(html.split('vw-trail-pop').length - 1).toBe(1);
    // And it sits on the LAST chip.
    expect(html.indexOf('vw-trail-pop')).toBeGreaterThan(html.indexOf('Typ C'));
  });

  it('defuses HTML special characters in the pattern', () => {
    const v = pushIntent(initialView('tree'), { kind: 'filter', layer: { kind: 'pattern', pattern: '<img>&"' } });
    const html = trailHtml(v);
    expect(html).not.toContain('<img>');
    expect(html).toContain('&lt;img&gt;&amp;&quot;');
  });

  it('names the collapse intent with its member', () => {
    const v = pushIntent(initialView('tree'), { kind: 'collapse', member: 'xxx' });
    expect(trailHtml(v)).toContain('zugeklappt xxx');
  });
});

describe('chainFor', () => {
  it("requests the lean projection without a type/level layer", () => {
    const v = pushIntent(initialView('tree'), { kind: 'filter', layer: { kind: 'pattern', pattern: 'a*' } });
    expect(chainFor(v)).toEqual({ kind: 'name' });
  });

  it("also requests type and level with a type layer", () => {
    const v = pushIntent(initialView('tree'), { kind: 'filter', layer: { kind: 'type', types: ['C'] } });
    expect(chainFor(v)).toEqual({ kind: 'name+element' });
  });

  it("also requests them with a level layer", () => {
    const v = pushIntent(initialView('tree'), { kind: 'filter', layer: { kind: 'level', levels: [0] } });
    expect(chainFor(v)).toEqual({ kind: 'name+element' });
  });
});
