// The run time columns and the run switcher in the call graph webview.
//
// Without a selected run the view must render as before — that is the
// initial state, and a process without runs in the log should look the same as it always has.
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', async () => await import('../__mocks__/vscode'));

import { getCallGraphHtml } from '../../references/callGraphWebview';
import type { CallGraphNode } from '../../references/callGraph';
import type { OverlayNode, EdgeTiming } from '../../references/runOverlayPure';
import type { RunOption } from '../../references/callGraphWebview';

const wurzel: CallGraphNode = {
  process: 'Load_All', incomingEdge: null, cycle: false,
  children: [{
    process: 'A', cycle: false, children: [],
    incomingEdge: {
      caller: 'Load_All', callee: 'A', section: 'prolog', line: 11,
      funcName: 'ExecuteProcess', snippet: '', params: [],
    },
  }],
};

function timing(elapsedSec: number | null, extra: Partial<EdgeTiming> = {}): EdgeTiming {
  return {
    elapsedSec, selfSec: null, pctOfRoot: 45, count: 1,
    occurrences: elapsedSec !== null ? [elapsedSec] : [],
    certainty: 'exact', status: 'ok', ...extra,
  };
}

const laeufe: RunOption[] = [
  { startedAt: '2026-08-26T07:00:09Z', elapsedSec: 4.04, status: 'ok' },
];

describe('without a selected run', () => {
  it('renders as before — no time column', () => {
    const html = getCallGraphHtml(wurzel, 'downstream', 'Load_All');
    // Check the rendered element: `.cg-time` also appears in the CSS block.
    expect(html).not.toContain('<span class="cg-time');
  });

  it('shows no times even with a run list, but without an overlay', () => {
    const html = getCallGraphHtml(wurzel, 'downstream', 'Load_All', undefined, undefined, laeufe);
    expect(html).not.toContain('<span class="cg-time');
  });
});

describe('with a selected run', () => {
  const overlay: OverlayNode = {
    timing: timing(4.04, { selfSec: 0.08, pctOfRoot: 100 }),
    children: [{ timing: timing(1.8), children: [], extra: [] }],
    extra: [],
  };

  it('shows run time and share per row', () => {
    const html = getCallGraphHtml(wurzel, 'downstream', 'Load_All', undefined, undefined, laeufe, overlay);
    expect(html).toContain('<span class="cg-time');
    expect(html).toContain('1,80');
    expect(html).toContain('45');
  });

  it('shows the self time at the root', () => {
    const html = getCallGraphHtml(wurzel, 'downstream', 'Load_All', undefined, undefined, laeufe, overlay);
    expect(html).toContain('0,08');
  });

  it('marks an edge that never ran', () => {
    const ohne: OverlayNode = {
      timing: timing(4.04), children: [{ timing: null, children: [], extra: [] }], extra: [],
    };
    const html = getCallGraphHtml(wurzel, 'downstream', 'Load_All', undefined, undefined, laeufe, ohne);
    expect(html).toContain('cg-never');
  });

  it('shows the loop with its count', () => {
    const loop: OverlayNode = {
      timing: timing(4.04),
      children: [{
        timing: timing(2.1, { count: 3, occurrences: [0.7, 0.71, 0.69], certainty: 'loop' }),
        children: [], extra: [],
      }],
      extra: [],
    };
    const html = getCallGraphHtml(wurzel, 'downstream', 'Load_All', undefined, undefined, laeufe, loop);
    expect(html).toContain('×3');
  });

  it('marks the undecidable case', () => {
    const amb: OverlayNode = {
      timing: timing(4.04),
      children: [{ timing: timing(2.1, { certainty: 'ambiguous' }), children: [], extra: [] }],
      extra: [],
    };
    const html = getCallGraphHtml(wurzel, 'downstream', 'Load_All', undefined, undefined, laeufe, amb);
    expect(html).toContain('cg-warn');
  });

  it('appends only measured calls as a row of their own', () => {
    const mitExtra: OverlayNode = {
      timing: timing(4.04),
      children: [{ timing: timing(1.8), children: [], extra: [] }],
      extra: [{ name: 'Recalc', timing: timing(0.31) }],
    };
    const html = getCallGraphHtml(wurzel, 'downstream', 'Load_All', undefined, undefined, laeufe, mitExtra);
    expect(html).toContain('Recalc');
    expect(html).toContain('cg-extra');
  });
});

