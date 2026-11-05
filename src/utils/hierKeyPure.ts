// Cube viewer axis key: one string names a hierarchy of a cube dimension.
// The default hierarchy (same name as its dimension) keeps the bare dimension
// name, so every existing state, message and stored layout stays valid. An
// alternate hierarchy is `dim:hier`. TM1 object names cannot contain `:`
// (they double as file names), so the split is unambiguous.
// Pure: imported from the host and from webviewClient.

import { encodeODataKey, escapeMdx } from './odataKey';

export function hierKey(dim: string, hier: string): string {
  // TM1 names are case-insensitive: `[Konten].[KONTEN]` is the default hierarchy.
  return hier === '' || hier.toLowerCase() === dim.toLowerCase() ? dim : `${dim}:${hier}`;
}

export function splitHierKey(key: string): { dim: string; hier: string } {
  const i = key.indexOf(':');
  return i < 0 ? { dim: key, hier: key } : { dim: key.slice(0, i), hier: key.slice(i + 1) };
}

export function dimOfKey(key: string): string {
  return splitHierKey(key).dim;
}

export function isAltHierKey(key: string): boolean {
  return key.includes(':');
}

/** `[dim].[hier]` */
export function hierMdxRef(key: string): string {
  const { dim, hier } = splitHierKey(key);
  return `[${escapeMdx(dim)}].[${escapeMdx(hier)}]`;
}

/** `[dim].[hier].[elem]` */
export function memberMdxRef(key: string, elem: string): string {
  return `${hierMdxRef(key)}.[${escapeMdx(elem)}]`;
}

/** `Dimensions('d')/Hierarchies('h')`, keys escaped + URL-encoded. */
export function hierODataPath(key: string): string {
  const { dim, hier } = splitHierKey(key);
  return `Dimensions('${encodeODataKey(dim)}')/Hierarchies('${encodeODataKey(hier)}')`;
}

