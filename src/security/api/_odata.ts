// src/security/api/_odata.ts
// OData v4 entity-key escaping for the security REST layer.
//
// ONE helper on purpose: `encodeKey` — quote-doubling PLUS percent-encoding. It
// is correct for both places a key can appear:
//   - a URL path segment: `Users('<key>')`, `Groups('<key>')/$ref`
//   - a resource-path reference inside a JSON body: `Groups@odata.bind`,
//     `@odata.id`, `Target@odata.bind`
// Bind/`@odata.id` values are URI references, NOT OData literals — a name
// containing `/` would otherwise split the path segment, and `#`/`?`/space
// would break the reference. Node's WHATWG `new URL()` silently repairs some of
// this for URL paths (`}` → `%7D`, space → `%20`) but never for `/`, `#` and
// never for JSON body values, so every site must encode explicitly.
//
// A quote-doubling-only alias deliberately does NOT live here anymore: it had no
// remaining consumer and was only ever a way to reach the wrong grammar by
// accident. If a caller ever truly percent-encodes itself, import
// `escapeODataKey` from `utils/odataKey` directly and say why.
//
// Pre-encoded literals (e.g. `'%7DGroups'`, `'%7DElementSecurity_…'`) must be
// embedded raw and must NOT be passed through this helper — a second pass would
// turn `%7D` into `%257D`.

import { encodeODataKey } from '../../utils/odataKey';

/** `'` → `''` + `encodeURIComponent`. Correct for URL path keys AND bind/`@odata.id`. */
export function encodeKey(name: string): string {
  return encodeODataKey(name);
}

/**
 * One member of a `Tuple@odata.bind` array:
 * `Dimensions('<dim>')/Hierarchies('<hier>')/Elements('<element>')`.
 *
 * `Cubes('<c>')/tm1.Update` rejects a plain `Tuple: ['<elem>', '<elem>']` string
 * array with HTTP 400 — *"Unexpected value type encountered in the payload while
 * processing \"CellDescriptor\". Expecting either type \"Object\" or
 * \"EntityBind\" but was \"String\""*. Every coordinate has to be a resource path
 * (live-verified against TM1 11.8.02900.8, 2026-07-26).
 *
 * `hier` defaults to the dimension name: every control dimension used by the
 * security cubes (`}Cubes`, `}Processes`, `}Dimensions`, `}Groups`) and every
 * element-security row dimension is addressed through its same-named default
 * hierarchy.
 */
export function elementRef(dim: string, element: string, hier: string = dim): string {
  return `Dimensions('${encodeKey(dim)}')/Hierarchies('${encodeKey(hier)}')/Elements('${encodeKey(element)}')`;
}
