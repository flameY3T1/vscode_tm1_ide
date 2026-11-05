import { describe, it, expect } from 'vitest';
import {
  renderWorkbenchPickerBody, WORKBENCH_PICKER_CSS, type PickerContext,
} from '../../commands/workbench/workbenchPickerHtml';

const LABELS = {
  name: 'Name', save: 'Save', cancel: 'Cancel', other: 'Other',
  counter: '{0} of {1} selected · {2} possible',
  nameLabel: 'Name', overwrite: 'Overwrite', all: 'All', none: 'None',
  existing: 'Already saved here', server: 'Server',
  notOpen: 'not open', editing: 'Editing',
};

const CTX: PickerContext = { serverName: 'PROD', existingNames: [] };

const cand = (over = {}) => ({
  id: 'c0', kind: 'tm1CubeViewer', group: 'Cube Viewer', label: 'Reporting',
  saved: { kind: 'tm1CubeViewer', target: 'Reporting' },
  checked: true, open: true, ...over,
});

const render = (cands = [cand()], ctx: PickerContext = CTX) =>
  renderWorkbenchPickerBody(cands, LABELS, ctx);

describe('renderWorkbenchPickerBody', () => {
  it('groups by the kind group', () => {
    const html = render([cand(), cand({ id: 'c1', group: 'Other', label: 'Message Log' })]);
    expect(html).toContain('Cube Viewer');
    expect(html).toContain('Other');
  });

  it('preselects every candidate', () => {
    expect(render()).toContain('checked');
  });

  // ── Edit mode ──────────────────────────────────────────────────────────
  // When editing, the existing content and the suggestion stand side by side. The
  // checkmark says what is included — it must no longer be hard-coded in the markup.

  it('leaves an unchecked candidate unchecked', () => {
    expect(render([cand({ checked: false })])).not.toContain('checked');
  });

  it('notes an entry that is not open', () => {
    expect(render([cand({ open: false })])).toContain('not open');
    expect(render([cand({ open: true })])).not.toContain('not open');
  });

  it('prefills the name and header line when editing', () => {
    const html = render([cand()], { serverName: 'PROD', existingNames: ['Montag'], editingName: 'Montag' });
    expect(html).toContain('value="Montag"');
    expect(html).toContain('Editing');
  });

  it('does NOT consider its own name a conflict', () => {
    // Otherwise the button would always say "Overwrite" when editing and the
    // field would be permanently highlighted.
    const html = render([cand()], { serverName: 'PROD', existingNames: ['Montag', 'Di'], editingName: 'Montag' });
    const cfg = JSON.parse(html.match(/id="wbcfg">([^<]*)</)![1].replace(/\u003c/g, '<'));
    expect(cfg.existing).toEqual(['Di']);
    expect(cfg.name).toBe('Montag');
  });

  it('shows the preview line when there is one', () => {
    const html = render([cand({ description: 'view "GuV"' })]);
    expect(html).toContain('view &quot;GuV&quot;');
  });

  it('escapes a label that contains markup', () => {
    const html = render([cand({ label: '<img src=x>' })]);
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
  });

  it('also escapes the single quote', () => {
    // Today all attributes are in double quotes, so the `'` is
    // harmless — but `esc` is a general helper function, and the
    // next single-quoted spot would be a hole.
    const html = render([cand({ label: "O'Brien" })]);
    expect(html).not.toContain("O'Brien");
    expect(html).toContain('O&#39;Brien');
  });

  // ── Server reference ───────────────────────────────────────────
  // The window did not say WHAT it is saving FOR. Anyone with two servers open
  // could only guess the name — and the name conflict only popped up as a
  // modal after the click.

  it('names the server it is saving for', () => {
    expect(render()).toContain('PROD');
  });

  it('shows the workbenches that already exist on this server', () => {
    const html = render([cand()], { serverName: 'PROD', existingNames: ['Montag', 'Abschluss'] });
    expect(html).toContain('Montag');
    expect(html).toContain('Abschluss');
  });

  it('also escapes the names of existing workbenches', () => {
    const html = render([cand()], { serverName: 'PROD', existingNames: ['<b>x</b>'] });
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('passes the existing names to the script so the conflict shows up while typing', () => {
    const html = render([cand()], { serverName: 'PROD', existingNames: ['Montag'] });
    const cfg = JSON.parse(html.match(/id="wbcfg">([^<]*)</)![1].replace(/\\u003c/g, '<'));
    expect(cfg.existing).toEqual(['Montag']);
    expect(cfg.overwrite).toBe('Overwrite');
    expect(cfg.save).toBe('Save');
  });

  // ── Overview ───────────────────────────────────────────────────

  it('shows the count per group', () => {
    const html = render([cand(), cand({ id: 'c1', label: 'Absatz' })]);
    expect(html).toMatch(/Cube Viewer[\s\S]{0,80}wbgcount[^>]*>2</);
  });

  it('gives every group All/None', () => {
    const html = render();
    expect(html).toContain('data-group-all');
    expect(html).toContain('data-group-none');
  });

  // ── Name field ─────────────────────────────────────────────────

  it('labels the name field visibly, not just as a placeholder', () => {
    expect(render()).toContain('for="wbname"');
  });
});

// Counter, conflict, Enter/Escape: workbenchPickerBundle.test.ts runs the built bundle.

describe('WORKBENCH_PICKER_CSS', () => {
  // Previously there was only `button { cursor: pointer }` — that is, the
  // browser default WITHOUT any theme token. Hence the white button that was
  // unreadable in dark themes.
  it('colours the Save button from the theme tokens', () => {
    expect(WORKBENCH_PICKER_CSS).toContain('--vscode-button-background');
    expect(WORKBENCH_PICKER_CSS).toContain('--vscode-button-foreground');
    expect(WORKBENCH_PICKER_CSS).toContain('--vscode-button-hoverBackground');
  });

  it('gives the Cancel button the secondary style', () => {
    expect(WORKBENCH_PICKER_CSS).toContain('--vscode-button-secondaryBackground');
  });

  it('leaves no button without colour', () => {
    // A bare `button { … }` without a background falls back to the browser
    // default — exactly the bug being fixed.
    const bare = /(^|\})\s*button\s*\{([^}]*)\}/g;
    for (const m of WORKBENCH_PICKER_CSS.matchAll(bare)) {
      expect(m[2]).toMatch(/background|color/);
    }
  });

  it('caps the width of the name field', () => {
    expect(WORKBENCH_PICKER_CSS).toMatch(/#wbname[^}]*max-width/);
  });
});
