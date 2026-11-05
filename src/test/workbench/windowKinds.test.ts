import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import { splitRawKey } from '../../commands/workbench/windowKindsPure';
import { WINDOW_KINDS, DEFAULT_KIND, kindOf } from '../../commands/workbench/windowKinds';

describe('splitRawKey', () => {
  it('splits the common server::target shape', () => {
    expect(splitRawKey('server::target', 'http://s:12354::Reporting'))
      .toEqual({ serverId: 'http://s:12354', target: 'Reporting' });
  });
  it('treats a key without the separator as server-only', () => {
    expect(splitRawKey('server::target', 'http://s:12354'))
      .toEqual({ serverId: 'http://s:12354', target: undefined });
  });
  it('keeps a target that itself contains a colon', () => {
    expect(splitRawKey('server::target', 'http://s::A::B'))
      .toEqual({ serverId: 'http://s', target: 'A::B' });
  });
  it('reads a server-shaped key', () => {
    expect(splitRawKey('server', 'http://s')).toEqual({ serverId: 'http://s', target: undefined });
  });
  it('yields nothing for a key that carries no server', () => {
    expect(splitRawKey('none', 'Reporting')).toEqual({ serverId: undefined, target: undefined });
  });
});

describe('WINDOW_KINDS table', () => {
  it('gives every kind either a way back or a transient mark — never neither', () => {
    const broken = Object.entries(WINDOW_KINDS)
      .filter(([, k]) => !k.transient && typeof k.reopen !== 'function')
      .map(([name]) => name);
    expect(broken).toEqual([]);
  });

  it('never marks a kind transient AND reopenable', () => {
    const broken = Object.entries(WINDOW_KINDS)
      .filter(([, k]) => k.transient && typeof k.reopen === 'function')
      .map(([name]) => name);
    expect(broken).toEqual([]);
  });

  it('gives every non-transient kind a label and a group', () => {
    const broken = Object.entries(WINDOW_KINDS)
      .filter(([, k]) => !k.transient && (typeof k.label !== 'function' || typeof k.group !== 'function'))
      .map(([name]) => name);
    expect(broken).toEqual([]);
  });

  it('covers the dimension browser selection panels as transient', () => {
    expect(WINDOW_KINDS['tm1DimensionBrowserSelection']?.transient).toBe(true);
  });
  it('treats TM1 Top monitoring as transient rather than Other', () => {
    expect(kindOf('tm1Top')).not.toBe(DEFAULT_KIND);
    expect(kindOf('tm1Top').transient).toBe(true);
    expect(kindOf('tm1Top').keyShape).toBe('server');
  });
});

describe('DEFAULT_KIND — a kind this version does not know', () => {
  it('answers for every name the table does not list', () => {
    expect(kindOf('tm1SomethingFromALaterVersion')).toBe(DEFAULT_KIND);
  });

  it('is NOT transient — an unknown window is saved, not dropped on the floor', () => {
    expect(DEFAULT_KIND.transient).toBeUndefined();
  });

  it('has no way back — restoring it must report it, not open something wrong', () => {
    // The key is a `viewType`, not a command name; guessing an
    // `executeCommand` call from it opens nothing at best and the wrong
    // window at worst. Therefore: no `reopen`, and
    // `restoreFlow` reports the kind by name as not opened.
    expect(typeof DEFAULT_KIND.reopen).not.toBe('function');
  });

  it('names the window by its target, and by the raw kind when there is none', () => {
    expect(DEFAULT_KIND.label({ kind: 'tm1Future', target: 'Umsatz' })).toBe('Umsatz');
    expect(DEFAULT_KIND.label({ kind: 'tm1Future' })).toBe('tm1Future');
  });
});

/**
 * `kindOf` queries a table that is an object literal — and therefore has a
 * prototype.
 *
 * `WINDOW_KINDS[name] ?? DEFAULT_KIND` returns the PROTOTYPE member instead of
 * `undefined` for `name = 'toString'`; `??` does not kick in, and the next
 * access (`kind.label(w)` in `restoreFlow`) throws. A saved window
 * with `kind: "toString"` is enough for that — a string from the store that
 * nobody checked (review 2026-08-24, H4).
 */
describe('kindOf does not fall for the prototype chain', () => {
  it('returns DEFAULT_KIND for prototype names, not the prototype member', () => {
    for (const name of ['toString', 'valueOf', 'constructor', 'hasOwnProperty', '__proto__']) {
      expect(kindOf(name), name).toBe(DEFAULT_KIND);
    }
  });

  it('the result is always usable — `label` is a function', () => {
    // This is the access at which the restore run would otherwise break.
    expect(typeof kindOf('toString').label).toBe('function');
    expect(kindOf('toString').label({ kind: 'toString', target: 'X' })).toBe('X');
  });

  it('still finds real entries of the table', () => {
    const ersterEchter = Object.keys(WINDOW_KINDS)[0]!;
    expect(kindOf(ersterEchter)).toBe(WINDOW_KINDS[ersterEchter]);
  });
});

/**
 * Every host panel needs a line in WINDOW_KINDS (review 2026-10-03, A2).
 *
 * Without one it falls back to DEFAULT_KIND: the workbench stores it under
 * "Other" and restore reports "window type unknown". Thirteen-plus panels
 * went that way unnoticed, so the scan reads the `viewType` of every
 * `new WebviewPanelHost(` in production code — a string literal, or a
 * `const NAME = '...'` in the same file.
 */
describe('WINDOW_KINDS covers every WebviewPanelHost', () => {
  it('has no host viewType that falls back to DEFAULT_KIND', () => {
    const ROOT = path.resolve(__dirname, '..', '..', '..');
    const SRC = path.join(ROOT, 'src');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (path.relative(SRC, full) !== 'test') { walk(full); }
        } else if (full.endsWith('.ts')) {
          files.push(full);
        }
      }
    };
    walk(SRC);

    const viewTypes: string[] = [];
    const unresolved: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/new WebviewPanelHost(?:<[^(]*>)?\(\s*(?:'([^']+)'|(\w+))/g)) {
        if (m[1]) { viewTypes.push(m[1]); continue; }
        const c = new RegExp(`const ${m[2]}\\s*=\\s*'([^']+)'`).exec(text);
        if (c) { viewTypes.push(c[1]!); } else { unresolved.push(`${path.relative(ROOT, file)}: ${m[2]}`); }
      }
    }

    expect(unresolved).toEqual([]);
    // Sanity floor: a broken regex must not turn this into an empty pass.
    expect(viewTypes.length).toBeGreaterThan(30);
    expect(viewTypes.filter((v) => kindOf(v) === DEFAULT_KIND)).toEqual([]);
  });
});
