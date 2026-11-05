import * as vscode from 'vscode';
import { KNOWN_SIGNATURES, docUrlFor } from '../tiLogicVisualizer/tiSignatures';
import { isV12Active } from '../utils/v12Mode';
import { serverConfigForUri } from './serverConfigForFile';

/**
 * Builds a MarkdownString for the function description with an IBM doc
 * link at the end. Uses `vscode.MarkdownString` so the links are clickable.
 */
function buildSignatureDoc(description: string | undefined, docUrl: string | undefined, deprecated: boolean): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = false;
  md.supportHtml = false;
  if (deprecated) {
    md.appendMarkdown('⚠️ _Deprecated in TM1 / PA v12._\n\n');
  }
  if (description) {
    md.appendMarkdown(description + '\n\n');
  }
  if (docUrl) {
    md.appendMarkdown(`[IBM Docs](${docUrl})`);
  }
  return md;
}

export class Tm1SignatureHelpProvider implements vscode.SignatureHelpProvider {
  provideSignatureHelp(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.SignatureHelp | undefined {
    const lineText = document.lineAt(position.line).text;
    const textBefore = lineText.substring(0, position.character);

    let depth = 0;
    let parenPos = -1;
    for (let i = textBefore.length - 1; i >= 0; i--) {
      if (textBefore[i] === ')') { depth++; }
      else if (textBefore[i] === '(') {
        if (depth === 0) { parenPos = i; break; }
        depth--;
      }
    }
    if (parenPos <= 0) { return undefined; }

    const before = textBefore.substring(0, parenPos);
    const nameMatch = before.match(/([a-zA-Z_]\w*)$/);
    if (!nameMatch) { return undefined; }
    const funcName = nameMatch[1];

    const argsText = textBefore.substring(parenPos + 1);
    let commaCount = 0;
    let argDepth = 0;
    for (const ch of argsText) {
      if (ch === '(') { argDepth++; }
      else if (ch === ')') { argDepth--; }
      else if (ch === ',' && argDepth === 0) { commaCount++; }
    }

    const knownSig = KNOWN_SIGNATURES.get(funcName.toLowerCase());
    if (!knownSig) { return undefined; }

    const paramList = knownSig.params.map(p => `${p.name}: ${p.type}`).join(', ');
    const help = new vscode.SignatureHelp();
    const si = new vscode.SignatureInformation(
      `${knownSig.name}(${paramList}) → ${knownSig.returnType}`,
      buildSignatureDoc(
        knownSig.description,
        docUrlFor(knownSig, isV12Active(serverConfigForUri(document.uri))),
        knownSig.deprecatedInV12 === true,
      ),
    );
    si.parameters = knownSig.params.map(p =>
      new vscode.ParameterInformation(`${p.name}: ${p.type}`, p.doc ?? '')
    );
    help.signatures = [si];
    help.activeSignature = 0;
    help.activeParameter = Math.min(commaCount, knownSig.params.length - 1);
    return help;
  }
}
