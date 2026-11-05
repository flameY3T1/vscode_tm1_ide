/**
 * Identifier-highlight decorations across all 4 TI sections.
 *
 * Extracted from `index.ts` in Post-H17 #5 split.
 */

import * as monaco from 'monaco-editor';
import { models, sharedState, SECTION_ORDER, SectionKey } from './state';
import { buildIdentifierDecorations } from './dynamicHighlight';
import { getParameters } from './parameters';
import { getUsedVariables } from './variables';

export {};

export function refreshIdentHighlights(section: SectionKey): void {
  const model = models[section];
  const decos = buildIdentifierDecorations(monaco, model, getParameters(), getUsedVariables());
  sharedState.identDecorations[section] = model.deltaDecorations(sharedState.identDecorations[section], decos);
}

export function refreshAllIdentHighlights(): void {
  for (const s of SECTION_ORDER) { refreshIdentHighlights(s); }
}
