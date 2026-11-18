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

/**
 * Every object inside a received message loses its prototype, in place. One
 * call at the receive step covers all name-keyed fields of a protocol, so a
 * new field cannot be forgotten (2026-11-12: ten cube viewer fields were).
 * `skip`: objects left as they are, with their contents - for big maps whose
 * keys are provably no names.
 */
export function stripPrototypesDeep(v: unknown, skip?: ReadonlySet<unknown>): void {
  if (skip?.has(v)) { return; }
  if (Array.isArray(v)) { for (const x of v) { stripPrototypesDeep(x, skip); } return; }
  if (typeof v !== 'object' || v === null) { return; }
  Object.setPrototypeOf(v, null);
  for (const k of Object.keys(v)) { stripPrototypesDeep((v as Record<string, unknown>)[k], skip); }
}
