/**
 * Variable scope. TI variables are dynamically typed (Numeric or String at
 * runtime). The scope is a flat Map for Phase α; we keep `parent` so a
 * future Data-section row scope can shadow the process scope without
 * mutating it.
 */

import type { Value } from '../types';

export class Scope {
  // TI variable names are CASE-INSENSITIVE — `pCube` and `PCUBE` refer to the
  // same variable. We canonicalise to lowercase on every lookup/assign so the
  // underlying Map behaves correctly. ownEntries returns the lowercase form.
  private readonly vars = new Map<string, Value>();
  constructor(public readonly parent?: Scope) {}

  private key(name: string): string {
    return name.toLowerCase();
  }

  get(name: string): Value | undefined {
    const k = this.key(name);
    if (this.vars.has(k)) return this.vars.get(k);
    return this.parent?.get(name);
  }

  /**
   * Assigns `value` to `name`. TI semantics: all variables are process-scoped,
   * so when a parent scope already owns the name we write through to it.
   * Brand-new names land in the current scope (the data-section row-scope
   * uses this for V1/V2/.../NValue/SValue bindings).
   */
  set(name: string, value: Value): void {
    const k = this.key(name);
    if (this.vars.has(k)) {
      this.vars.set(k, value);
      return;
    }
    let owner: Scope | undefined = this.parent;
    while (owner) {
      if (owner.vars.has(k)) {
        owner.vars.set(k, value);
        return;
      }
      owner = owner.parent;
    }
    this.vars.set(k, value);
  }

  has(name: string): boolean {
    const k = this.key(name);
    if (this.vars.has(k)) return true;
    return this.parent ? this.parent.has(name) : false;
  }

  child(): Scope {
    return new Scope(this);
  }

  ownEntries(): Iterable<[string, Value]> {
    return this.vars.entries();
  }
}
