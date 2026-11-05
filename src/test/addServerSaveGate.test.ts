// The "test first, then save" lock applies to an instance, not to an
// admin server.
//
// An instance profile stores credentials and a connection that is about to be
// established — there the probe is the price. An admin server entry carries
// a name, a URL and a checkmark; a wrong URL costs nothing except an
// error child when expanding. With the lock, an admin server whose
// machine happened to be down could not even be renamed — the old path via two
// input boxes did not have this hurdle.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSaveDisabled, saveRunsTestFirst } from '../webviewClient/addServer/protocol';

describe('isSaveDisabled', () => {
  it('Save is clickable once the form is complete, tested or not', () => {
    expect(isSaveDisabled({ busy: false, valid: true })).toBe(false);
  });

  it('locks as long as the form is incomplete', () => {
    expect(isSaveDisabled({ busy: false, valid: false })).toBe(true);
  });

  it('locks while an operation is running', () => {
    expect(isSaveDisabled({ busy: true, valid: true })).toBe(true);
  });
});

describe('saveRunsTestFirst', () => {
  it('an untested instance probes before it is saved', () => {
    expect(saveRunsTestFirst({ testedOk: false, adminKind: false })).toBe(true);
    expect(saveRunsTestFirst({ testedOk: true, adminKind: false })).toBe(false);
  });

  it('an admin server saves without a probe', () => {
    expect(saveRunsTestFirst({ testedOk: false, adminKind: true })).toBe(false);
  });
});

describe('wiring', () => {
  // The webview file cannot run without a DOM; that the pure rules are really
  // used there is therefore checked by a source scan.
  it('uses the rules instead of its own calculation', () => {
    const src = readFileSync(
      join(__dirname, '..', 'webviewClient', 'addServer', 'index.ts'), 'utf8');
    expect(src).toContain('isSaveDisabled');
    expect(src).toContain('saveRunsTestFirst');
    expect(src).not.toMatch(/btn-save[\s\S]{0,120}!testedOk/);
  });
});
