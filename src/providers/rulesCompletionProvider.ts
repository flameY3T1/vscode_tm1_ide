import * as vscode from 'vscode';
import { KNOWN_SIGNATURES, docUrlFor } from '../tiLogicVisualizer/tiSignatures';
import { isV12Active } from '../utils/v12Mode';
import { fetchNames } from './fetchNames';
import { serverConfigForUri } from './serverConfigForFile';

function buildCompletionDoc(description: string | undefined, docUrl: string | undefined, deprecated: boolean): vscode.MarkdownString {
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

// Functions valid in TM1 Rules.
const RULES_FUNCTION_KEYS = new Set([
  'db', 'cellgetn', 'cellgets', 'cellputn', 'cellputs',
  'cellisupdateable',
  'attrs', 'attrn', 'attre',
  'elementindex', 'elementname', 'elementlevel',
  'elementcomponent', 'elementcomponentcount', 'elementweight',
  'elementtype', 'elementparent', 'elementparentcount',
  'dimsiz', 'dimnm', 'dimix', 'dtype', 'dnlev', 'dnext',
  'elpar', 'elparn', 'elcomp', 'elcompn', 'elweight', 'ellev',
  'elisanc', 'elispar', 'eliscomp',
  'elementfirst', 'elementnext', 'elementisancestor', 'elementiscomponent', 'elementisparent',
  'hierarchy', 'hierarchycount', 'hierarchyindex', 'hierarchyn',
  'consolidatechildren', 'consolidatedavg', 'consolidatedcount', 'consolidatedcountunique',
  'consolidatedmax', 'consolidatedmin',
  'undef', 'undefvals', 'undefinedcellvalue', 'isundefinedcellvalue', 'isleaf', 'stet',
  'cellvaluen', 'cellvalues',
  'str', 'trim', 'long', 'scan', 'subst', 'upper', 'lower',
  'char', 'code', 'fill', 'capit', 'delet', 'insrt', 'numbr',
  'int', 'round', 'abs', 'mod', 'max', 'min', 'power', 'exp', 'sign',
  'log', 'log10', 'ln', 'sqrt', 'sin', 'cos', 'tan', 'acos', 'asin', 'atan',
  'fv', 'pv', 'paymt',
  'now', 'today', 'date', 'dates', 'time', 'dayno', 'month', 'year', 'day',
  'hour', 'minute', 'second', 'timst',
  'isund',
  'numbertostring', 'stringtonumber', 'expand', 'nvalue', 'svalue',
  'rand',
]);

/**
 * Completion for built-in functions valid in TM1 Rules (.rux files).
 * Subset of TiFunctionCompletionProvider, filtered to rules-relevant functions.
 */
export class RulesFunctionCompletionProvider implements vscode.CompletionItemProvider {
  /** Same items twice; they differ only in the IBM doc link (2.1.0 vs 3.1.0). */
  private readonly items: vscode.CompletionItem[];
  private readonly itemsV12: vscode.CompletionItem[];

  constructor() {
    this.items = RulesFunctionCompletionProvider.build(false);
    this.itemsV12 = RulesFunctionCompletionProvider.build(true);
  }

  private static build(v12: boolean): vscode.CompletionItem[] {
    return [...KNOWN_SIGNATURES.entries()]
      .filter(([key]) => RULES_FUNCTION_KEYS.has(key))
      .map(([, sig]) => {
        const paramList = sig.params.map(p => p.name).join(', ');
        const item = new vscode.CompletionItem(sig.name, vscode.CompletionItemKind.Function);
        item.detail = `${sig.name}(${paramList}) → ${sig.returnType}`;
        item.documentation = buildCompletionDoc(sig.description, docUrlFor(sig, v12), sig.deprecatedInV12 === true);
        item.insertText = sig.params.length === 0
          ? new vscode.SnippetString(`${sig.name}()`)
          : new vscode.SnippetString(
              `${sig.name}(${sig.params.map((p, i) => `\${${i + 1}:${p.name}}`).join(', ')})`
            );
        item.sortText = '1' + sig.name.toLowerCase();
        return item;
      });
  }

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const line = document.lineAt(position).text;
    if (/^\s*#/.test(line)) { return []; }

    const items = isV12Active(serverConfigForUri(document.uri)) ? this.itemsV12 : this.items;
    const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z]\w*/);
    if (!wordRange) { return items; }
    const typed = document.getText(wordRange).toLowerCase();
    if (typed.length < 1) { return []; }
    return items.filter(item => (item.label as string).toLowerCase().includes(typed));
  }
}

