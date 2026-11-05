import type { RulesLintConfig } from '../../tiLogicVisualizer/rulesLinter/ruleConfig';
import { keyedStore } from '../../utils/keyedStore';
import { RULES_LINT_CONFIG_KEY } from '../../serverState/stateKeys';
import { getExtensionContext } from '../../utils/extensionContext';

/** Ensure a usable RulesLintConfig (defensive against undefined / a structurally
 *  broken store). Unknown rule ids are kept: they cost nothing, and dropping them
 *  would silently discard a user's setting for a rule that a later version adds back. */
export function normalizeRulesLintConfig(stored: RulesLintConfig | undefined): RulesLintConfig {
  if (!stored || typeof stored !== 'object' || !stored.rules) { return { rules: {} }; }
  return { rules: { ...stored.rules } };
}

const store = keyedStore<RulesLintConfig>(RULES_LINT_CONFIG_KEY, {
  ctx: getExtensionContext,
  normalize: normalizeRulesLintConfig,
});

export function loadRulesLintConfig(serverKey: string): RulesLintConfig {
  return store.load(serverKey);
}

export async function saveRulesLintConfig(serverKey: string, config: RulesLintConfig): Promise<void> {
  await store.save(serverKey, config);
}
