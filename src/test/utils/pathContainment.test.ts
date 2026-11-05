import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { isContainedIn } from '../../utils/pathContainment';

/**
 * Guard before the recursive delete in the TI test tree.
 *
 * `tm1.tests.rootFolder` carries no `scope`, so it is window-wide and can
 * come from the `.vscode/settings.json` of a foreign workspace; in addition,
 * an absolute value is taken over unchanged and a relative one may contain `..`.
 * The confirmation dialog does not protect against that.
 */
describe('isContainedIn', () => {
  const root = path.resolve('/tmp/tm1tests');

  it('accepts a child and a grandchild', () => {
    expect(isContainedIn(root, path.join(root, 'suite'))).toBe(true);
    expect(isContainedIn(root, path.join(root, 'suite', 'case', 'data'))).toBe(true);
  });

  // Otherwise a delete would wipe out the whole test tree, even though the user chose an
  // entry INSIDE it.
  it('does not accept the root itself', () => {
    expect(isContainedIn(root, root)).toBe(false);
    expect(isContainedIn(root, path.join(root, '.'))).toBe(false);
  });

  it('rejects a sibling, a parent and an escape through ..', () => {
    expect(isContainedIn(root, path.resolve('/tmp/other'))).toBe(false);
    expect(isContainedIn(root, path.resolve('/tmp'))).toBe(false);
    expect(isContainedIn(root, path.join(root, '..', 'evil'))).toBe(false);
    expect(isContainedIn(root, path.join(root, 'a', '..', '..', 'evil'))).toBe(false);
  });

  // A neighbouring directory whose name STARTS with the root name is not
  // contained — a plain string comparison would wrongly find it.
  it('rejects a sibling whose name merely starts with the root name', () => {
    expect(isContainedIn(root, path.resolve('/tmp/tm1tests-backup/x'))).toBe(false);
    expect(isContainedIn(root, path.resolve('/tmp/tm1tests2'))).toBe(false);
  });

  it('normalises before comparing', () => {
    expect(isContainedIn(path.resolve('/tmp/./tm1tests'), path.join(root, 'suite'))).toBe(true);
  });
});
