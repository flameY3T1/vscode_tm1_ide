import type { LintRuleConfig } from '../../tiLogicVisualizer/tiLinter/ruleConfig';
import { keyedStore } from '../../utils/keyedStore';
import { LINT_CONFIG_KEY } from '../../serverState/stateKeys';
import { getExtensionContext } from '../../utils/extensionContext';

/** Ensure a usable LintRuleConfig (defensive against undefined / missing rules map).
 *  Preserves unusedVariableSections + namingPrefixes — consumed by the linter
 *  (processEditorLint reads ruleConfig.namingPrefixes); dropping them silently
 *  reverted custom prefixes/sections to defaults after reload. */
export function normalizeLintConfig(stored: LintRuleConfig | undefined): LintRuleConfig {
  if (!stored || typeof stored !== 'object' || !stored.rules) { return { rules: {} }; }
  const out: LintRuleConfig = { rules: { ...stored.rules } };
  if (stored.unusedVariableSections) { out.unusedVariableSections = { ...stored.unusedVariableSections }; }
  if (stored.namingPrefixes) { out.namingPrefixes = { ...stored.namingPrefixes }; }
  return out;
}

const store = keyedStore<LintRuleConfig>(LINT_CONFIG_KEY, {
  ctx: getExtensionContext,
  normalize: normalizeLintConfig,
});

export function loadLintConfig(serverKey: string): LintRuleConfig {
  return store.load(serverKey);
}

export async function saveLintConfig(serverKey: string, config: LintRuleConfig): Promise<void> {
  await store.save(serverKey, config);
}
