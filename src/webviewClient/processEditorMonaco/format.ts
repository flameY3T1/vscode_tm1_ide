/**
 * Format-all-sections (TI auto-formatter). Uses the per-instance config
 * pushed from the host via the `formatConfig` message.
 */
import { editor, models, SECTION_ORDER } from './state';
import { formatTi } from '../../tiLogicVisualizer/formatTi';
import { DEFAULT_FORMAT_CONFIG, type TiFormatConfig } from '../../tiLogicVisualizer/formatRules';
import { diffLines, hunksToEdits } from './lineDiff';
import { buildCanonicalNames } from '../../tiLogicVisualizer/tiLinter/helpers/canonicalNames';
import { getParameters } from './parameters';
import { getUsedVariables } from './variables';

export {};

let currentConfig: TiFormatConfig = DEFAULT_FORMAT_CONFIG;

export function setFormatConfig(cfg: TiFormatConfig): void {
  currentConfig = cfg;
}

export function getFormatConfig(): TiFormatConfig {
  return currentConfig;
}

export function formatAllSections(): void {
  const sections = {
    prolog: models.prolog.getValue(),
    metadata: models.metadata.getValue(),
    data: models.data.getValue(),
    epilog: models.epilog.getValue(),
  };
  const paramNames = getParameters().map(p => p.Name).filter(Boolean);
  // Datasource variables are tracked in the variables module (ProcessVariable[]),
  // not in the DataSource object itself.
  const dsVarNames = getUsedVariables().map(v => v.Name).filter(Boolean);
  const identifierCanonical = buildCanonicalNames(sections, paramNames, dsVarNames);
  const cfg: TiFormatConfig = { ...currentConfig, identifierCanonical };

  for (const section of SECTION_ORDER) {
    const model = models[section];
    const oldText = model.getValue();
    const newText = formatTi(oldText, cfg);
    if (newText !== oldText) {
      // Minimal per-hunk edits, not a full-range replace: replacing the whole
      // model makes Monaco re-tokenize everything at once → the document flashes
      // uncolored for a frame. Editing only the changed line ranges keeps the
      // unchanged lines' tokens (and their colors) intact.
      const hunks = diffLines(oldText.split('\n'), newText.split('\n'));
      const edits = hunksToEdits(hunks, model.getLineCount(), (ln) => model.getLineMaxColumn(ln));
      model.pushEditOperations([], edits, () => null);
    }
  }
  editor.focus();
}
