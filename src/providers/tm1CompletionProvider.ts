import * as vscode from 'vscode';
import { KNOWN_SIGNATURES, docUrlFor } from '../tiLogicVisualizer/tiSignatures';
import { fetchNames } from './fetchNames';
import { parseParametersFromFileContent } from '../utils/proFile';
import { getTiContextEndpoint } from './tiContextPatternsPure';
import { parseSections } from '../utils/proFile';
import { parseDsVariables } from './tm1CompletionProviderPure';
import { isV12Active } from '../utils/v12Mode';
import { serverConfigForUri } from './serverConfigForFile';

/**
 * Builds the `documentation` MarkdownString for a TI-function completion
 * item. Shows the description plus an IBM-docs link; a deprecated notice
 * where relevant.
 */
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

// keyword prefix → TM1 endpoint and label
// Labels are functions: `vscode.l10n.t` must run after activation, not at module load.
const KEYWORDS: Array<{ prefix: string; endpoint: string; label: () => string }> = [
  { prefix: 'cube',  endpoint: 'Cubes',       label: () => vscode.l10n.t('TM1 Cube') },
  { prefix: 'dim',   endpoint: 'Dimensions',  label: () => vscode.l10n.t('TM1 Dimension') },
  { prefix: 'hier',  endpoint: 'Hierarchies', label: () => vscode.l10n.t('TM1 Hierarchy') },
  { prefix: 'proc',  endpoint: 'Processes',   label: () => vscode.l10n.t('TM1 Process') },
  { prefix: 'chore', endpoint: 'Chores',      label: () => vscode.l10n.t('TM1 Chore') },
];

const MIN_LEN = 2;

const kindMap: Record<string, vscode.CompletionItemKind> = {
  Cubes:       vscode.CompletionItemKind.Class,
  Dimensions:  vscode.CompletionItemKind.Enum,
  Hierarchies: vscode.CompletionItemKind.Interface,
  Processes:   vscode.CompletionItemKind.Function,
  Chores:      vscode.CompletionItemKind.Module,
};


/**
 * Provides completion items for all built-in TI functions from KNOWN_SIGNATURES.
 * Triggers on any alphabetic word and filters by prefix.
 */
export class TiFunctionCompletionProvider implements vscode.CompletionItemProvider {
  /** All suggestions — including the ones that only exist from v12 on. */
  private readonly items: vscode.CompletionItem[];
  /** The same ones without the v12 functions. On 11.x, this list is served. */
  private readonly itemsV11: vscode.CompletionItem[];

  constructor() {
    const v12OnlyLabels = new Set(
      [...KNOWN_SIGNATURES.values()].filter(sig => sig.v12Only).map(sig => sig.name),
    );
    // Built twice because the IBM doc link differs per line (2.1.0 vs 3.1.0).
    this.items = TiFunctionCompletionProvider.build(true);
    this.itemsV11 = TiFunctionCompletionProvider.build(false).filter(item => !v12OnlyLabels.has(item.label as string));
  }

  private static build(v12: boolean): vscode.CompletionItem[] {
    return [...KNOWN_SIGNATURES.values()].filter(sig => !sig.rulesOnly).map(sig => {
      const docUrl = docUrlFor(sig, v12);
      const paramList = sig.params.map(p => p.name).join(', ');
      // Built-in TI variables are assigned, not called. Suggesting them as
      // a function with parentheses teaches a form that TM1 rejects.
      if (sig.assignable) {
        const v = new vscode.CompletionItem(sig.name, vscode.CompletionItemKind.Variable);
        v.detail = `${sig.name} → ${sig.returnType} (Zuweisung)`;
        v.documentation = buildCompletionDoc(sig.description, docUrl, sig.deprecatedInV12 === true);
        v.insertText = new vscode.SnippetString(sig.name);
        v.sortText = sig.name.toLowerCase();
        return v;
      }
      const item = new vscode.CompletionItem(sig.name, vscode.CompletionItemKind.Function);
      item.detail = `${sig.name}(${paramList}) → ${sig.returnType}`;
      item.documentation = buildCompletionDoc(sig.description, docUrl, sig.deprecatedInV12 === true);
      item.insertText = sig.params.length === 0 && sig.returnType === 'void'
        ? new vscode.SnippetString(sig.name)
        : sig.params.length === 0
          ? new vscode.SnippetString(`${sig.name}()`)
          : new vscode.SnippetString(
              `${sig.name}(${sig.params.map((p, i) => `\${${i + 1}:${p.name}}`).join(', ')})`
            );
      item.sortText = sig.name.toLowerCase();
      return item;
    });
  }

