import { describe, it, expect } from 'vitest';
import { lintAllSections } from '../commands/processEditor/processEditorLint';
import type { Tm1Config } from '../tm1Rest/transport/types';

/**
 * Until 2026-08-31 the version check ran ONLY in the file check. In the
 * process editor the gear menu did offer the rule `v12-deprecated` for
 * switching off, but nobody ever reported it — a wire laid, but not
 * connected. This file pins both directions on this surface.
 */
type Posted = { type: string; section?: string; diagnostics?: Array<{ ruleId: string; line: number; message: string }> };

function lint(processData: { prolog: string; metadata: string; data: string; epilog: string }, config: Partial<Tm1Config> = {}): Posted[] {
  const posted: Posted[] = [];
  const panel = { webview: { postMessage: (m: Posted) => { posted.push(m); return Promise.resolve(true); } } };
  lintAllSections(panel, processData, { value: 1 }, config as Tm1Config);
  return posted;
}

function diagsOf(posted: Posted[], section = 'Prolog') {
  return posted.find(m => m.type === 'lintResults' && m.section === section)?.diagnostics ?? [];
}

const EMPTY = { prolog: '', metadata: '', data: '', epilog: '' };

describe('lintAllSections — version check in the process editor', () => {
  it('reports a function that only exists from v12 on against an 11.x target', () => {
    const d = diagsOf(lint({ ...EMPTY, prolog: "sA = 'x';\nsB = JsonGet(sA, '/a');" }));
    const hit = d.find(x => x.ruleId === 'v12-only');
    expect(hit).toBeTruthy();
    expect(hit?.line).toBe(2);
    expect(hit?.message).toMatch(/JsonGet/);
  });

  it('reports NO function dropped in v12 on an 11.x target', () => {
    const d = diagsOf(lint({ ...EMPTY, prolog: 'SaveDataAll;' }));
    expect(d.filter(x => x.ruleId === 'v12-deprecated')).toEqual([]);
  });

  it('reports the dropped function against a v12 target — even without parentheses', () => {
    const d = diagsOf(lint({ ...EMPTY, prolog: 'SaveDataAll;' }, { version: 'v12' }));
    const hit = d.find(x => x.ruleId === 'v12-deprecated');
    expect(hit).toBeTruthy();
    expect(hit?.line).toBe(1);
    expect(hit?.message).toMatch(/SaveDataAll/);
  });

  it('reports NO v12 function against a v12 target', () => {
    const d = diagsOf(lint({ ...EMPTY, prolog: "sB = JsonGet('{}', '/a');" }, { version: 'v12' }));
    expect(d.filter(x => x.ruleId === 'v12-only')).toEqual([]);
  });

  it('attaches the finding to the right section', () => {
    const posted = lint({ ...EMPTY, prolog: 'nA = 1;', epilog: "sB = JsonGet('{}', '/a');" });
    expect(diagsOf(posted, 'Prolog').filter(x => x.ruleId === 'v12-only')).toEqual([]);
    expect(diagsOf(posted, 'Epilog').filter(x => x.ruleId === 'v12-only')).toHaveLength(1);
  });
});
