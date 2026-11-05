/**
 * Maps keyed by TM1 names (elements, dimensions, users) must not have a prototype.
 *
 * TM1 accepts names such as "constructor", "toString" and "__proto__" (verified
 * live 2026-11-05). On a plain object `map["constructor"]` returns Object
 * itself, so `map[name] ?? []` yields a function, `for…of` throws, and a write to
 * `map["__proto__"]` lands on the prototype instead of the map. Guard test:
 * src/test/prototypeKeyNames.test.ts.
 */

/** An empty map with no prototype. */
export function nameMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/**
 * The same map without its prototype, changed in place (no copy). For maps
 * that arrive over postMessage: JSON.parse keeps "__proto__" as an own key,
 * only the prototype lookup has to go.
 */
export function asNameMap<T>(m: Record<string, T>): Record<string, T> {
  return Object.setPrototypeOf(m, null) as Record<string, T>;
}
