import * as vscode from 'vscode';
import { detectTiFoldRanges } from '../tiLogicVisualizer/regionRanges';
import { detectRulesFoldRanges } from '../tiLogicVisualizer/rulesFoldRanges';

/** Maps detector `kind` to VS Code folding-range kind.
 * 'region' → Region, 'comment' → Comment, IF/WHILE ('if') → undefined (default). */
function kindFor(kind: string): vscode.FoldingRangeKind | undefined {
  if (kind === 'region') { return vscode.FoldingRangeKind.Region; }
  if (kind === 'comment') { return vscode.FoldingRangeKind.Comment; }
  return undefined;
}

/** Folding plain TI files (.ti/.pro): IF/WHILE blocks + #Region sections. */
export class TiFoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    return detectTiFoldRanges(document.getText()).map(
      r => new vscode.FoldingRange(r.startLine - 1, r.endLine - 1, kindFor(r.kind)),
    );
  }
}

/** Folding plain rules files (.rux): SKIPCHECK/FEEDERS, #Region sections. */
export class RulesFoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    return detectRulesFoldRanges(document.getText()).map(
      r => new vscode.FoldingRange(r.startLine - 1, r.endLine - 1, kindFor(r.kind)),
    );
  }
}
