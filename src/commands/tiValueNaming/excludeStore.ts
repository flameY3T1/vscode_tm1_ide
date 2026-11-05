import { normalizeExcludes } from '../../tiValueNaming/excludeFilter';
import { keyedStore } from '../../utils/keyedStore';
import { VALUE_NAMING_EXCLUDES_KEY } from '../../serverState/stateKeys';
import { getExtensionContext } from '../../utils/extensionContext';

/** Ensure a usable exclude list (defensive against undefined / missing values).
 *  Preserves normalized state — dropping them silently would revert custom
 *  excludes to defaults after reload. */
export function normalizeExcludeList(stored: string[] | undefined): string[] {
  if (!Array.isArray(stored)) { return []; }
  return normalizeExcludes(stored);
}

const store = keyedStore<string[]>(VALUE_NAMING_EXCLUDES_KEY, {
  ctx: getExtensionContext,
  normalize: normalizeExcludeList,
});

export function loadExcludes(serverKey: string): string[] {
  return store.load(serverKey);
}

export async function saveExcludes(serverKey: string, excludes: string[]): Promise<void> {
  // Normalize on write, not only on read: otherwise the shape of what is
  // stored would depend on whoever last passed it in.
  await store.save(serverKey, normalizeExcludes(excludes));
}