const RULE_KEYWORDS = [
  { label: 'FEEDERS',   detail: vscode.l10n.t('Start feeder block'),  insert: 'FEEDERS;' },
  { label: 'SKIPCHECK', detail: vscode.l10n.t('Skip check'),          insert: 'SKIPCHECK;' },
  { label: 'C:',        detail: vscode.l10n.t('Consolidation rule'),  insert: 'C:' },
  { label: 'N:',        detail: vscode.l10n.t('Numeric rule'),        insert: 'N:' },
  { label: 'S:',        detail: vscode.l10n.t('String rule'),         insert: 'S:' },
];

/**
 * Completion for TM1 Rules keywords (FEEDERS, SKIPCHECK, C:, N:, S:)
 * and cell-reference snippet ['Dim':'Elem'].
 */
export class RulesKeywordCompletionProvider implements vscode.CompletionItemProvider {
  private readonly items: vscode.CompletionItem[];

  constructor() {
    this.items = RULE_KEYWORDS.map(kw => {
      const item = new vscode.CompletionItem(kw.label, vscode.CompletionItemKind.Keyword);
      item.detail = kw.detail;
      item.insertText = kw.insert;
      item.filterText = kw.label.replace(':', '').toLowerCase();
      item.sortText = '0' + kw.label.toLowerCase();
      return item;
    });

    // Cell reference snippet
    const cellRef = new vscode.CompletionItem("['Dim':'Elem']", vscode.CompletionItemKind.Snippet);
    cellRef.detail = 'Zell-Referenz';
    cellRef.insertText = new vscode.SnippetString("['${1:Dimension}':'${2:Element}']");
    cellRef.filterText = 'cell';
    cellRef.sortText = '0z';
    this.items.push(cellRef);
  }

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const line = document.lineAt(position).text;
    if (/^\s*#/.test(line)) { return []; }

    const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z]\w*/);
    const typed = wordRange ? document.getText(wordRange).toLowerCase() : '';
    if (typed.length < 1) { return []; }
    return this.items.filter(item => (item.filterText as string).includes(typed));
  }
}

/**
 * Server-based completion for TM1 Rules:
 * - DB(' → cube names
 * - [' → dimension names
 * Reuses the shared fetchNames() cache from tm1CompletionProvider.
 */
export class RulesServerCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[] | undefined> {
    const line = document.lineAt(position).text;
    if (/^\s*#/.test(line)) { return undefined; }

    const before = line.slice(0, position.character);

    // After DB(' → suggest cube names
    if (/\bDB\s*\(\s*'[^']*$/.test(before)) {
      const names = await fetchNames('Cubes', serverConfigForUri(document.uri));
      if (names.length === 0) { return undefined; }
      const prefix = /[^']*$/.exec(before)?.[0] ?? '';
      return names.map(name => {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
        item.detail = 'TM1 Cube';
        item.insertText = name;
        item.filterText = prefix + name;
        item.sortText = name.toLowerCase();
        return item;
      });
    }

    // After [' → suggest dimension names
    if (/\['[^'\]]*$/.test(before)) {
      const names = await fetchNames('Dimensions', serverConfigForUri(document.uri));
      if (names.length === 0) { return undefined; }
      const prefix = /[^']*$/.exec(before)?.[0] ?? '';
      return names.map(name => {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Enum);
        item.detail = 'TM1 Dimension';
        item.insertText = name;
        item.filterText = prefix + name;
        item.sortText = name.toLowerCase();
        return item;
      });
    }

    return undefined;
  }
}
