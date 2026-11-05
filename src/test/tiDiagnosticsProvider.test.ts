import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DiagnosticSeverity,
  Uri,
  MockDiagnosticCollection,
  languages,
  workspace,
} from './__mocks__/vscode';

// Mock the vscode module (resolved via vitest alias)
// Mock the parser and linter so we can control their outputs
vi.mock('../tiLogicVisualizer/tiParser', () => ({
  parseTiCodeAccumulating: vi.fn(),
}));
vi.mock('../tiLogicVisualizer/tiLinter', () => ({
  lintTiAst: vi.fn(),
}));

import { parseTiCodeAccumulating } from '../tiLogicVisualizer/tiParser';
import { lintTiAst } from '../tiLogicVisualizer/tiLinter';
import { TiDiagnosticsProvider } from '../providers/tiDiagnosticsProvider';

const mockAcc = parseTiCodeAccumulating as ReturnType<typeof vi.fn>;
const mockLint = lintTiAst as ReturnType<typeof vi.fn>;

function makeDoc(fileName: string, text = '') {
  return {
    fileName,
    // Mirrors the `languages` contribution in package.json.
    languageId: /\.(pro|ti)$/.test(fileName) ? 'ti' : fileName.endsWith('.rux') ? 'tm1rules' : 'plaintext',
    getText: () => text,
    uri: Uri.file(fileName),
  };
}

function getCollection(): MockDiagnosticCollection {
  const calls = (languages.createDiagnosticCollection as ReturnType<typeof vi.fn>).mock.calls;
  // The provider creates the collection in its constructor; grab the last one
  return (languages.createDiagnosticCollection as ReturnType<typeof vi.fn>).mock.results[
    calls.length - 1
  ].value as MockDiagnosticCollection;
}

describe('TiDiagnosticsProvider', () => {
  let _provider: TiDiagnosticsProvider;
  let collection: MockDiagnosticCollection;

  beforeEach(() => {
    vi.clearAllMocks();
    _provider = new TiDiagnosticsProvider();
    collection = getCollection();
  });

  // --- Requirement 5.2: error severity mapping ---
  describe('severity mapping', () => {
    it('maps error severity to DiagnosticSeverity.Error (0)', () => {
      mockAcc.mockReturnValue({ ast: [], errors: [] });
      mockLint.mockReturnValue([
        { line: 3, severity: 'error', ruleId: 'endless-loop', message: '[endless-loop] Test' },
      ]);

      const doc = makeDoc('test.pro', 'WHILE(1);\nEND;');
      workspace._fireOpen(doc);

      const diags = collection.get(doc.uri);
      expect(diags).toBeDefined();
      expect(diags!.length).toBe(1);
      expect(diags![0].severity).toBe(DiagnosticSeverity.Error);
    });

    // --- Requirement 5.3: hint severity mapping ---
    it('maps hint severity to DiagnosticSeverity.Hint (3)', () => {
      mockAcc.mockReturnValue({ ast: [], errors: [] });
      mockLint.mockReturnValue([
        { line: 1, severity: 'hint', ruleId: 'unused-variable', message: '[unused-variable] Test' },
      ]);

      const doc = makeDoc('test.ti', 'x = 1;');
      workspace._fireOpen(doc);

      const diags = collection.get(doc.uri);
      expect(diags).toBeDefined();
      expect(diags!.length).toBe(1);
      expect(diags![0].severity).toBe(DiagnosticSeverity.Hint);
    });
  });

  // --- Requirement 5.5: parse error handling ---
  describe('parse error handling', () => {
    it('sets a single Error diagnostic when the parser reports an error', () => {
      mockAcc.mockReturnValue({
        ast: [],
        errors: [{ line: 5, message: 'Unexpected token {0}', messageKey: 'Unexpected token {0}', messageArgs: ['END'] }],
      });
      mockLint.mockReturnValue([]);

      const doc = makeDoc('broken.pro', 'bad code');
      workspace._fireOpen(doc);

      const diags = collection.get(doc.uri);
      expect(diags).toBeDefined();
      expect(diags!.length).toBe(1);
      expect(diags![0].severity).toBe(DiagnosticSeverity.Error);
      // Displayed text is the localized render (vscode.l10n.t(messageKey, ...args)).
      expect(diags![0].message).toBe('Unexpected token END');
      // line should be 0-indexed (line 5 → index 4)
      expect(diags![0].range.startLine).toBe(4);
    });
  });

  // --- Requirement 5.4: file close clears diagnostics ---
  describe('file close clears diagnostics', () => {
    it('deletes diagnostics for the URI when a document is closed', () => {
      mockAcc.mockReturnValue({ ast: [], errors: [] });
      mockLint.mockReturnValue([
        { line: 1, severity: 'error', ruleId: 'endless-loop', message: '[endless-loop] Test' },
      ]);

      const doc = makeDoc('closeme.pro', 'code');
      workspace._fireOpen(doc);
      expect(collection.get(doc.uri)).toBeDefined();

      workspace._fireClose(doc);
      expect(collection.get(doc.uri)).toBeUndefined();
    });

    it('leaves a .pro alone that the user switched to another language (Qt, Prolog)', () => {
      mockAcc.mockReturnValue({ ast: [], errors: [] });
      mockLint.mockReturnValue([
        { line: 1, severity: 'error', ruleId: 'endless-loop', message: '[endless-loop] Test' },
      ]);
      const doc = { ...makeDoc('app.pro', 'QT += core'), languageId: 'plaintext' };
      workspace._fireOpen(doc);
      expect(collection.get(doc.uri)).toBeUndefined();
    });
  });

  // --- Non .pro/.ti files are ignored ---
  describe('non-.pro/.ti files are ignored', () => {
    it('does not set diagnostics for .js files', () => {
      const doc = makeDoc('script.js', 'var x = 1;');
      workspace._fireOpen(doc);

      expect(collection.get(doc.uri)).toBeUndefined();
      expect(mockAcc).not.toHaveBeenCalled();
    });

    it('does not set diagnostics for .ts files', () => {
      const doc = makeDoc('module.ts', 'const x = 1;');
      workspace._fireOpen(doc);

      expect(collection.get(doc.uri)).toBeUndefined();
      expect(mockAcc).not.toHaveBeenCalled();
    });

    it('does not set diagnostics for .txt files', () => {
      const doc = makeDoc('readme.txt', 'hello');
      workspace._fireOpen(doc);

      expect(collection.get(doc.uri)).toBeUndefined();
      expect(mockAcc).not.toHaveBeenCalled();
    });
  });

  // --- Change event triggers re-lint ---
  describe('change event triggers diagnostics update', () => {
    it('updates diagnostics on document change', () => {
      mockAcc.mockReturnValue({ ast: [], errors: [] });
      mockLint.mockReturnValue([
        { line: 2, severity: 'hint', ruleId: 'empty-if', message: '[empty-if] Test' },
      ]);

      const doc = makeDoc('edit.pro', 'IF(1);\nENDIF;');
      vi.useFakeTimers();
      workspace._fireChange({ document: doc });
      // change events are debounced (~300ms) — advance past the timer
      vi.advanceTimersByTime(400);
      vi.useRealTimers();

      const diags = collection.get(doc.uri);
      expect(diags).toBeDefined();
      expect(diags!.length).toBe(1);
      expect(diags![0].severity).toBe(DiagnosticSeverity.Hint);
    });
  });
});
