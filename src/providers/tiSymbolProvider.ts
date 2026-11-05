import * as vscode from 'vscode';
import { tiOutline, rulesOutline, type OutlineNode } from '../tiLogicVisualizer/documentOutline';

/** Maps outline nodes to DocumentSymbols. `Namespace` is the closest kind for a
 *  section marker — TI and rules have no functions or classes to name. */
function toSymbols(doc: vscode.TextDocument, nodes: OutlineNode[]): vscode.DocumentSymbol[] {
  return nodes.map(n => {
    const first = n.startLine - 1;
    const last = Math.min(n.endLine - 1, doc.lineCount - 1);
    const full = new vscode.Range(first, 0, last, doc.lineAt(last).text.length);
    const head = new vscode.Range(first, 0, first, doc.lineAt(first).text.length);
    const sym = new vscode.DocumentSymbol(n.name, '', vscode.SymbolKind.Namespace, full, head);
    sym.children = toSymbols(doc, n.children);
    return sym;
  });
}

/** Outline + breadcrumbs for plain TI files (`.ti`/`.pro`). */
export class TiSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(doc: vscode.TextDocument): vscode.DocumentSymbol[] {
    return toSymbols(doc, tiOutline(doc.getText()));
  }
}

/** Outline + breadcrumbs for plain rules files (`.rux`). */
export class RulesSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(doc: vscode.TextDocument): vscode.DocumentSymbol[] {
    return toSymbols(doc, rulesOutline(doc.getText()));
  }
}
