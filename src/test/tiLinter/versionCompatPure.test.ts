import { describe, it, expect } from 'vitest';
import {
  findVersionIncompatibleCalls,
  V12_DEPRECATED,
  V12_ONLY,
  V12_REPLACEMENTS,
} from '../../tiLogicVisualizer/tiLinter/versionCompatPure';

describe('V12_ONLY map', () => {
  it('is not empty and carries lowercase keys', () => {
    expect(V12_ONLY.size).toBeGreaterThan(0);
    for (const key of V12_ONLY.keys()) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it('does not overlap with the functions removed in v12', () => {
    // A function cannot both exist only from v12 onwards and have been removed
    // in v12 — an overlap would be a maintenance error in
    // tiSignatures.ts that nobody would otherwise notice.
    const both = [...V12_ONLY.keys()].filter(k => V12_DEPRECATED.has(k));
    expect(both).toEqual([]);
  });
});

describe('findVersionIncompatibleCalls — target v11 (the opposite direction)', () => {
  const sampleKey = [...V12_ONLY.keys()][0];
  const sampleName = V12_ONLY.get(sampleKey)!;

  it('reports a function that only exists from v12 onwards on an 11.x target', () => {
    const hits = findVersionIncompatibleCalls(`nX = ${sampleName}();`, 'v11');
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('v12-only');
    expect(hits[0].name).toBe(sampleName);
    expect(hits[0].line).toBe(0);
    expect(hits[0].startCol).toBe(5);
    expect(hits[0].endCol).toBe(5 + sampleName.length);
  });

  it('reports it even without parentheses', () => {
    expect(findVersionIncompatibleCalls(`${sampleName};`, 'v11')).toHaveLength(1);
  });

  it('does NOT report it when the target is v12', () => {
    expect(findVersionIncompatibleCalls(`nX = ${sampleName}();`, 'v12')).toEqual([]);
  });

  it('does NOT report the functions removed in v12 on an 11.x target', () => {
    // On 11.x they are perfectly fine — that is the point of this direction.
    expect(findVersionIncompatibleCalls('SaveDataAll;', 'v11')).toEqual([]);
    expect(findVersionIncompatibleCalls('SaveDataAll;', 'v12')).toHaveLength(1);
  });

  it('stays out of strings and comments', () => {
    expect(findVersionIncompatibleCalls(`s = '${sampleName}()';`, 'v11')).toEqual([]);
    expect(findVersionIncompatibleCalls(`# ${sampleName}()`, 'v11')).toEqual([]);
    expect(findVersionIncompatibleCalls(`602,"${sampleName}"`, 'v11')).toEqual([]);
  });

  it('does NOT report a longer identifier with the same beginning', () => {
    expect(findVersionIncompatibleCalls(`n${sampleName} = 1;`, 'v11')).toEqual([]);
    expect(findVersionIncompatibleCalls(`${sampleName}X;`, 'v11')).toEqual([]);
  });

  it('counts lines from 0 and finds several hits per line', () => {
    const text = `# Kopf\nnX = ${sampleName}(); nY = ${sampleName}();`;
    const hits = findVersionIncompatibleCalls(text, 'v11');
    expect(hits).toHaveLength(2);
    expect(hits.every(h => h.line === 1)).toBe(true);
  });
});

describe('findVersionIncompatibleCalls — Ziel v12', () => {
  it('passes along the v12 successor where IBM names one', () => {
    const [key, replacement] = [...V12_REPLACEMENTS.entries()][0];
    const name = V12_DEPRECATED.get(key)!;
    const hits = findVersionIncompatibleCalls(`${name}();`, 'v12');
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('deprecated-in-v12');
    expect(hits[0].replacement).toBe(replacement);
  });

  it('omits replacement where none is named', () => {
    const withoutReplacement = [...V12_DEPRECATED.keys()].find(k => !V12_REPLACEMENTS.has(k));
    if (!withoutReplacement) { return; }
    const name = V12_DEPRECATED.get(withoutReplacement)!;
    const hits = findVersionIncompatibleCalls(`${name}();`, 'v12');
    expect(hits[0].replacement).toBeUndefined();
  });

  it('sets no replacement for the opposite direction', () => {
    const sampleName = V12_ONLY.get([...V12_ONLY.keys()][0])!;
    const hits = findVersionIncompatibleCalls(`${sampleName};`, 'v11');
    expect(hits[0].replacement).toBeUndefined();
  });
});
