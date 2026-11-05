/**
 * TM1 v12 JSON functions (StringToJson … JsonDiff).
 *
 * Every behaviour below was measured on the v12 test database on 2026-10-19
 * through transient processes, not taken from the docs. The server behaves
 * like nlohmann::ordered_json:
 *  - keys keep insertion order; a duplicate key keeps its first position and
 *    the last value;
 *  - integers and floats stay distinct: `1.0` prints as `1.0`, `1e3` as
 *    `1000.0`, `1e-7` as `1e-07`; integer literals print as written;
 *  - output is compact, non-ASCII stays raw, control chars become `\u00xx`.
 * Invalid JSON input yields '' (JsonSize: -1). A failed edit returns the
 * input unchanged — except JsonPatch, which returns '' on any failed op.
 *
 * Path argument (all functions that take one):
 *  - number: array index, truncated, negative counts from the end;
 *  - '/…': JSON pointer (`~0` = `~`, `~1` = `/`, `-` = append for adds);
 *  - '': the root;
 *  - any other string: ONE object key, taken literally (`'a/b'` is a key).
 */

import type { Value } from '../../types';
import { type Builtin, expectArity } from './_helpers';

type JInt = { int: bigint };
type JFloat = { float: number };
type J = null | boolean | string | JInt | JFloat | J[] | Map<string, J>;

/** nlohmann's value for unparseable input; prints as `<discarded>`. */
const DISCARDED = Symbol('discarded');
type Parsed = J | typeof DISCARDED;

const isInt = (v: J): v is JInt => typeof v === 'object' && v !== null && 'int' in v;
const isFloat = (v: J): v is JFloat => typeof v === 'object' && v !== null && 'float' in v;
const isObj = (v: J): v is Map<string, J> => v instanceof Map;

// ── Parse ────────────────────────────────────────────────────────────────

const INT64_MIN = -(2n ** 63n);
const UINT64_MAX = 2n ** 64n - 1n;

function parse(text: string): Parsed {
  let i = 0;
  const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++; };
  const fail = (): never => { throw new SyntaxError('json'); };
  const value = (): J => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const m = new Map<string, J>();
      ws();
      if (text[i] === '}') { i++; return m; }
      for (;;) {
        ws();
        if (text[i] !== '"') fail();
        const k = str();
        ws();
        if (text[i++] !== ':') fail();
        m.set(k, value());
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i++] === '}') return m;
        fail();
      }
    }
    if (c === '[') {
      i++;
      const a: J[] = [];
      ws();
      if (text[i] === ']') { i++; return a; }
      for (;;) {
        a.push(value());
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i++] === ']') return a;
        fail();
      }
    }
    if (c === '"') return str();
    for (const [lit, v] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(lit, i)) { i += lit.length; return v; }
    }
    const m = /^-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m) fail();
    i += m![0].length;
    if (!m![1] && !m![2]) {
      const n = BigInt(m![0]);
      if (n >= INT64_MIN && n <= UINT64_MAX) return { int: n };
    }
    return { float: Number(m![0]) };
  };
  const str = (): string => {
    i++;
    let out = '';
    for (;;) {
      if (i >= text.length) fail();
      const c = text[i++];
      if (c === '"') return out;
      if (c < ' ') fail();
      if (c !== '\\') { out += c; continue; }
      const e = text[i++];
      const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
      if (e in simple) { out += simple[e]; continue; }
      if (e !== 'u' || !/^[0-9a-fA-F]{4}$/.test(text.slice(i, i + 4))) fail();
      out += String.fromCharCode(parseInt(text.slice(i, i + 4), 16));
      i += 4;
    }
  };
  try {
    const v = value();
    ws();
    return i === text.length ? v : DISCARDED;
  } catch {
    return DISCARDED;
  }
}

// ── Dump ─────────────────────────────────────────────────────────────────

function dumpString(s: string): string {
  let out = '"';
  for (const c of s) {
    const code = c.charCodeAt(0);
    if (c === '"') out += '\\"';
    else if (c === '\\') out += '\\\\';
    else if (c === '\b') out += '\\b';
    else if (c === '\f') out += '\\f';
    else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\t') out += '\\t';
    else if (code < 0x20) out += '\\u' + code.toString(16).padStart(4, '0');
    else out += c;
  }
  return out + '"';
}

