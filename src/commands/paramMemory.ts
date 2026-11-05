/**
 * Most recently used parameter values per server and process.
 *
 * Deliberately stays OUTSIDE the `utils/keyedStore` blueprint: that one puts
 * a mapping under ONE `globalState` key, whereas this store instead uses one
 * key PER ENTRY (`tm1.lastParams:<url>|<process>`). Switching over would mean
 * changing the storage format and throwing away every user's remembered
 * values once — the gain would be one saved line.
 *
 * What was missing was the cleanup: entries survived the deletion of the
 * server profile, unreachable. `purgeLastParamsForServer` now handles that,
 * called from `serverManager/purgeServerState.ts`.
 */
import { getExtensionContext } from '../utils/extensionContext';


const KEY_PREFIX = 'tm1.lastParams:';

function key(serverUrl: string, processName: string): string {
  return `${KEY_PREFIX}${serverUrl}|${processName}`;
}

export function loadLastParams(serverUrl: string, processName: string): Record<string, string> {
  const ctx = getExtensionContext();
  if (!ctx) { return {}; }
  return ctx.globalState.get<Record<string, string>>(key(serverUrl, processName)) ?? {};
}

export async function saveLastParams(
  serverUrl: string,
  processName: string,
  values: Record<string, string>,
): Promise<void> {
  const ctx = getExtensionContext();
  if (!ctx) { return; }
  await ctx.globalState.update(key(serverUrl, processName), values);
}

/** Only the part of the `ExtensionContext` that the cleanup touches.
 *  `keys()` has existed since VS Code 1.69, the extension requires 1.85. */
export interface ParamMemento {
  globalState: {
    keys?(): readonly string[];
    update(key: string, value: unknown): Thenable<void>;
  };
}

/**
 * Discards the remembered parameters of a deleted server.
 *
 * The server reference sits in the key, not the value — cleanup therefore
 * goes through `globalState.keys()` and the prefix. `update(key, undefined)`
 * is the only way to get rid of a `globalState` key again.
 *
 * @returns Number of entries removed; 0 writes nothing at all.
 */
export async function purgeLastParamsForServer(
  ctx: ParamMemento, serverUrl: string,
): Promise<number> {
  if (!serverUrl) { return 0; }
  // `keys` is optional in the type because test doubles usually shrink the
  // `Memento` down to `get`/`update`. If it's missing, there's nothing to
  // clean up — passing over that silently is more correct than throwing on
  // a test double.
  if (typeof ctx.globalState.keys !== 'function') { return 0; }
  const prefix = `${KEY_PREFIX}${serverUrl}|`;
  const matches = ctx.globalState.keys().filter(k => k.startsWith(prefix));
  for (const k of matches) {
    await ctx.globalState.update(k, undefined);
  }
  return matches.length;
}
