// Smallest single replace that turns `current` into `next`: common prefix,
// common suffix, the rest is the edit. Shared by the extension host (webview ->
// document) and the webview (document -> Monaco) so both sides cut the same way.
export interface TextReplace { offset: number; length: number; text: string }

export function minimalReplace(current: string, next: string): TextReplace | undefined {
  if (current === next) { return undefined; }
  let p = 0;
  const max = Math.min(current.length, next.length);
  while (p < max && current[p] === next[p]) { p++; }
  let s = 0;
  while (s < current.length - p && s < next.length - p
    && current[current.length - 1 - s] === next[next.length - 1 - s]) { s++; }
  return { offset: p, length: current.length - p - s, text: next.slice(p, next.length - s) };
}
