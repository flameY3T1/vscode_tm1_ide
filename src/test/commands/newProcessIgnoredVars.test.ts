/**
 * The new-process wizard is the third form for a data source (besides
 * the process editor and the `.pro` wizard removed on 2026-08-30). It
 * lacked the same two things:
 *
 *  - "Skip Calc." in the view step. The label is made up — TM1 knows no skip
 *    flags on a data source (measured live, see docs/architecture/tm1-rest-quirks.md) — and the
 *    value went into `NumberOfHeaderRecordsToSkip`, that is, into the header record count.
 *  - The ignored marker for source columns.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { toApiVariables, toApiDataSource } from '../../commands/processEditor/newProcessPure';
import { buildWizardHtml } from '../../commands/processEditor/newProcessWebview';

describe('New-process wizard', () => {
  it('carries the ignored marker into the REST list', () => {
    const out = toApiVariables([
      { name: 'vsA', type: 2, position: 1 },
      { name: 'vsB', type: 2, position: 2, ignored: true },
    ]);
    expect(out[0]).not.toHaveProperty('Ignored');
    expect(out[1]).toMatchObject({ Name: 'vsB', Ignored: true });
  });

  it('no longer knows "Skip Calc.", but has an ignore column instead', () => {
    const html = buildWizardHtml([], [], [], [], '', 'newProcess.js');
    expect(html).not.toContain('skipCalc');
    expect(html).not.toContain('Skip Calc');
    // The variable rows are built by the bundle since 2026-10.
    expect(readFileSync(join(__dirname, '../../webviewClient/newProcess/index.ts'), 'utf8')).toContain('class="vign"');
  });

  it('a view source no longer sends a header record count', () => {
    const ds = toApiDataSource({
      dsType: 'VIEW', datasourceName: 'Cube', viewSubsetName: 'v1',
    } as never) as unknown as Record<string, unknown>;
    expect(ds).not.toHaveProperty('NumberOfHeaderRecordsToSkip');
    expect(ds).not.toHaveProperty('asciiHeaderRecords');
  });
});

describe('New-process wizard — document skeleton (B7)', () => {
  it('carries CSP and nonce, no unsafe-inline', () => {
    const html = buildWizardHtml(['Cube'], ['Dim'], [], ['DSN'], 'vscode-webview:', 'newProcess.js');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("default-src 'none'");
    expect(html).toMatch(/script-src 'nonce-[A-Za-z0-9]+'/);
    expect(html).not.toContain("script-src 'unsafe-inline'");
  });

  it('no longer knows attribute handlers', () => {
    const html = buildWizardHtml(['Cube'], ['Dim'], [{ id: 't', name: 'T', description: 'd' }], [], 'vscode-webview:', 'newProcess.js');
    expect(html).not.toMatch(/\son(click|input|change|blur|keydown)=/);
  });

  it('colors the selection lists according to the theme', () => {
    // Without its own rule, the renderer paints them in the operating system's colors
    // — in a dark theme that means white, as soon as JS loads entries afterwards.
    expect(buildWizardHtml([], [], [], [], 'vscode-webview:', 'newProcess.js'))
      .toContain('--vscode-dropdown-background');
  });
});

describe('New-process wizard — labels of the source kinds', () => {
  // The wizard came from the `.pro` world and showed its names (VIEW,
  // SUBSET, CHARACTERDELIMITED), the process editor the ones delivered by TM1
  // (TM1CubeView, TM1DimensionSubset, ASCII). The same five things, two
  // words — depending on which window you open.
  const html = buildWizardHtml([], [], [], [], 'vscode-webview:', 'newProcess.js');

  it('shows the names of the process editor', () => {
    for (const label of ['None', 'ASCII', 'ODBC', 'TM1CubeView', 'TM1DimensionSubset']) {
      expect(html).toContain(`>${label}</option>`);
    }
  });

  it('keeps the .pro values internally that the sections listen to', () => {
    expect(html).toContain('<option value="VIEW">TM1CubeView</option>');
    expect(html).toContain('<option value="SUBSET">TM1DimensionSubset</option>');
    expect(html).toContain('<option value="CHARACTERDELIMITED">ASCII</option>');
    expect(html).toContain('id="dssec-VIEW"');
    expect(html).toContain('id="dssec-SUBSET"');
    expect(html).toContain('id="dssec-CHARACTERDELIMITED"');
  });
});

describe('New-process wizard — template step with the keyboard', () => {
  // Since the tiles carry `tabindex`, focus can move to another
  // template via Tab. A `<div>` triggers NO native `click` on Enter, so the
  // click handler does not select — without the grab in the Enter handler
  // the wizard would continue with the previous selection (by default:
  // the empty process).
  // The handler lives in the bundle source since 2026-10.
  const src = readFileSync(join(__dirname, '../../webviewClient/newProcess/index.ts'), 'utf8');

  it('takes over the focused tile before Enter advances', () => {
    const handler = src.slice(src.indexOf("if (e.key !== 'Enter')"));
    const griff = handler.indexOf("contains('tpl-item')");
    const weiter = handler.indexOf('nextStep()');
    expect(griff).toBeGreaterThan(-1);
    expect(griff).toBeLessThan(weiter);
    expect(handler.slice(griff, weiter)).toContain('selectTpl(t)');
  });
});
