// Regression guard for the column choice of webview panels (source scan).
//
// Two directions, both equally important:
//
//  (a) A hard-coded `ViewColumn.One` must NOT come back. According to
//      `@types/vscode`, `One` is absolute ("The first editor column") and always forces a panel
//      into the main window — even when the user has dragged the triggering
//      editor into a window of its own via "Move Editor into New Window".
//      That is exactly what ailed the Dimension Browser.
//
//  (b) The DELIBERATELY fixed columns (`Two` for side-by-side monitoring, `Beside`
//      for "next to the trigger") must stay. They were indistinguishable from the
//      copy-paste `One`s until they got a justifying
//      comment — this test pins down both, so that nobody blindly
//      switches them over later as well.
//
// TREE-WIDE SCAN instead of a file list (2026-08-24). Previously this guard checked
// a hand-maintained list of 11 panel modules. That made a NEW
// panel module with a hard-coded `ViewColumn.One` invisible — exactly the bug
// it was written against. The earlier justification ("a tree-wide scan
// would run into `ViewColumnDimensionSet`") does not hold: `\bViewColumn\.One\b`
// distinguishes the two, and the test `the guard does not confuse … ` below
// proves it. Measured during the rework: in the whole of `src/` (without `src/test`) there is
// exactly ONE `ViewColumn.One`, namely the allowed one in `messageLog.ts`.
//
// The JUSTIFICATION is now also searched for locally, not anywhere in the file:
// a comment 200 lines further up does not justify a fixed column 200 lines
// further down. Window: 6 lines above, 3 below. The asymmetry is
// measured, not guessed — a justification always sits ABOVE the line, and
// the longest of the six existing comment blocks are 4 lines long
// (`messageLogAnalysis.ts:418-421`, `cellTracePanel.ts:48-51`,
// `areaDbBuilder.ts:22-25`). A plain ±3 would have wrongly flagged exactly these three;
// 6 leaves a block some room and is still far from
// "somewhere in a 500-line file".
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** All production sources — `src/test` is not part of them. */
function produktivDateien(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (path.relative(SRC, full) === 'test') { continue; }
        walk(full);
      } else if (e.isFile() && full.endsWith('.ts')) {
        out.push(path.relative(ROOT, full).split(path.sep).join('/'));
      }
    }
  };
  walk(SRC);
  return out;
}

const DATEIEN = produktivDateien();

/**
 * A fixed column must explain itself locally — either with the marker itself
 * or with a reference to the explanation next to it (`cellTracePanel.ts`
 * justifies the creation at length and points there on re-reveal).
 */
// A fixed token, not prose: rewording or translating the explanation next to
// it must not turn the guard red. The prose stays below the token.
const BEGRUENDUNG = /\/\/ ViewColumn: deliberate\b/;

/** Absolute columns: they ALWAYS point to the main window or a fixed position. */
const ABSOLUT = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Beside'];
const ABSOLUT_RE = new RegExp(`\\bViewColumn\\.(${ABSOLUT.join('|')})\\b`, 'g');

/** The only place where an absolute `ViewColumn.One` may remain. */
const ALLOWED_ONE: ReadonlyArray<{ file: string; why: RegExp }> = [
  {
    // Error log on the left, message log panel on the right (column Two) — a deliberate
    // side-by-side layout, not a forgotten copy-paste.
    file: 'src/commands/messageLog.ts',
    why: BEGRUENDUNG,
  },
];

/** Deliberately fixed columns: file → expected column + number of occurrences. */
const DELIBERATE: ReadonlyArray<{ file: string; column: string; count: number }> = [
  { file: 'src/commands/messageLogAnalysis.ts', column: 'Two', count: 1 },
  { file: 'src/commands/messageLogStartup.ts', column: 'Two', count: 1 },
  { file: 'src/commands/messageLog.ts', column: 'Two', count: 1 },
  { file: 'src/commands/threads.ts', column: 'Two', count: 1 },
  { file: 'src/commands/tm1Top.ts', column: 'Two', count: 1 },
  // Twice: once on creation, once on re-reveal.
  { file: 'src/commands/cubeViewer/cellTracePanel.ts', column: 'Beside', count: 2 },
  { file: 'src/commands/rule/areaDbBuilder.ts', column: 'Beside', count: 1 },
];

