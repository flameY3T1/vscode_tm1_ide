/**
 * Save payload builder + save-banner UI.
 *
 * Extracted from `index.ts` in Post-H17 #5 split.
 */

import { sharedState } from './state';
import { currentSections } from './sections';
import { getParameters, getSecurity } from './parameters';
import { getDataSource } from './dataSource';
import { getVariables } from './variables';
import { getErrorCount } from './linter';
import { flushFileSync } from './fileMode';

export {};

export function buildSavePayload(type: 'save' | 'execute' | 'saveAs') {
  flushFileSync();
  return {
    type,
    sections: currentSections(),
    parameters: getParameters(),
    dataSource: getDataSource(),
    variables: getVariables(),
    hasSecurity: getSecurity(),
    errorCount: getErrorCount(),
  };
}

export function showSaveBanner(kind: 'error' | 'success', text: string, autoHideMs?: number): void {
  const el = document.getElementById('save-banner');
  if (!el) { return; }
  if (sharedState.saveBannerTimer) { clearTimeout(sharedState.saveBannerTimer); sharedState.saveBannerTimer = null; }
  el.textContent = text;
  el.className = `save-banner visible ${kind}`;
  if (autoHideMs && autoHideMs > 0) {
    sharedState.saveBannerTimer = setTimeout(() => hideSaveBanner(), autoHideMs);
  }
}

export function hideSaveBanner(): void {
  const el = document.getElementById('save-banner');
  if (el) { el.className = 'save-banner'; el.textContent = ''; }
  if (sharedState.saveBannerTimer) { clearTimeout(sharedState.saveBannerTimer); sharedState.saveBannerTimer = null; }
}
