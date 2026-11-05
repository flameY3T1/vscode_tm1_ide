/**
 * Shared state for processEditorMonaco webview.
 *
 * Eagerly creates Monaco models + editor at module load so other sub-modules
 * can import { editor, models, vscode } directly.
 *
 * Extracted from `index.ts` in Post-H17 #5 split.
 */

import * as monaco from 'monaco-editor';
import { stubMonacoWorkers } from '../_shared/monacoWebviewEnv';
import { KNOWN_SIGNATURES } from '../../tiLogicVisualizer/tiSignatures';
import type { WebviewToHost } from './protocol';
import { registerTiLanguage } from './tiMonarch';
import { registerCompletions, registerHover, registerDebugValueHover } from './completions';
import { registerContextCompletions } from './contextCompletions';
import { registerFolding } from './folding';
import { lookupDebugValue } from './debug';

export {};

stubMonacoWorkers();

export type { SectionKey } from './sectionTypes';
import type { SectionKey } from './sectionTypes';
import { getVsCodeApi } from '../_shared/vscodeApi';
export const SECTION_ORDER: SectionKey[] = ['prolog', 'metadata', 'data', 'epilog'];


export const vscode = getVsCodeApi<WebviewToHost>();

/**
 * Registers the TI language definition and all Monaco language providers
 * (completions, hover, context-completions, folding, debug-value-hover).
 *
 * Called once at module-end below — extracted to a function in Phase 3a of
 * the tiSignatures JSON-asset split so Phase 3b can defer the call until
 * AFTER signatures are populated from the inline JSON asset.
 */
export function initMonacoLanguage(): void {
  const builtins: string[] = Array.from(KNOWN_SIGNATURES.values()).map(sig => sig.name);
  registerTiLanguage(monaco, builtins);
  try { registerCompletions(monaco); } catch (e) { console.error('[Monaco] registerCompletions failed:', e); }
  try { registerHover(monaco); } catch (e) { console.error('[Monaco] registerHover failed:', e); }
  try { registerContextCompletions(monaco); } catch (e) { console.error('[Monaco] registerContextCompletions failed:', e); }
  try { registerFolding(monaco); } catch (e) { console.error('[Monaco] registerFolding failed:', e); }
  try { registerDebugValueHover(monaco, (ident: string) => lookupDebugValue(ident)); }
  catch (e) { console.error('[Monaco] registerDebugValueHover failed:', e); }
}

initMonacoLanguage();

const container = document.getElementById('monaco-editor-mount');
if (!container) {
  throw new Error('Monaco mount point #monaco-editor-mount not found');
}

export const models: Record<SectionKey, monaco.editor.ITextModel> = {
  prolog:   monaco.editor.createModel('', 'ti'),
  metadata: monaco.editor.createModel('', 'ti'),
  data:     monaco.editor.createModel('', 'ti'),
  epilog:   monaco.editor.createModel('', 'ti'),
};

export const sharedState = {
  currentSection: 'prolog' as SectionKey,
  suppressChange: false as boolean,
  resolverDebounce: null as number | null,
  resolverTabActive: false as boolean,
  lintDebounce: null as number | null,
  saveBannerTimer: null as ReturnType<typeof setTimeout> | null,
  identDecorations: { prolog: [], metadata: [], data: [], epilog: [] } as Record<SectionKey, string[]>,
  // Per-section editor view state (scroll + cursor + selection), so switching
  // tabs and returning restores the exact spot instead of jumping to the top.
  viewStates: { prolog: null, metadata: null, data: null, epilog: null } as Record<SectionKey, monaco.editor.ICodeEditorViewState | null>,
};

function pickTiTheme(): 'ti-light' | 'ti-dark' {
  const cl = document.body.classList;
  if (cl.contains('vscode-light') || cl.contains('vscode-high-contrast-light')) { return 'ti-light'; }
  return 'ti-dark';
}

export const editor = monaco.editor.create(container, {
  model: models.prolog,
  language: 'ti',
  theme: pickTiTheme(),
  automaticLayout: true,
  tabSize: 4,
  insertSpaces: true,
  fontSize: 14,
  minimap: { enabled: false },
  wordWrap: 'off',
  lineNumbers: 'on',
  // Monaco's default is 10px, plus 16px as soon as folding is on — the arrow
  // then almost completely fills the column and sits directly against the code. 16 instead of 10
  // gives it room on both sides. The numbers get their spacing in the
  // stylesheet (padding-right on .line-numbers): their column is right-aligned,
  // so the number used to end exactly at the edge to the folding column.
  lineDecorationsWidth: 16,
  glyphMargin: true,
  folding: true,
  foldingStrategy: 'auto',
  renderWhitespace: 'selection',
  scrollBeyondLastLine: false,
  quickSuggestions: { other: true, comments: false, strings: true },
  suggestOnTriggerCharacters: true,
  hover: { enabled: true, delay: 300, sticky: true },
  experimentalEditContextEnabled: false,
} as any);

new MutationObserver(() => monaco.editor.setTheme(pickTiTheme()))
  .observe(document.body, { attributes: true, attributeFilter: ['class'] });