/** Files that are allowed to carry a fixed column at all. */
const FESTE_DATEIEN = new Set<string>([
  ...ALLOWED_ONE.map(a => a.file),
  ...DELIBERATE.map(d => d.file),
]);

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Line numbers (1-based) in which `re` matches in the text. */
function trefferZeilen(text: string, re: RegExp): number[] {
  const out: number[] = [];
  text.split('\n').forEach((line, i) => {
    // Fresh lastIndex behavior: `re` may be global.
    if (new RegExp(re.source).test(line)) { out.push(i + 1); }
  });
  return out;
}

/** Lines ABOVE the occurrence in which the justification may stand. */
const FENSTER_OBEN = 6;
/** Lines below — tight, a justification practically never comes after the code. */
const FENSTER_UNTEN = 3;

/** Is `was` within the window around `zeile` (6 above, 3 below)? */
function imFenster(text: string, zeile: number, was: RegExp,
                   oben = FENSTER_OBEN, unten = FENSTER_UNTEN): boolean {
  const lines = text.split('\n');
  const von = Math.max(0, zeile - 1 - oben);
  const bis = Math.min(lines.length, zeile + unten);
  return was.test(lines.slice(von, bis).join('\n'));
}

/** The actual scan: who carries a `ViewColumn.One` that is not allowed? */
function scanHartesOne(dateien: string[]): string[] {
  const erlaubt = new Set(ALLOWED_ONE.map(a => a.file));
  return dateien.filter(f => !erlaubt.has(f) && /\bViewColumn\.One\b/.test(read(f)));
}

