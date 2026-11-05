import { describe, it, expect } from 'vitest';
import { lintAllSections } from '../commands/processEditor/processEditorLint';
import type { Tm1Config } from '../tm1Rest/transport/types';

/**
 * Suppression is only useful if it reaches the surface — a green unit test
 * says nothing about that. This file pits the process editor's real lint run
 * against the comments.
 */
type Posted = { type: string; section?: string; diagnostics?: Array<{ ruleId: string; line: number; message: string }> };

function lint(prolog: string, config: Partial<Tm1Config> = {}): Array<{ ruleId: string; line: number; message: string }> {
  const posted: Posted[] = [];
  const panel = { webview: { postMessage: (m: Posted) => { posted.push(m); return Promise.resolve(true); } } };
  lintAllSections(panel, { prolog, metadata: '', data: '', epilog: '' }, { value: 1 }, config as Tm1Config);
  return posted.find(m => m.type === 'lintResults' && m.section === 'Prolog')?.diagnostics ?? [];
}

describe('lintAllSections — line suppression', () => {
  it('reports the finding without a comment (counter-check)', () => {
    const d = lint("sA = 'x';\nsB = JsonGet(sA, '/a');");
    expect(d.some(x => x.ruleId === 'v12-only')).toBe(true);
  });

  it('stays silent with `disable` on the same line', () => {
    const d = lint("sA = 'x';\nsB = JsonGet(sA, '/a'); # tm1lint: disable=v12-only");
    expect(d.some(x => x.ruleId === 'v12-only')).toBe(false);
  });

  it('stays silent with `disable-next-line` on the line before', () => {
    const d = lint("sA = 'x';\n# tm1lint: disable-next-line=v12-only\nsB = JsonGet(sA, '/a');");
    expect(d.some(x => x.ruleId === 'v12-only')).toBe(false);
  });

  it('hits only the named rule, not its neighbours', () => {
    // Line 2 carries two findings: the version check and the undefined
    // variable. The comment names only one of them.
    const code = "sB = JsonGet(sNieDefiniert, '/a'); # tm1lint: disable=v12-only";
    const d = lint(code);
    expect(d.some(x => x.ruleId === 'v12-only')).toBe(false);
    expect(d.some(x => x.ruleId === 'undefined-variable')).toBe(true);
  });

  it('stays completely silent without a rule list', () => {
    const d = lint("sB = JsonGet(sNieDefiniert, '/a'); # tm1lint: disable");
    expect(d.filter(x => x.line === 1)).toEqual([]);
  });

  it('also suppresses a parser error', () => {
    const d = lint('nA = 1;\n???; # tm1lint: disable=parse-error');
    expect(d.some(x => x.ruleId === 'parse-error')).toBe(false);
  });

  it('stays on its own line', () => {
    const d = lint("sA = JsonGet('{}', '/a'); # tm1lint: disable=v12-only\nsB = JsonGet('{}', '/b');");
    const hits = d.filter(x => x.ruleId === 'v12-only');
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
  });
});
