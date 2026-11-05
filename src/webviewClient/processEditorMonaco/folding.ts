import type * as monacoType from 'monaco-editor';
import { detectTiFoldRanges } from '../../tiLogicVisualizer/regionRanges';

/** Registers a Monaco folding-range provider for the 'ti' language that recognizes
 *  IF/ENDIF, WHILE/END, and #Region/#EndRegion blocks (ELSE/ELSEIF stay inside the IF fold). */
export function registerFolding(monaco: typeof monacoType): void {
  monaco.languages.registerFoldingRangeProvider('ti', {
    provideFoldingRanges(model) {
      const ranges = detectTiFoldRanges(model.getValue());
      return ranges.map(r => ({
        start: r.startLine,
        end: r.endLine,
        kind: r.kind === 'region' ? monaco.languages.FoldingRangeKind.Region : undefined,
      }));
    },
  });
}
