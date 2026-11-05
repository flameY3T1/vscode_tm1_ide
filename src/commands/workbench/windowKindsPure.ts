/** How a panel key is built. See `WINDOW_KINDS`. */
export type KeyShape = 'server::target' | 'server' | 'none';

/**
 * Splits a raw panel key.
 *
 * `'server::target'` splits at the FIRST `::` — a target may itself
 * contain `::` (the dimension browser builds such keys). If the separator
 * is missing, the whole key is the server: several hosts key server-wide
 * panels exactly this way.
 */
export function splitRawKey(shape: KeyShape, rawKey: string): { serverId?: string; target?: string } {
  if (shape === 'none') { return { serverId: undefined, target: undefined }; }
  if (shape === 'server') { return { serverId: rawKey, target: undefined }; }
  const at = rawKey.indexOf('::');
  if (at < 0) { return { serverId: rawKey, target: undefined }; }
  return { serverId: rawKey.slice(0, at), target: rawKey.slice(at + 2) };
}