describe('asynchrone Kanten', () => {
  const asyncOv: OverlayNode = {
    timing: timing(4.04),
    children: [{
      timing: timing(7393, { count: 3580, certainty: 'async', pctOfRoot: null }),
      children: [], extra: [],
    }],
    extra: [],
  };

  it('shows count and sum instead of a share', () => {
    const html = getCallGraphHtml(wurzel, 'downstream', 'Load_All', undefined, undefined, laeufe, asyncOv);
    expect(html).toContain('3580');
    expect(html).toContain('cg-async');
  });

  it('zeigt KEINE Gleichzeitigkeitszahl', () => {
    // The log only writes start and end — a thread waiting on a lock
    // looks exactly like a computing one there. The number could not be backed up.
    const html = getCallGraphHtml(wurzel, 'downstream', 'Load_All', undefined, undefined, laeufe, asyncOv);
    expect(html).not.toMatch(/gleichzeitig|concurrent/i);
  });
});

describe('switcher in the header', () => {
  it('shows the field with the runs', () => {
    const html = getCallGraphHtml(wurzel, 'downstream', 'Load_All', undefined, undefined, laeufe);
    expect(html).toContain('id="run-select"');
    expect(html).toContain('4,04');
  });

  it('can also be operated on the callers tab', () => {
    // The runs belong to the process, not to the viewing direction. Precisely the
    // call graph of a subprocess without calls of its own has its only useful
    // information there.
    const html = getCallGraphHtml(wurzel, 'upstream', 'Load_All', undefined, undefined, laeufe);
    expect(html).toContain('id="run-select"');
    expect(html).not.toMatch(/id="run-select"[^>]*disabled/);
  });

  it('is missing entirely when there are no runs', () => {
    const html = getCallGraphHtml(wurzel, 'downstream', 'Load_All', undefined, undefined, []);
    expect(html).not.toContain('id="run-select"');
  });
});

describe('Theme-Treue', () => {
  const html = getCallGraphHtml(wurzel, 'downstream', 'Load_All', undefined, undefined, laeufe);

  it('colors the dropdown via VS Code tokens, not via browser defaults', () => {
    // Without these tokens the select shows up WHITE in every dark theme.
    expect(html).toContain('--vscode-dropdown-background');
    expect(html).toContain('--vscode-dropdown-foreground');
    expect(html).toContain('--vscode-dropdown-border');
  });

  it('also colors the option list — the operating system draws it', () => {
    expect(html).toMatch(/\.cg-runs option\s*\{[^}]*--vscode-dropdown-background/);
  });

  it('uses no fixed color anywhere in the run time columns', () => {
    const block = html.slice(html.indexOf('.cg-cols'), html.indexOf('.cg-runs'));
    expect(block).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});

describe('Spaltenaufbau', () => {
  const overlay: OverlayNode = {
    timing: timing(4.04, { selfSec: 0.08, pctOfRoot: 100 }),
    children: [{ timing: timing(1.8, { pctOfRoot: 45 }), children: [], extra: [] }],
    extra: [],
  };
  const html = getCallGraphHtml(wurzel, 'downstream', 'Load_All', undefined, undefined, laeufe, overlay);

  it('puts the numbers into ONE group instead of pushing them to the right individually', () => {
    expect(html).toContain('<span class="cg-cols">');
    // Only the group is pushed, not each column on its own.
    expect(html.slice(html.indexOf('.cg-cols'), html.indexOf('.cg-time'))).toContain('margin-left: auto');
  });

  it('also shows the share as a bar', () => {
    expect(html).toMatch(/<span class="cg-bar"[^>]*><i style="width:45%">/);
  });

  it('keeps the columns at a fixed width so that they line up below each other', () => {
    const css = html.slice(html.indexOf('.cg-time {'), html.indexOf('.cg-bar {'));
    expect(css).toMatch(/flex:\s*0 0 \d+px/);
    expect(css).toMatch(/text-align:\s*right/);
  });

  it('gives the number group a fixed PIXEL width, not a percentage one', () => {
    // The tree levels indent by 10px each. A percentage value would end up a few
    // pixels off at every depth — the numbers would not line up.
    const css = html.slice(html.indexOf('.cg-cols {'), html.indexOf('.cg-time {'));
    expect(css).toMatch(/flex:\s*0 0 \d+px/);
    expect(css).not.toMatch(/flex:\s*0 0 \d+%/);
  });
});

describe('Aufrufer-Ansicht', () => {
  it('marks the caller as the origin without inventing a time', () => {
    const ov: OverlayNode = {
      timing: timing(2.5, { selfSec: 2.5, pctOfRoot: 100 }),
      children: [{
        timing: { elapsedSec: null, selfSec: null, pctOfRoot: null, count: 1, occurrences: [], certainty: 'exact', status: 'ok' },
        children: [], extra: [],
      }],
      extra: [],
    };
    const html = getCallGraphHtml(wurzel, 'upstream', 'Load_All', undefined, undefined, laeufe, ov);
    expect(html).toContain('cg-origin');
    // No seconds figure on the caller row.
    expect(html).not.toMatch(/cg-origin[^>]*>[^<]*\d,\d\d s/);
  });
});