  /**
   * The list that matches the current server situation. A loose `.pro` file
   * has no server reference — then the `tm1.v12Mode` switch decides alone,
   * exactly as with the linter (`isV12Active`).
   */
  private currentItems(document: vscode.TextDocument): vscode.CompletionItem[] {
    return isV12Active(serverConfigForUri(document.uri)) ? this.items : this.itemsV11;
  }

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const items = this.currentItems(document);
    const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z]\w*/);
    if (!wordRange) { return items; }
    const typed = document.getText(wordRange).toLowerCase();
    if (typed.length < 2) { return []; }
    // Keep items whose name contains the typed string (prefix or infix).
    // This covers "dim" → "DimensionElementInsert" and "cellget" → "CellGetN".
    return items.filter(item =>
      (item.label as string).toLowerCase().includes(typed),
    );
  }
}

/** TI control keywords that should not appear as variable completions */
const TI_KEYWORDS = new Set([
  'if', 'elseif', 'else', 'endif', 'while', 'endwhile',
]);

/** Built-in function names (lowercase) — pre-built once from KNOWN_SIGNATURES */
const BUILTIN_NAMES: Set<string> = new Set(
  [...KNOWN_SIGNATURES.keys()].map(k => k.toLowerCase()),
);

/**
 * Scans raw TI code text and returns all identifier-like words that are not
 * built-in functions or keywords. Strips string literals and line comments first.
 */
function scanIdentifiers(code: string): Set<string> {
  // Strip single-quoted string literals and # comments
  const stripped = code
    .replace(/'[^']*'/g, ' ')
    .replace(/#[^\n]*/g, ' ');

  const found = new Set<string>();
  const re = /\b([a-zA-Z][a-zA-Z0-9_]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const word = m[1];
    const lower = word.toLowerCase();
    if (lower.length >= 2 && !TI_KEYWORDS.has(lower) && !BUILTIN_NAMES.has(lower)) {
      found.add(word);
    }
  }
  return found;
}

/** Parsed, document-version-keyed inputs for variable completion. */
interface TiVariableParse {
  parameters: ReturnType<typeof parseParametersFromFileContent>;
  dsVariables: ReturnType<typeof parseDsVariables>;
  identifiers: Set<string>;
}

/**
 * Memoized per-document parse for {@link TiVariableCompletionProvider}.
 * Keyed by document identity (WeakMap) + `document.version`: on same-version
 * calls (cursor moves, retrigger without edit) the full-document passes
 * (parameters, datasource vars, sections, identifier scan) are reused; any
 * edit bumps `version` and forces a recompute so suggestions stay correct.
 * WeakMap keeps only the last entry per live document → bounded, GC-friendly.
 */
const _tiVarParseCache = new WeakMap<vscode.TextDocument, { version: number; data: TiVariableParse }>();

/**
 * Returns the parsed variable inputs for `document`, recomputing only when the
 * document version changed since the cached entry. Exported for tests.
 */
export function getTiVariableParse(document: vscode.TextDocument): TiVariableParse {
  const cached = _tiVarParseCache.get(document);
  if (cached && cached.version === document.version) {
    return cached.data;
  }

  const content = document.getText();
  const parameters = parseParametersFromFileContent(content);
  const dsVariables = parseDsVariables(content);

  const sections = parseSections(content);
  const hasMarkers = sections.prolog || sections.metadata || sections.data || sections.epilog;
  const codeText = hasMarkers
    ? [sections.prolog, sections.metadata, sections.data, sections.epilog].join('\n')
    : content;
  const identifiers = scanIdentifiers(codeText);

  const data: TiVariableParse = { parameters, dsVariables, identifiers };
  _tiVarParseCache.set(document, { version: document.version, data });
  return data;
}

/**
 * Provides completion items for variables, parameters and datasource variables
 * found in the current .pro/.ti document.
 * - Parameters: from .pro file header (codes 560/561)
 * - Datasource variables: from .pro file header (codes 577–581)
 * - Variables: all identifiers found anywhere in the code sections
 */
export class TiVariableCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z]\w*/);
    if (!wordRange) { return []; }
    const typed = document.getText(wordRange).toLowerCase();
    if (typed.length < 2) { return []; }

    // Memoized full-document parse (keyed by document identity + version).
    const { parameters, dsVariables, identifiers } = getTiVariableParse(document);
    const items: vscode.CompletionItem[] = [];
    const seen = new Set<string>(); // lowercase dedup key

    /** Returns true if `name` contains `typed` as a substring (case-insensitive)
     *  OR as a camelCase subsequence, e.g. "pd" matches "pDim". */
    const matches = (name: string): boolean => {
      const lower = name.toLowerCase();
      if (lower.includes(typed)) { return true; }
      // camelCase subsequence: every char of typed must appear in order at a
      // word-boundary (start or after an uppercase letter) of name
      let ti = 0;
      for (let i = 0; i < name.length && ti < typed.length; i++) {
        if (name[i].toLowerCase() === typed[ti]) { ti++; }
      }
      return ti === typed.length;
    };

    const makeItem = (
      name: string,
      kind: vscode.CompletionItemKind,
      detail: string,
      sortPrefix: string,
    ): vscode.CompletionItem => {
      const item = new vscode.CompletionItem(name, kind);
      item.detail = detail;
      // No filterText — VS Code uses the label with its original casing,
      // enabling camelCase matching: "dim" matches "pDim", "pd" matches "pDim"
      item.sortText = sortPrefix + name.toLowerCase();
      return item;
    };

    // 1. Parameters from .pro header (codes 560/561)
    for (const p of parameters) {
      if (seen.has(p.Name.toLowerCase())) { continue; }
      if (!matches(p.Name)) { continue; }
      seen.add(p.Name.toLowerCase());
      items.push(makeItem(p.Name, vscode.CompletionItemKind.TypeParameter,
        `Parameter (${p.Type === 2 ? 'String' : 'Numeric'})`, '0'));
    }

    // 2. Datasource variables from .pro header (codes 577–578)
    for (const v of dsVariables) {
      if (seen.has(v.Name.toLowerCase())) { continue; }
      if (!matches(v.Name)) { continue; }
      seen.add(v.Name.toLowerCase());
      items.push(makeItem(v.Name, vscode.CompletionItemKind.Field,
        `Datasource-Variable (${v.Type})`, '1'));
    }

    // 3. All identifiers in code sections
    for (const name of identifiers) {
      if (seen.has(name.toLowerCase())) { continue; }
      if (!matches(name)) { continue; }
      seen.add(name.toLowerCase());
      items.push(makeItem(name, vscode.CompletionItemKind.Variable, 'Variable', '2'));
    }

    return items;
  }
}

