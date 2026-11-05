/**
 * Debounced lint + resolver requests.
 *
 * Extracted from `index.ts` in Post-H17 #5 split.
 */

import { vscode, sharedState } from './state';
import { currentSections } from './sections';
import { getParameters } from './parameters';
import { getUsedVariables } from './variables';
import { markResolverPending } from './resolver';

export {};

export function requestLint(): void {
  vscode.postMessage({
    type: 'requestLint',
    sections: currentSections(),
    parameters: getParameters(),
    variables: getUsedVariables(),
  });
}

export function scheduleLint(): void {
  if (sharedState.lintDebounce !== null) { window.clearTimeout(sharedState.lintDebounce); }
  sharedState.lintDebounce = window.setTimeout(() => {
    sharedState.lintDebounce = null;
    requestLint();
  }, 500);
}

export function requestResolver(): void {
  vscode.postMessage({
    type: 'requestResolver',
    sections: currentSections(),
    parameters: getParameters(),
    variables: getUsedVariables(),
  });
}

export function scheduleResolver(): void {
  if (!sharedState.resolverTabActive) { return; }
  if (sharedState.resolverDebounce !== null) { window.clearTimeout(sharedState.resolverDebounce); }
  sharedState.resolverDebounce = window.setTimeout(() => {
    sharedState.resolverDebounce = null;
    markResolverPending();
    requestResolver();
  }, 500);
}
