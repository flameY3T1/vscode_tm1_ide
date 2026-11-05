/**
 * Section switching + line-count badges.
 *
 * Extracted from `index.ts` in Post-H17 #5 split.
 */

import { editor, models, sharedState, SECTION_ORDER, SectionKey } from './state';
import { applyDecorations as applyBreakpointDecorations } from './breakpoints';

export {};

export function switchToSection(section: SectionKey): void {
  // Remember where we were in the section we're leaving, then swap models and
  // restore the target section's scroll/cursor so returning lands in the same
  // spot instead of at the top.
  const prev = sharedState.currentSection;
  if (prev !== section) {
    sharedState.viewStates[prev] = editor.saveViewState();
  }
  sharedState.currentSection = section;
  editor.setModel(models[section]);
  const saved = sharedState.viewStates[section];
  if (saved) { editor.restoreViewState(saved); }
  document.querySelectorAll<HTMLElement>('.tab').forEach(t => {
    const isActive = t.dataset.tab === 'code' && t.dataset.section === section;
    t.classList.toggle('active', isActive);
  });
  document.querySelectorAll<HTMLElement>('.panel').forEach(p => {
    p.classList.toggle('active', p.id === 'panel-code');
  });
  applyBreakpointDecorations(section);
  requestAnimationFrame(() => editor.layout());
}

export function currentSections(): Record<SectionKey, string> {
  return {
    prolog:   models.prolog.getValue(),
    metadata: models.metadata.getValue(),
    data:     models.data.getValue(),
    epilog:   models.epilog.getValue(),
  };
}

export function updateLineCountBadge(section: SectionKey): void {
  const el = document.getElementById('lc-' + section);
  if (!el) { return; }
  const model = models[section];
  const text = model.getValue();
  const n = text.length === 0 ? 0 : model.getLineCount();
  el.textContent = String(n);
}

export function updateAllLineCountBadges(): void {
  for (const s of SECTION_ORDER) { updateLineCountBadge(s); }
}
