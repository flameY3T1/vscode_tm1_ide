/**
 * Per-TM1-instance persistence for the rules-formatter config. Same blueprint
 * as the Process-Editor's formatConfigStore (`utils/keyedStore`), but with its
 * own globalState key and the rules-specific config shape. Keyed by serverKey
 * (server URL or '__default__').
 */
import {
  mergeRuleFormatConfig, type RuleFormatConfig,
} from '../tiLogicVisualizer/formatRulesText';
import { keyedStore } from '../utils/keyedStore';
import { RULE_FORMAT_CONFIG_KEY } from '../serverState/stateKeys';
import { getExtensionContext } from '../utils/extensionContext';

const store = keyedStore<Partial<RuleFormatConfig>, RuleFormatConfig>(RULE_FORMAT_CONFIG_KEY, {
  ctx: getExtensionContext,
  normalize: mergeRuleFormatConfig,
});

/** Load the merged config for a serverKey. */
export function loadRuleFormatConfig(serverKey: string): RuleFormatConfig {
  return store.load(serverKey);
}

/** Persist a config for a serverKey. */
export async function saveRuleFormatConfig(serverKey: string, config: RuleFormatConfig): Promise<void> {
  await store.save(serverKey, config);
}
