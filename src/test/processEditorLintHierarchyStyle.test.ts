import { describe, it, expect } from 'vitest';
import { lintAllSections } from '../commands/processEditor/processEditorLint';
import type { Tm1Config } from '../tm1Rest/transport/types';

/**
 * `hierarchy-style-mixed` on the process editor surface.
 *
 * The pure module is tested on its own; this is about the wiring: that the
 * findings land in the window response at all, that the mix is decided ACROSS
 * SECTION BOUNDARIES (the hierarchy form is often in the Prolog, the blind call
 * in the Data section) and that Bedrock is left out. No test of the pure module
 * catches exactly these three things.
 *
 * Template and occasion: `processEditorLintVersionCompat.test.ts` — there the
 * wire had been laid but not connected, and nobody noticed.
 */
type Posted = { type: string; section?: string; diagnostics?: Array<{ ruleId: string; line: number; message: string }> };

function lint(
  processData: { prolog: string; metadata: string; data: string; epilog: string; processName?: string },
  config: Partial<Tm1Config> = {},
): Posted[] {
  const posted: Posted[] = [];
  const panel = { webview: { postMessage: (m: Posted) => { posted.push(m); return Promise.resolve(true); } } };
  lintAllSections(panel, processData, { value: 1 }, config as Tm1Config);
  return posted;
}

function diagsOf(posted: Posted[], section = 'Prolog') {
  return posted.find(m => m.type === 'lintResults' && m.section === section)?.diagnostics ?? [];
}

const EMPTY = { prolog: '', metadata: '', data: '', epilog: '' };

describe('lintAllSections — hierarchy awareness', () => {
  it('stays silent when the dimension form is used throughout', () => {
    const d = diagsOf(lint({ ...EMPTY, prolog: "nZ = DIMSIZ('Kunde');\nsP = ELPAR('Kunde', sK, 1);" }));
    expect(d.filter(x => x.ruleId === 'hierarchy-style-mixed')).toEqual([]);
  });

  it('reports the blind call as soon as the process names a hierarchy', () => {
    const d = diagsOf(lint({
      ...EMPTY,
      prolog: "nD = HierarchyElementExists('Kunde', 'Region', sK);\nnZ = DIMSIZ('Kunde');",
    }));
    const hit = d.find(x => x.ruleId === 'hierarchy-style-mixed');
    expect(hit).toBeTruthy();
    expect(hit?.line).toBe(2);
    expect(hit?.message).toMatch(/DIMSIZ/);
    expect(hit?.message).toMatch(/ElementCount/);
  });

  it('decides the mix across section boundaries', () => {
    // Hierarchy form in the Prolog, blind call in the Data section. If each
    // section were counted separately, neither of them would see a mix.
    const posted = lint({
      ...EMPTY,
      prolog: "nD = HierarchyElementExists('Kunde', 'Region', sK);",
      data: "nZ = DIMSIZ('Kunde');",
    });
    expect(diagsOf(posted, 'Prolog').filter(x => x.ruleId === 'hierarchy-style-mixed')).toEqual([]);
    const dData = diagsOf(posted, 'Data').filter(x => x.ruleId === 'hierarchy-style-mixed');
    expect(dData).toHaveLength(1);
    expect(dData[0].line).toBe(1);
  });

  it('keeps the line within the section, not in the whole text', () => {
    const posted = lint({
      ...EMPTY,
      prolog: "nA = 1;\nnB = 2;\nnD = HierarchyElementExists('Kunde', 'Region', sK);",
      epilog: "nZ = DIMSIZ('Kunde');",
    });
    const d = diagsOf(posted, 'Epilog').filter(x => x.ruleId === 'hierarchy-style-mixed');
    expect(d).toHaveLength(1);
    expect(d[0].line).toBe(1);
  });

  it('does not take the default hierarchy in long form for a hierarchy reference', () => {
    // On the real model this was the only source of false reports.
    const d = diagsOf(lint({
      ...EMPTY,
      prolog: "ElementAttrInsert(csDim, csDim, '', 'SITENAME', 'A');\nDimensionElementInsert(csDim, '', sEl, 'N');",
    }));
    expect(d.filter(x => x.ruleId === 'hierarchy-style-mixed')).toEqual([]);
  });

  it('leaves out the Bedrock library', () => {
    const gemischt = {
      ...EMPTY,
      prolog: "nD = HierarchyElementExists('Kunde', 'Region', sK);\nnZ = DIMSIZ('Kunde');",
    };
    expect(diagsOf(lint({ ...gemischt, processName: 'Eigener_Prozess' }))
      .filter(x => x.ruleId === 'hierarchy-style-mixed')).toHaveLength(1);
    expect(diagsOf(lint({ ...gemischt, processName: '}bedrock.hier.clone' }))
      .filter(x => x.ruleId === 'hierarchy-style-mixed')).toEqual([]);
  });
});
