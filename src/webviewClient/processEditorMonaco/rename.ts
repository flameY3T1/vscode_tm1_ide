import type * as monacoType from 'monaco-editor';
import { findAllOccurrencesPure } from '../../providers/tiIdentifierUtilsPure';
import { KNOWN_SIGNATURES } from '../../tiLogicVisualizer/tiSignatures';

import type { SectionKey } from './sectionTypes';
import { getL10n } from '../_shared/l10n';

const L = getL10n();

interface RenameBridge {
  getAllModels(): Record<SectionKey, monacoType.editor.ITextModel>;
}

const TI_RESERVED = new Set([
  'if', 'elseif', 'else', 'endif', 'while', 'end', 'for', 'next',
  'processerror', 'processquit', 'processbreak', 'processabort',
  'itemreject', 'itemskip',
  'stringglobalvariable', 'numericglobalvariable',
]);

let _builtinNames: Set<string> | null = null;
function getBuiltinNames(): Set<string> {
  if (!_builtinNames) {
    _builtinNames = new Set([...KNOWN_SIGNATURES.keys()].map(k => k.toLowerCase()));
  }
  return _builtinNames;
}

function isReserved(lower: string): boolean {
  return TI_RESERVED.has(lower) || getBuiltinNames().has(lower);
}

const ID_RE = /[a-zA-Z_][a-zA-Z0-9_]*/;
const VALID_NEW_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function registerTiRename(monaco: typeof monacoType, bridge: RenameBridge): void {
  monaco.languages.registerRenameProvider('ti', {
    resolveRenameLocation(model, position): monacoType.languages.RenameLocation | null {
      const wordInfo = model.getWordAtPosition(position);
      if (!wordInfo) { return null; }
      const word = wordInfo.word;
      if (!ID_RE.test(word)) { return null; }
      const range = new monaco.Range(position.lineNumber, wordInfo.startColumn, position.lineNumber, wordInfo.endColumn);
      if (isReserved(word.toLowerCase())) {
        return { range, text: word, rejectReason: L.renameReserved } as any;
      }
      return { range, text: word };
    },

    provideRenameEdits(model, position, newName): monacoType.languages.WorkspaceEdit | null {
      const wordInfo = model.getWordAtPosition(position);
      if (!wordInfo) { return null; }
      const word = wordInfo.word;
      if (isReserved(word.toLowerCase())) { return null; }
      const trimmed = newName.trim();
      if (!trimmed || !VALID_NEW_NAME_RE.test(trimmed)) { return null; }
      if (isReserved(trimmed.toLowerCase())) { return null; }

      const models = bridge.getAllModels();
      const edits: monacoType.languages.IWorkspaceTextEdit[] = [];

      for (const section of ['prolog', 'metadata', 'data', 'epilog'] as SectionKey[]) {
        const m = models[section];
        if (!m) { continue; }
        const text = m.getValue();
        const occurrences = findAllOccurrencesPure(text, word);
        for (const occ of occurrences) {
          edits.push({
            resource: m.uri,
            versionId: m.getVersionId(),
            textEdit: {
              range: new monaco.Range(occ.line + 1, occ.startCol + 1, occ.line + 1, occ.endCol + 1),
              text: trimmed,
            },
          });
        }
      }

      if (edits.length === 0) { return null; }
      return { edits };
    },
  });
}
