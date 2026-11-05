/**
 * Light bulb / Ctrl+. for TI linter markers in the process editor. The fixes
 * themselves live in `quickFixPure.ts`; this only maps them onto Monaco.
 */
import type * as monacoType from 'monaco-editor';
import { diagnosticForMarker } from './linter';
import { quickFixesFor, type QuickFixKind, type TiSectionKey } from './quickFixPure';
import { getL10n, fmt } from '../_shared/l10n';

const L = getL10n();

const TITLE_KEY: Record<QuickFixKind, string> = {
  addSemicolon: 'quickFixAddSemicolon',
  useAtOperator: 'quickFixReplaceOperator',
  dropAtOperator: 'quickFixReplaceOperator',
  fixCasing: 'quickFixCasing',
  removeAssignment: 'quickFixRemoveAssignment',
  restoreCubeLog: 'quickFixRestoreCubeLog',
  disableRule: 'quickFixDisableRule',
};

export function registerTiQuickFixes(monaco: typeof monacoType): void {
  monaco.languages.registerCodeActionProvider('ti', {
    provideCodeActions(model, _range, context) {
      const actions: monacoType.languages.CodeAction[] = [];
      for (const marker of context.markers) {
        const hit = diagnosticForMarker(model, marker);
        if (!hit) { continue; }
        const sections = Object.fromEntries(
          Object.entries(hit.models).map(([k, m]) => [k, m.getLinesContent()]),
        ) as Record<TiSectionKey, string[]>;
        const fixes = quickFixesFor(
          { ruleId: hit.diagnostic.ruleId, line: marker.startLineNumber, messageArgs: hit.diagnostic.messageArgs },
          { section: hit.section, sections },
        );
        for (const fix of fixes) {
          actions.push({
            title: fmt(L, TITLE_KEY[fix.kind], ...fix.args),
            kind: 'quickfix',
            diagnostics: [marker],
            isPreferred: !fix.notPreferred,
            edit: {
              edits: fix.edits.map(e => {
                // An edit may land in another section (restore in the epilog).
                const target = e.section ? hit.models[e.section] : model;
                return {
                  resource: target.uri,
                  versionId: target.getVersionId(),
                  textEdit: {
                    range: new monaco.Range(e.line, e.startCol, e.endLine ?? e.line, e.endCol),
                    text: e.text,
                  },
                };
              }),
            },
          });
        }
      }
      return { actions, dispose: () => { /* nothing held */ } };
    },
  }, { providedCodeActionKinds: ['quickfix'] });
}
