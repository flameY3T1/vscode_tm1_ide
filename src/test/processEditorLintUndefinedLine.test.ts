import { describe, it, expect } from 'vitest';
import { lintAllSections } from '../commands/processEditor/processEditorLint';
import type { Tm1Config } from '../tm1Rest/transport/types';

describe('lintAllSections — undefined-variable line anchoring', () => {
  it('anchors the diagnostic to the real usage line, not line 1', () => {
    const posted: Array<{ type: string; section?: string; diagnostics?: Array<{ ruleId: string; line: number; message: string }> }> = [];
    const panel = { webview: { postMessage: (m: typeof posted[number]) => { posted.push(m); return Promise.resolve(true); } } };

    const processData = {
      // `SomeUndefinedVar` is first read on line 3 — the diagnostic must land there.
      prolog: 'x = 1;\ny = 2;\nz = SomeUndefinedVar;',
      metadata: '',
      data: '',
      epilog: '',
    };

    lintAllSections(panel, processData, { value: 1 }, {} as Tm1Config);

    const prologMsg = posted.find(m => m.type === 'lintResults' && m.section === 'Prolog');
    expect(prologMsg).toBeTruthy();
    const undef = prologMsg?.diagnostics?.find(d => d.ruleId === 'undefined-variable' && /SomeUndefinedVar/i.test(d.message));
    expect(undef).toBeTruthy();
    expect(undef?.line).toBe(3);
  });
});
