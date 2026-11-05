import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  levelChoices, showLevelPicks, levelPicks,
} from '../webviewClient/dimensionBrowser/levelPick';

type Stub = {
  innerHTML: string; className: string; textContent: string;
  dataset: Record<string, string>; children: Stub[]; style: { display: string };
  appendChild(c: Stub): void; classList: { add(c: string): void; remove(c: string): void };
};
function stub(): Stub {
  const klassen = new Set<string>();
  const o = {
    _html: '', className: '', textContent: '', dataset: {} as Record<string, string>,
    children: [] as Stub[], style: { display: '' },
    appendChild(c: Stub) { o.children.push(c); },
    classList: { add: (c: string) => klassen.add(c), remove: (c: string) => klassen.delete(c) },
    _klassen: klassen,
  };
  Object.defineProperty(o, 'innerHTML', {
    get: () => o._html,
    set: (v: string) => { o._html = v; if (!v) { o.children.length = 0; } },
  });
  return o as unknown as Stub;
}

/**
 * "Expand to level" only offers levels that EXIST below the clicked
 * element — before, a modal asked for a free number, and a number without
 * a match returned the empty set (flameY3T1, 2026-08-31).
 */
describe('the selectable levels', () => {
  it('lie below the element: level 0 to k-1', () => {
    // The element level is the HEIGHT above the leaves. Below an element of
    // level 3 lie levels 0, 1, 2 — its own level would be the element itself.
    expect(levelChoices(3)).toEqual([0, 1, 2]);
    expect(levelChoices(1)).toEqual([0]);
  });

  it('are empty for a leaf', () => {
    expect(levelChoices(0)).toEqual([]);
    expect(levelChoices(-1)).toEqual([]);
    expect(levelChoices(Number.NaN)).toEqual([]);
  });

  it('say for level 0 that these are the leaves', async () => {
    // `getL10n()` reads `window.__l10n` when the MODULE LOADS — so the texts
    // must be in place before the module comes (in the webview the shell sets them).
    (globalThis as unknown as { __l10n: Record<string, string> }).__l10n = {
      ctxLevelLeaves: 'Level 0 (leaves)', ctxLevelN: 'Level {0}',
    };
    vi.resetModules();
    const m = await import('../webviewClient/dimensionBrowser/levelPick');
    expect(m.levelLabel(0)).toBe('Level 0 (leaves)');
    expect(m.levelLabel(2)).toBe('Level 2');
    delete (globalThis as unknown as { __l10n?: unknown }).__l10n;
  });
});

describe('the level submenu', () => {
  let host: Stub;
  let eintrag: Stub;

  beforeEach(() => {
    host = stub();
    eintrag = stub();
    (globalThis as unknown as { document: unknown }).document = {
      getElementById: (id: string) => (id === 'ctx-expand-to-level-sub' ? host
        : id === 'ctx-expand-to-level' ? eintrag : null),
      createElement: () => stub(),
    };
  });

  it('names each level as its own entry', () => {
    showLevelPicks(3);
    expect(host.children.map((c) => c.dataset.level)).toEqual(['0', '1', '2']);
    expect(levelPicks()).toEqual([0, 1, 2]);
  });

  it('hides the entry for a leaf instead of offering it empty', () => {
    showLevelPicks(0);
    expect(eintrag.style.display).toBe('none');
    expect(host.children).toEqual([]);
    expect(levelPicks()).toEqual([]);
  });

  it('clears the previous list instead of appending', () => {

    showLevelPicks(3);
    showLevelPicks(1);
    expect(host.children.map((c) => c.dataset.level)).toEqual(['0']);
  });
});
