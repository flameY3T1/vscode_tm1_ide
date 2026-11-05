/**
 * Discriminated-union protocol for the Rule Editor (Monaco)
 * webview ↔ extension-host bridge.
 *
 * Hebel 13 (2026-05-17): single source of truth for every `postMessage`
 * shape. Both sides import from this module — host
 * (`src/commands/rule/ruleEditor.ts`) and webview client
 * (`src/webviewClient/ruleEditorMonaco/index.ts`).
 */

import type { RuleFormatConfig } from '../../tiLogicVisualizer/formatRulesText';
import type { RulesLintConfig } from '../../tiLogicVisualizer/rulesLinter/ruleConfig';
import type { RulesLintDiagnose } from '../../tiLogicVisualizer/rulesLinter';

/** One diagnostic as the host's rules linter produces it (message already localized). */
export type RuleLintDiagnostic = RulesLintDiagnose;

export interface QualifyWarning {
  line: number;
  entry: string;
  reason: string;
  detail?: string;
}

// ── Host → Webview ──────────────────────────────────────────────
export type HostToWebview =
  | {
      type: 'initData';
      cubeName: string;
      rulesText: string;
      lintDiags: RuleLintDiagnostic[];
      cubeDimensions: string[];
    }
  | { type: 'formatConfig'; config: RuleFormatConfig }
  | { type: 'rulesLintConfig'; config: RulesLintConfig }
  | { type: 'lintResults'; diagnostics: RuleLintDiagnostic[] }
  | { type: 'compileResults'; diagnostics: RuleLintDiagnostic[] }
  | { type: 'clearCompileResults' }
  | { type: 'pasteText'; text: string }
  | { type: 'insertText'; text: string; snippet?: boolean }
  | { type: 'saveSuccess' }
  | { type: 'saveError'; message: string }
  | { type: 'saveCancelled' }
  | { type: 'completions'; context: 'dimensions'; items: string[] }
  | { type: 'completions'; context: 'cubes'; items: string[] }
  | {
      type: 'completions';
      context: 'cubesWithDims';
      cubes: Array<{ name: string; dims: string[] }>;
    }
  | {
      type: 'completions';
      context: 'attributes';
      dimension: string;
      items: string[];
    }
  | {
      type: 'qualifyResult';
      ok: true;
      text: string;
      warnings: QualifyWarning[];
    }
  | { type: 'qualifyResult'; ok: false; message: string }
  | { type: 'revealLine'; line: number };

// ── Webview → Host ──────────────────────────────────────────────
export type WebviewToHost =
  | { type: 'monacoReady' }
  | { type: 'openExternal'; url: string }
  | { type: 'requestPaste' }
  | { type: 'requestCopy'; text: string }
  | { type: 'save'; rulesText: string }
  | {
      type: 'getCompletions';
      context: 'dimensions' | 'cubes' | 'cubesWithDims';
    }
  | {
      type: 'getCompletions';
      context: 'attributes';
      dimension: string;
    }
  | { type: 'qualifyElements'; code: string }
  | { type: 'setFormatConfig'; config: RuleFormatConfig }
  | { type: 'setRulesLintConfig'; config: RulesLintConfig }
  | { type: 'codeChanged'; code: string }
  | { type: 'openAreaDbBuilder' };
