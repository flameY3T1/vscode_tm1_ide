import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Guard: the element qualifier must apply its result through an undoable edit.
 *
 * `ITextModel.setValue` throws the undo stack away — Monaco's own
 * `_setValueFromTextBuffer` calls `this._commandManager.clear()`. Applied that way,
 * a qualifier run cannot be reverted with Ctrl+Z, which is what a user hit on
 * 2026-07-28. `editor.executeEdits` between two `pushUndoStop()` calls keeps the
 * whole run as one undo step, the way paste and cut already work in this editor.
 *
 * The client is a Monaco bundle that cannot be imported in a unit test, so this
 * scans the source — same approach as `noManualBodyRelease.test.ts`.
 */
const SRC = path.resolve(__dirname, '../../../webviewClient/ruleEditorMonaco/index.ts');

function qualifyResultBranch(): string {
  const text = fs.readFileSync(SRC, 'utf8');
  const start = text.indexOf("case 'qualifyResult'");
  expect(start, "case 'qualifyResult' not found — was the handler renamed?").toBeGreaterThan(-1);
  const end = text.indexOf("case '", start + 10);
  return text.slice(start, end === -1 ? text.length : end);
}

describe('rule editor: element qualifier stays undoable', () => {
  it('applies the qualified text with executeEdits, not setValue', () => {
    const branch = qualifyResultBranch();
    expect(branch, 'setValue clears the undo stack').not.toMatch(/\bsetValue\s*\(/);
    expect(branch).toMatch(/executeEdits\s*\(/);
  });

  it('wraps the edit in undo stops so one Ctrl+Z reverts the whole run', () => {
    const branch = qualifyResultBranch();
    const stops = branch.match(/pushUndoStop\s*\(/g) ?? [];
    expect(stops.length, 'expected an undo stop before and after the edit').toBe(2);
  });

  it('still lets the initial rulesText load reset the undo stack', () => {
    // Loading a rule set is a fresh document, so setValue is correct there and
    // must not be "fixed" along with the qualifier.
    const text = fs.readFileSync(SRC, 'utf8');
    expect(text).toMatch(/setValue\(msg\.rulesText/);
  });
});