/** nlohmann `format_buffer`: fixed between 1e-5 and 1e15, else d.ddde±XX. */
function dumpFloat(x: number): string {
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const sign = x < 0 ? '-' : '';
  const [mant, exp] = Math.abs(x).toExponential().split('e');
  const digits = mant.replace('.', '');
  const k = digits.length;
  const n = Number(exp) + 1;
  if (k <= n && n <= 15) return sign + digits + '0'.repeat(n - k) + '.0';
  if (0 < n && n <= 15) return sign + digits.slice(0, n) + '.' + digits.slice(n);
  if (-4 < n && n <= 0) return sign + '0.' + '0'.repeat(-n) + digits;
  const e = n - 1;
  const m = k === 1 ? digits : digits[0] + '.' + digits.slice(1);
  return `${sign}${m}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
}

function dump(v: Parsed): string {
  if (v === DISCARDED) return '<discarded>';
  if (v === null) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return dumpString(v);
  if (isInt(v)) return v.int.toString();
  if (isFloat(v)) return dumpFloat(v.float);
  if (Array.isArray(v)) return '[' + v.map(dump).join(',') + ']';
  return '{' + [...v].map(([k, x]) => dumpString(k) + ':' + dump(x)).join(',') + '}';
}

function typeName(v: J): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'string') return 'string';
  if (isInt(v) || isFloat(v)) return 'number';
  return Array.isArray(v) ? 'array' : 'object';
}

function equal(a: J, b: J): boolean {
  // Two integers stay bigint: Number() would merge neighbours above 2^53.
  if (isInt(a) && isInt(b)) return a.int === b.int;
  if ((isInt(a) || isFloat(a)) && (isInt(b) || isFloat(b))) {
    return Number(isInt(a) ? a.int : a.float) === Number(isInt(b) ? b.int : b.float);
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = [...a.keys()];
    const kb = [...b.keys()];
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && equal(a.get(k)!, b.get(k)!));
  }
  return a === b;
}

const clone = (v: J): J => parse(dump(v)) as J;

// ── Paths ────────────────────────────────────────────────────────────────

/**
 * One path step: an array index (numeric arg), a plain key (string arg, never
 * an index: `JsonGet('[5,6]', '1')` is ''), or a pointer token (key or index).
 */
type Step = { index: number } | { token: string; pointer: boolean };

function steps(path: Value): Step[] {
  if (typeof path === 'number') return [{ index: Math.trunc(path) }];
  if (path === '') return [];
  if (!path.startsWith('/')) return [{ token: path, pointer: false }];
  return path.slice(1).split('/').map((t) => ({ token: t.replace(/~1/g, '/').replace(/~0/g, '~'), pointer: true }));
}

/** Array position for `step`, or undefined when it names none. */
function arrayIndex(arr: J[], step: Step): number | undefined {
  if ('index' in step) return step.index < 0 ? step.index + arr.length : step.index;
  return step.pointer && /^(0|[1-9]\d*)$/.test(step.token) ? Number(step.token) : undefined;
}

function child(v: J, step: Step): J | undefined {
  if (Array.isArray(v)) {
    const i = arrayIndex(v, step);
    return i !== undefined && i >= 0 && i < v.length ? v[i] : undefined;
  }
  if (isObj(v) && 'token' in step) return v.get(step.token);
  return undefined;
}

function at(root: J, path: Value): J | undefined {
  let v: J | undefined = root;
  for (const s of steps(path)) {
    if (v === undefined) return undefined;
    v = child(v, s);
  }
  return v;
}

/** Parent container + last step, or undefined for the root / a missing parent. */
function parentOf(root: J, path: Value, create: boolean): { parent: J; last: Step } | undefined {
  const all = steps(path);
  if (all.length === 0) return undefined;
  let v: J = root;
  for (const s of all.slice(0, -1)) {
    let next = child(v, s);
    // JsonAdd creates missing intermediate objects (measured: '/x/y' on {"a":1}).
    if (next === undefined && create && isObj(v) && 'token' in s) {
      next = new Map();
      v.set(s.token, next);
    }
    if (next === undefined) return undefined;
    v = next;
  }
  return { parent: v, last: all[all.length - 1] };
}

/** JsonAdd semantics; false when the target cannot take the value. */
function addAt(root: J, path: Value, value: J, strict: boolean): J | undefined {
  if (steps(path).length === 0) {
    // '' appends to an array; on an object it adds the key "" (measured).
    if (Array.isArray(root)) { root.push(value); return root; }
    if (isObj(root)) { root.set('', value); return root; }
    return undefined;
  }
  const p = parentOf(root, path, !strict);
  if (!p) return undefined;
  if (Array.isArray(p.parent)) {
    if ('token' in p.last && p.last.pointer && p.last.token === '-') { p.parent.push(value); return root; }
    const i = arrayIndex(p.parent, p.last);
    if (i === undefined || i < 0) return undefined;
    if (i < p.parent.length) p.parent.splice(i, 0, value);
    else if (strict && i > p.parent.length) return undefined;
    // Past the end, JsonAdd pads with null (measured: [1] at 5 → [1,null,null,null,null,2]).
    else { while (p.parent.length < i) p.parent.push(null); p.parent.push(value); }
    return root;
  }
  if (isObj(p.parent) && 'token' in p.last) { p.parent.set(p.last.token, value); return root; }
  return undefined;
}

function removeAt(root: J, path: Value): boolean {
  const p = parentOf(root, path, false);
  if (!p || child(p.parent, p.last) === undefined) return false;
  if (Array.isArray(p.parent)) p.parent.splice(arrayIndex(p.parent, p.last)!, 1);
  else (p.parent as Map<string, J>).delete((p.last as { token: string }).token);
  return true;
}

function replaceAt(root: J, path: Value, value: J): boolean {
  const p = parentOf(root, path, false);
  if (!p || child(p.parent, p.last) === undefined) return false;
  if (Array.isArray(p.parent)) p.parent[arrayIndex(p.parent, p.last)!] = value;
  else (p.parent as Map<string, J>).set((p.last as { token: string }).token, value);
  return true;
}

// ── Patch / merge / diff ─────────────────────────────────────────────────

function applyPatch(root: J, patch: J): J | undefined {
  if (!Array.isArray(patch)) return undefined;
  let doc = root;
  for (const op of patch) {
    if (!isObj(op)) return undefined;
    const kind = op.get('op');
    const path = op.get('path');
    if (typeof path !== 'string' || (path !== '' && !path.startsWith('/'))) return undefined;
    const from = op.get('from');
    const value = op.get('value');
    if (path === '' && (kind === 'add' || kind === 'replace')) {
      if (value === undefined) return undefined;
      doc = clone(value);
      continue;
    }
    switch (kind) {
      case 'add':
        if (value === undefined || !addAt(doc, path, clone(value), true)) return undefined;
        break;
      case 'remove':
        if (!removeAt(doc, path)) return undefined;
        break;
      case 'replace':
        if (value === undefined || !replaceAt(doc, path, clone(value))) return undefined;
        break;
      case 'move':
      case 'copy': {
        if (typeof from !== 'string') return undefined;
        const v = at(doc, from);
        if (v === undefined) return undefined;
        if (kind === 'move' && !removeAt(doc, from)) return undefined;
        if (!addAt(doc, path, clone(v), true)) return undefined;
        break;
      }
      case 'test': {
        const v = at(doc, path);
        if (v === undefined || value === undefined || !equal(v, value)) return undefined;
        break;
      }
      default:
        return undefined;
    }
  }
  return doc;
}

function mergePatch(target: J, patch: J): J {
  if (!isObj(patch)) return clone(patch);
  const out: Map<string, J> = isObj(target) ? target : new Map();
  for (const [k, v] of patch) {
    if (v === null) out.delete(k);
    else out.set(k, mergePatch(out.get(k) ?? null, v));
  }
  return out;
}

const escToken = (k: string) => k.replace(/~/g, '~0').replace(/\//g, '~1');

function diff(a: Parsed, b: Parsed, path: string): string[] {
  if (a !== DISCARDED && b !== DISCARDED && equal(a, b)) return [];
  const replace = `{"op":"replace","path":${dumpString(path)},"value":${dump(b)}}`;
  if (a === DISCARDED || b === DISCARDED) return [replace];
  if (Array.isArray(a) && Array.isArray(b)) {
    const ops: string[] = [];
    const common = Math.min(a.length, b.length);
    for (let i = 0; i < common; i++) ops.push(...diff(a[i], b[i], `${path}/${i}`));
    // Removals in reverse order, so each index is still valid when applied.
    for (let i = a.length - 1; i >= common; i--) ops.push(`{"op":"remove","path":${dumpString(`${path}/${i}`)}}`);
    for (let i = common; i < b.length; i++) ops.push(`{"op":"add","path":${dumpString(`${path}/-`)},"value":${dump(b[i])}}`);
    return ops;
  }
  if (isObj(a) && isObj(b)) {
    const ops: string[] = [];
    for (const [k, v] of a) {
      const p = `${path}/${escToken(k)}`;
      if (b.has(k)) ops.push(...diff(v, b.get(k)!, p));
      else ops.push(`{"op":"remove","path":${dumpString(p)}}`);
    }
    for (const [k, v] of b) {
      if (!a.has(k)) ops.push(`{"op":"add","path":${dumpString(`${path}/${escToken(k)}`)},"value":${dump(v)}}`);
    }
    return ops;
  }
  return [replace];
}

// ── Builtins ─────────────────────────────────────────────────────────────

const str = (v: Value | undefined): string => (typeof v === 'string' ? v : String(v ?? ''));

/** Parse arg 0; '' result for invalid input is the common case. */
function doc(args: Value[]): J | undefined {
  const v = parse(str(args[0]));
  return v === DISCARDED ? undefined : v;
}

/** Edit helper: invalid document → ''; edit failure → input unchanged. */
function edit(args: Value[], fn: (root: J) => J | boolean | undefined): string {
  const root = doc(args);
  if (root === undefined) return '';
  const original = dump(root);
  const r = fn(root);
  if (r === undefined || r === false) return original;
  return dump(r === true ? root : r);
}

const valueArg = (v: Value | undefined): J | undefined => {
  const p = parse(str(v));
  return p === DISCARDED ? undefined : p;
};

export const JSON_BUILTINS: Builtin[] = [
  {
    name: 'StringToJson',
    invoke: (args) => { expectArity('StringToJson', args, 1); return dumpString(str(args[0])); },
  },
  {
    name: 'JsonToString',
    invoke: (args) => {
      expectArity('JsonToString', args, 1, 2);
      const root = doc(args);
      const v = root === undefined ? undefined : args.length > 1 ? at(root, args[1]) : root;
      if (v === undefined) return '';
      return typeof v === 'string' ? v : dump(v);
    },
  },
  {
    name: 'JsonGet',
    invoke: (args) => {
      expectArity('JsonGet', args, 2);
      const root = doc(args);
      const v = root === undefined ? undefined : at(root, args[1]);
      return v === undefined ? '' : dump(v);
    },
  },
  {
    name: 'JsonGetKey',
    invoke: (args) => {
      expectArity('JsonGetKey', args, 2);
      const root = doc(args);
      if (!root || !isObj(root) || typeof args[1] !== 'number') return '';
      const keys = [...root.keys()];
      const i = Math.trunc(args[1]) < 0 ? Math.trunc(args[1]) + keys.length : Math.trunc(args[1]);
      return keys[i] ?? '';
    },
  },
  {
    name: 'JsonType',
    invoke: (args) => {
      expectArity('JsonType', args, 1, 2);
      const root = doc(args);
      const v = root === undefined ? undefined : args.length > 1 ? at(root, args[1]) : root;
      return v === undefined ? '' : typeName(v);
    },
  },
  {
    name: 'JsonSize',
    invoke: (args) => {
      expectArity('JsonSize', args, 1, 2);
      const root = doc(args);
      const v = root === undefined ? undefined : args.length > 1 ? at(root, args[1]) : root;
      if (v === undefined) return -1;
      if (v === null) return 0;
      if (Array.isArray(v)) return v.length;
      return isObj(v) ? v.size : 1;
    },
  },
  {
    name: 'JsonAdd',
    invoke: (args) => {
      expectArity('JsonAdd', args, 3);
      const value = valueArg(args[2]);
      return edit(args, (root) => (value === undefined ? undefined : addAt(root, args[1], value, false)));
    },
  },
  {
    name: 'JsonReplace',
    invoke: (args) => {
      expectArity('JsonReplace', args, 3);
      const value = valueArg(args[2]);
      return edit(args, (root) => value !== undefined && replaceAt(root, args[1], value));
    },
  },
  {
    name: 'JsonRemove',
    invoke: (args) => {
      expectArity('JsonRemove', args, 2);
      // Removing the root leaves null (measured for '' on array and object).
      return edit(args, (root) => (steps(args[1]).length === 0 ? null : removeAt(root, args[1])));
    },
  },
  {
    name: 'JsonMove',
    invoke: (args) => {
      expectArity('JsonMove', args, 3);
      return edit(args, (root) => {
        const v = at(root, args[1]);
        if (v === undefined || !removeAt(root, args[1])) return undefined;
        return addAt(root, args[2], v, false);
      });
    },
  },
  {
    name: 'JsonPatch',
    invoke: (args) => {
      expectArity('JsonPatch', args, 2);
      const root = doc(args);
      const patch = valueArg(args[1]);
      const r = root === undefined || patch === undefined ? undefined : applyPatch(root, patch);
      return r === undefined ? '' : dump(r);
    },
  },
  {
    name: 'JsonMergePatch',
    invoke: (args) => {
      expectArity('JsonMergePatch', args, 2);
      const patch = valueArg(args[1]);
      return edit(args, (root) => (patch === undefined ? undefined : mergePatch(root, patch)));
    },
  },
  {
    name: 'JsonDiff',
    invoke: (args) => {
      expectArity('JsonDiff', args, 2);
      return '[' + diff(parse(str(args[0])), parse(str(args[1])), '').join(',') + ']';
    },
  },
];