describe('ViewColumn — deliberate columns stay, accidental ones stay gone', () => {
  it('no production module anywhere in src/ hard-wires ViewColumn.One', () => {
    const offenders = scanHartesOne(DATEIEN);
    expect(
      offenders,
      `Hartes ViewColumn.One gefunden — es zwingt das Panel ins HAUPTfenster, auch wenn der\n`
      + `Auslöser in einem abgetrennten Fenster steht. Host-Default \`Active\` verwenden:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the guard finds a planted violation', () => {
    // Proof that it bites (modeled on `countFormatGuard.test.ts`): the same expression
    // on a constructed snippet. Without this, a scan that finds nothing
    // cannot be told apart from a scan that CANNOT find anything.
    const bad = 'const panel = vscode.window.createWebviewPanel(id, t, vscode.ViewColumn.One, opts);';
    expect(/\bViewColumn\.One\b/.test(bad)).toBe(true);

    const good = 'const panel = vscode.window.createWebviewPanel(id, t, vscode.ViewColumn.Active, opts);';
    expect(/\bViewColumn\.One\b/.test(good)).toBe(false);
  });

  it('the guard does not confuse ViewColumnDimensionSet with ViewColumn.One', () => {
    // That was the justification with which the scan used to be limited to 11 files.
    // It does not hold — the word boundary and the dot separate the two
    // cleanly. The proof is here so that the list does not come back.
    expect(/\bViewColumn\.One\b/.test('type ViewColumnDimensionSet = { One: string };')).toBe(false);
    expect(/\bViewColumn\.One\b/.test('const x: ViewColumnDimensionSet.OneThing = y;')).toBe(false);
    expect(/\bViewColumn\.One\b/.test('vscode.ViewColumn.OneMore')).toBe(false);
  });

  it('no panel is revealed into an ABSOLUTE column', () => {
    // `reveal(col)` moves an already open panel into another column and
    // thereby tears it out of the window the user dragged it into. Without an
    // argument, according to the d.ts, "Shows in the current WebviewPanel.viewColumn" applies.
    const re = new RegExp(`\\.reveal\\(\\s*vscode\\.ViewColumn\\.(${ABSOLUT.join('|')})\\b`);
    const offenders = DATEIEN
      .filter(f => !FESTE_DATEIEN.has(f))
      .filter(f => re.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('the symbolic reveal(Active) calls remain exactly the two known ones', () => {
    // Noticed during the switch to the tree scan: `mdxRunner.ts` reveals its panel
    // with `reveal(vscode.ViewColumn.Active)`. `Active` is symbolic,
    // so NOT a violation of (a) — but it still pulls the panel into the
    // currently active group, whereas `reveal()` WITHOUT an argument would leave it in place
    // (docs/architecture/webview-templates.md, ViewColumn rule). This guard does not change
    // production code; the two places are nailed down here so that a
    // THIRD one gets noticed instead of joining in.
    const re = /\.reveal\(\s*vscode\.ViewColumn\.Active\b/;
    const gefunden = DATEIEN
      .filter(f => re.test(read(f)))
      .map(f => `${f}×${occurrences(read(f), '.reveal(vscode.ViewColumn.Active')}`);
    expect(gefunden).toEqual(['src/commands/mdx/mdxRunner.ts×2']);
  });

  it('the one remaining ViewColumn.One carries its justification', () => {
    for (const { file, why } of ALLOWED_ONE) {
      const text = read(file);
      const zeilen = trefferZeilen(text, /\bViewColumn\.One\b/);
      expect(zeilen, `${file}: kein ViewColumn.One mehr — Eintrag aus ALLOWED_ONE entfernen`).not.toEqual([]);
      for (const z of zeilen) {
        // LOCALLY, not just anywhere: a comment at the top of the file does not justify a
        // fixed column at the end of the file.
        expect(imFenster(text, z, why), `${file}:${z} — Begründung nicht im Fenster darum`).toBe(true);
      }
    }
  });

  it('keeps the deliberate Two / Beside columns exactly as they are', () => {
    for (const { file, column, count } of DELIBERATE) {
      expect(occurrences(read(file), `ViewColumn.${column}`)).toBe(count);
    }
  });

  it('every deliberately fixed column explains itself LOCALLY (6 lines above)', () => {
    const offenders: string[] = [];
    for (const { file, column } of DELIBERATE) {
      const text = read(file);
      for (const z of trefferZeilen(text, new RegExp(`\\bViewColumn\\.${column}\\b`))) {
        if (!imFenster(text, z, BEGRUENDUNG)) { offenders.push(`${file}:${z}`); }
      }
    }
    expect(
      offenders,
      `Feste Spalte ohne Begründung im Fenster (6 Zeilen darüber) — von einem vergessenen\n`
      + `Copy-Paste nicht zu unterscheiden:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the window really is narrow — a justification far away does not count', () => {
    // Proof that `imFenster` bites: the same text, once with the
    // justification in reach (a four-line comment block, the
    // measured real-world shape) and once just outside.
    const nah = [
      '// ViewColumn: deliberate',
      '// zweite Zeile', '// dritte Zeile', '// vierte Zeile',
      'vscode.ViewColumn.Two,',
    ].join('\n');
    expect(imFenster(nah, 5, BEGRUENDUNG)).toBe(true);

    const fern = ['// ViewColumn: deliberate', ...Array(8).fill('a();'), 'vscode.ViewColumn.Two,'].join('\n');
    expect(imFenster(fern, 10, BEGRUENDUNG)).toBe(false);
    // And the boundary really sits at 6, not just anywhere: one line further
    // away is already not enough.
    const grenzeDrin = ['// ViewColumn: deliberate', ...Array(6).fill('a();'), 'vscode.ViewColumn.Two,'].join('\n');
    expect(imFenster(grenzeDrin, 8, BEGRUENDUNG)).toBe(false);
    const grenzeKnapp = ['// ViewColumn: deliberate', ...Array(5).fill('a();'), 'vscode.ViewColumn.Two,'].join('\n');
    expect(imFenster(grenzeKnapp, 7, BEGRUENDUNG)).toBe(true);
  });

  it('no file outside the lists carries an absolute column at all', () => {
    // Also catches a new `Two`/`Beside`, not just `One`: anyone who introduces a fixed
    // column must register and justify it here.
    const offenders: string[] = [];
    for (const f of DATEIEN) {
      if (FESTE_DATEIEN.has(f)) { continue; }
      const treffer = [...read(f).matchAll(ABSOLUT_RE)].map(m => m[1]);
      if (treffer.length) { offenders.push(`${f}: ${[...new Set(treffer)].join(', ')}`); }
    }
    expect(offenders).toEqual([]);
  });

  it('the panel host still defaults to the symbolic active column', () => {
    expect(read('src/webviews/webviewPanelHost.ts'))
      .toContain('args.viewColumn ?? vscode.ViewColumn.Active');
  });

  it('the dimension browser forwards the caller column instead of pinning one', () => {
    expect(read('src/commands/dimension/dimensionBrowser.ts'))
      .toContain('viewColumn: options?.viewColumn');
  });

  it('the cube viewer hands its own column to the dimension browser', () => {
    const messaging = read('src/commands/cubeViewer/messaging.ts');
    expect(messaging).toContain('panel.viewColumn !== undefined');
    expect(messaging).toContain('{ viewColumn: panel.viewColumn }');
  });
});
