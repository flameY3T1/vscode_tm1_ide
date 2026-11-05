/**
 * Enter in the name field must complete the dialog (flameY3T1, 2026-09-15).
 *
 * No gate checks the effect itself — it lives in the renderer. What is pinned here
 * is the wire: every name field that has a confirm button needs
 * an Enter handler. `saveMode.ts` already carried the claim as a comment
 * ("Enter accepts it"), without a handler — exactly this gap is what the scan catches.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

/** Name field → file in which its Enter handler must live. */
const WIRED: Array<[field: string, file: string]> = [
  ['view-save-name', 'src/webviewClient/cubeViewerMonaco/viewSave.ts'],
  ['save-name', 'src/webviewClient/dimensionBrowser/saveMode.ts'],
  ['nu-name', 'src/webviewClient/securityUserGroup/index.ts'],
  ['ng-name', 'src/webviewClient/securityUserGroup/index.ts'],
  ['sp-password', 'src/webviewClient/securityUserGroup/index.ts'],
  ['wbname', 'src/webviewClient/workbenchPicker/index.ts'],
  ['new-attr-name', 'src/webviewClient/dimensionEditor/dom.ts'],
  ['cubeName', 'src/webviewClient/createCube/index.ts'],
];

/**
 * Dialog → the piece that carries its Escape cancel (flameY3T1, 2026-09-18).
 *
 * LIMIT of this list: it checks the dialogs NAMED here, not "all". A
 * new dialog without Escape does not fail — it is just missing. A source scan
 * over all dialogs would be the better gate, but it fails because a
 * dialog has no recognisable marker: sometimes a `<dialog>`, sometimes a `<div>` with
 * a class, sometimes an HTML string in the host. Whoever builds one adds it
 * here — and finds the building blocks in `docs/architecture/webview-templates.md`
 * under `_shared/`.
 */
const ESC_WIRED: Array<[dialog: string, file: string, token: string]> = [
  ['view save', 'src/webviewClient/cubeViewerMonaco/viewSave.ts', 'escCloses(d.modal'],
  ['subset save', 'src/webviewClient/dimensionBrowser/saveMode.ts', "escCloses(document.getElementById('save-modal')"],
  ['subset MDX popup', 'src/webviewClient/dimensionBrowser/domMdxModal.ts', 'escCloses(_mdxOverlay'],
  ['new user/group/password', 'src/webviewClient/securityUserGroup/index.ts', 'escCloses($(id)'],
  ['bulk add', 'src/webviewClient/dimensionEditor/dom.ts', "escCloses(document.getElementById('bulk-modal')"],
  ['attribute list', 'src/webviewClient/dimensionEditor/dom.ts', "escCloses(document.getElementById('attr-modal')"],
  ['create cube', 'src/webviewClient/createCube/index.ts', "e.key !== 'Escape'"],
  ['workbench save', 'src/webviewClient/workbenchPicker/index.ts', "e.key !== 'Escape'"],
  ['new process wizard', 'src/webviewClient/newProcess/index.ts', "e.key !== 'Escape'"],
  // Since 2026-09-20 via the shared helper instead of by hand (finding D6).
  ['cube viewer MDX popup', 'src/webviewClient/cubeViewerMonaco/mdxView.ts', 'escCloses(overlay'],
  ['dimension editor prompt', 'src/webviewClient/dimensionEditor/modals.ts', 'escCloses(modal'],
];

describe('Escape cancels the same dialogs', () => {
  it.each(ESC_WIRED)('%s is abortable with Escape (%s)', (_dialog, file, token) => {
    expect(readFileSync(join(ROOT, file), 'utf8')).toContain(token);
  });

  it('closes an open modal from the capture phase, so a focused input cannot swallow the key', () => {
    const helper = readFileSync(join(ROOT, 'src/webviewClient/_shared/escCloses.ts'), 'utf8');
    expect(helper).toMatch(/addEventListener\('keydown'[\s\S]*?\}, true\)/);
    expect(helper).toContain('stopImmediatePropagation');
  });
});

describe('Enter confirms name dialogs', () => {
  it.each(WIRED)('%s has an Enter handler in %s', (field, file) => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    expect(source).toContain(field);
    expect(source).toMatch(/keydown|onkeydown/);
    expect(source).toMatch(/key\s*!?==+\s*'Enter'/);
  });

  it('routes Enter through the confirm button, so a disabled one still refuses', () => {
    for (const file of new Set(WIRED.map(([, f]) => f))) {
      expect(readFileSync(join(ROOT, file), 'utf8')).toMatch(/\.click\(\)/);
    }
  });
});