/**
 * Context-aware completion for TM1 object names inside string literal arguments.
 * Triggered by `'` — detects which TI function the cursor is in and suggests
 * cube names or dimension names depending on the argument position.
 *
 * Examples:
 *   CellGetN('|      → cube names (arg 0)
 *   CellPutN(100, '| → cube names (arg 1)
 *   DimensionCreate('| → dimension names (arg 0)
 */
export class TiContextCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.CompletionItem[] | undefined> {
    const line = document.lineAt(position).text;
    // Skip comment lines
    if (/^\s*#/.test(line)) { return undefined; }

    const before = line.slice(0, position.character);
    const endpoint = getTiContextEndpoint(before);
    if (endpoint === null) { return undefined; }

    const names = await fetchNames(endpoint, serverConfigForUri(document.uri));
    // Bail if a newer completion request superseded this one during the await.
    if (token?.isCancellationRequested) { return undefined; }
    if (names.length === 0) { return undefined; }

    // Text typed after the last opening quote — used as the filter prefix
    const prefix = /[^']*$/.exec(before)?.[0] ?? '';
    const label = endpoint === 'Cubes' ? vscode.l10n.t('TM1 Cube')
                : endpoint === 'Processes' ? vscode.l10n.t('TM1 Process')
                : vscode.l10n.t('TM1 Dimension');

    return names.map(name => {
      const item = new vscode.CompletionItem(name, kindMap[endpoint] ?? vscode.CompletionItemKind.Value);
      item.detail = label;
      item.insertText = name;
      // filterText trick (same as RulesServerCompletionProvider):
      // prefix + name ensures VS Code's built-in filtering keeps this item
      // visible when the user continues typing after the opening quote.
      item.filterText = prefix + name;
      item.sortText = name.toLowerCase();
      return item;
    });
  }
}

export class Tm1CompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.CompletionItem[] | undefined> {
    const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z]\w*/);
    if (!wordRange) { return undefined; }

    const word = document.getText(wordRange).toLowerCase();
    if (word.length < MIN_LEN) { return undefined; }

    const trigger = KEYWORDS.find(k => k.prefix.startsWith(word) || word.startsWith(k.prefix));
    if (!trigger) { return undefined; }

    const names = await fetchNames(trigger.endpoint, serverConfigForUri(document.uri));
    // Bail if a newer completion request superseded this one during the await.
    if (token?.isCancellationRequested) { return undefined; }
    if (names.length === 0) { return undefined; }

    return names.map(name => {
      const item = new vscode.CompletionItem(name, kindMap[trigger.endpoint] ?? vscode.CompletionItemKind.Value);
      item.detail = trigger.label();
      item.range = wordRange;
      item.insertText = name;
      item.filterText = word + name;
      item.sortText = name.toLowerCase();
      return item;
    });
  }
}
