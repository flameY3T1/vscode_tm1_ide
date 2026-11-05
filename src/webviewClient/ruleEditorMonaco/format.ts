/**
 * Rules auto-formatter button action. Formats the whole model in place via a
 * single full-range edit (preserves the Monaco undo stack, unlike setValue).
 * Uses the per-instance config pushed from the host via `formatConfig`.
 */
import type * as monacoType from 'monaco-editor';
import {
  formatRulesText, DEFAULT_RULE_FORMAT_CONFIG, type RuleFormatConfig,
} from '../../tiLogicVisualizer/formatRulesText';

let currentConfig: RuleFormatConfig = DEFAULT_RULE_FORMAT_CONFIG;

export function setFormatConfig(cfg: RuleFormatConfig): void {
  currentConfig = cfg;
}

export function getFormatConfig(): RuleFormatConfig {
  return currentConfig;
}

export function formatRules(
  editor: monacoType.editor.IStandaloneCodeEditor,
  model: monacoType.editor.ITextModel,
): void {
  const oldText = model.getValue();
  const newText = formatRulesText(oldText, currentConfig);
  if (newText !== oldText) {
    editor.executeEdits('format', [{
      range: model.getFullModelRange(),
      text: newText,
      forceMoveMarkers: true,
    }]);
  }
  editor.focus();
}
