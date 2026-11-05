import { describe, it, expect } from 'vitest';
import { diffLines, applyHunks, hunksToEdits, type TextEditOp } from '../webviewClient/processEditorMonaco/lineDiff';

/** Simulate Monaco range edits on plain text to verify hunksToEdits end-to-end. */
function applyEdits(text: string, edits: TextEditOp[]): string {
  const lines = text.split('\n');
  const lineStart: number[] = [0];
  for (let i = 0; i < lines.length; i++) { lineStart.push(lineStart[i] + lines[i].length + 1); }
  const toOff = (ln: number, col: number) => lineStart[ln - 1] + (col - 1);
  const sorted = [...edits].sort(
    (a, b) => toOff(b.range.startLineNumber, b.range.startColumn) - toOff(a.range.startLineNumber, a.range.startColumn),
  );
  let res = text;
  for (const e of sorted) {
    const so = toOff(e.range.startLineNumber, e.range.startColumn);
    const eo = toOff(e.range.endLineNumber, e.range.endColumn);
    res = res.slice(0, so) + e.text + res.slice(eo);
  }
  return res;
}

/** Round-trip: applying the computed edits to old text must yield new text exactly. */
function roundtrip(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const hunks = diffLines(oldLines, newLines);
  expect(applyHunks(oldLines, hunks)).toEqual(newLines); // hunks reconstruct new lines
  const edits = hunksToEdits(hunks, oldLines.length, (ln) => oldLines[ln - 1].length + 1);
  return applyEdits(oldText, edits);
}

describe('diffLines / hunksToEdits', () => {
  it('no change → no hunks, no edits', () => {
    const t = 'a\nb\nc';
    expect(diffLines(t.split('\n'), t.split('\n'))).toEqual([]);
    expect(roundtrip(t, t)).toBe(t);
  });

  it('single middle line content change (same count)', () => {
    const o = 'CellPutN( 1, c );\nx=1;\nReturn;';
    const n = 'CellPutN( 1, c );\nX = 1;\nReturn;';
    expect(roundtrip(o, n)).toBe(n);
    const hunks = diffLines(o.split('\n'), n.split('\n'));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toEqual({ oldStart: 1, oldEnd: 2, lines: ['X = 1;'] });
  });

  it('change at first line', () => {
    expect(roundtrip('a\nb\nc', 'A\nb\nc')).toBe('A\nb\nc');
  });

  it('change at last line', () => {
    expect(roundtrip('a\nb\nc', 'a\nb\nC')).toBe('a\nb\nC');
  });

  it('insert a line in the middle', () => {
    expect(roundtrip('a\nb\nc', 'a\nNEW\nb\nc')).toBe('a\nNEW\nb\nc');
  });

  it('delete a middle line', () => {
    expect(roundtrip('a\nb\nc', 'a\nc')).toBe('a\nc');
  });

  it('append lines at EOF', () => {
    expect(roundtrip('a\nb', 'a\nb\nc\nd')).toBe('a\nb\nc\nd');
  });

  it('delete tail through last line', () => {
    expect(roundtrip('a\nb\nc\nd', 'a\nb')).toBe('a\nb');
  });

  it('whole-doc replace', () => {
    expect(roundtrip('a\nb\nc', 'x\ny\nz\nw')).toBe('x\ny\nz\nw');
  });

  it('one-statement-per-line-style statement split (one line → many)', () => {
    const o = 'x=1; y=2; z=3;\nReturn;';
    const n = 'x=1;\ny=2;\nz=3;\nReturn;';
    expect(roundtrip(o, n)).toBe(n);
  });

  it('scattered casing changes keep unchanged lines as gaps', () => {
    const o = 'cellputn(1);\nNoChange();\ndimix(d,e);\nKeep();';
    const n = 'CellPutN(1);\nNoChange();\nDIMIX(d,e);\nKeep();';
    expect(roundtrip(o, n)).toBe(n);
    const hunks = diffLines(o.split('\n'), n.split('\n'));
    expect(hunks).toHaveLength(2);
    expect(hunks[0].oldStart).toBe(0);
    expect(hunks[1].oldStart).toBe(2);
  });

  it('large input falls back to single full-replace hunk', () => {
    const o = Array.from({ length: 2100 }, (_, i) => `a${i}`);
    const n = Array.from({ length: 2100 }, (_, i) => `b${i}`);
    const hunks = diffLines(o, n);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toEqual({ oldStart: 0, oldEnd: 2100, lines: n });
    expect(applyHunks(o, hunks)).toEqual(n);
  });

  it('trailing-newline (empty last line) handled', () => {
    expect(roundtrip('a\nb\n', 'A\nb\n')).toBe('A\nb\n');
    expect(roundtrip('a\nb\n', 'a\nB\n')).toBe('a\nB\n');
  });
});
