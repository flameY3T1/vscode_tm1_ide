import type * as monacoType from 'monaco-editor';
import { detectRulesFoldRanges } from '../../tiLogicVisualizer/rulesFoldRanges';

/** Registers a Monaco folding-range provider for the 'tm1rules' language:
 *  SKIPCHECK/FEEDERS regions, consecutive #-comment blocks, and IF/ENDIF blocks. */
export function registerRulesFolding(monaco: typeof monacoType): void {
  monaco.languages.registerFoldingRangeProvider('tm1rules', {
    provideFoldingRanges(model) {
      return detectRulesFoldRanges(model.getValue()).map(r => ({
        start: r.startLine,
        end: r.endLine,
        kind: r.kind === 'comment'
          ? monaco.languages.FoldingRangeKind.Comment
          : monaco.languages.FoldingRangeKind.Region,
      }));
    },
  });
}
