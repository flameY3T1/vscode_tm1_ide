// src/utils/objectKinds.ts
//
// The bare vocabulary of TM1 object kinds and the question of whether a name belongs to a
// control object.
//
// Lives here and not next to the bulk pages, because `tm1Rest/objectListingApi.ts`
// needs both — and a REST file does not reach up into `webviews/`.
// No imports, no side effects.

export type ObjKind = 'cube' | 'dimension' | 'process' | 'chore' | 'view' | 'subset';

export const OBJ_KINDS: readonly ObjKind[] =
  ['cube', 'dimension', 'process', 'chore', 'view', 'subset'];
/**
 * Control object: TM1 prefixes its own objects with a curly brace.
 * For a view or subset the PARENT OBJECT decides — the
 * view `Default` in the cube `}ClientProperties` has a harmless name and is not harmless.
 */
export function isControlName(name: string, parent?: string): boolean {
  return name.startsWith('}') || (parent !== undefined && parent.startsWith('}'));
}
