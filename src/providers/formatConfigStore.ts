import { mergeFormatConfig, type TiFormatConfig } from '../tiLogicVisualizer/formatRules';
import { keyedStore } from '../utils/keyedStore';
import { FORMAT_CONFIG_KEY } from '../serverState/stateKeys';
import { getExtensionContext } from '../utils/extensionContext';

// Re-exported for back-compat — implementation now lives in the pure formatRules module.
export { mergeFormatConfig };

const store = keyedStore<Partial<TiFormatConfig>, TiFormatConfig>(FORMAT_CONFIG_KEY, {
  ctx: getExtensionContext,
  normalize: mergeFormatConfig,
});

/** Load the merged config for a serverKey (server URL or '__default__'). */
export function loadFormatConfig(serverKey: string): TiFormatConfig {
  return store.load(serverKey);
}

/** Persist a config for a serverKey. */
export async function saveFormatConfig(serverKey: string, config: TiFormatConfig): Promise<void> {
  await store.save(serverKey, config);
}
