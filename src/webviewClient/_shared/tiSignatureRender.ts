/**
 * Pure render helpers for TI function signatures, shared by the process-editor
 * and rule-editor Monaco completion / hover providers (S3 dedup).
 *
 * No Monaco, no DOM, no module state. Builders accept structural subsets of
 * `TiKnownSignature` so callers can pass `KNOWN_SIGNATURES` entries directly.
 *
 * Superset semantics (both editors draw from the same KNOWN_SIGNATURES):
 *  - `buildSnippetInsertText` emits a bare name (no parens) for a 0-arg *void*
 *    statement (ProcessBreak, SaveDataAll, …). 0-arg non-void funcs (Now,
 *    Rand, …) still get `Name()`.
 *  - `buildMarkdownDoc` renders the optional performance-note hint.
 */

export {};

export interface SignatureParam {
  name: string;
  type: string;
  doc?: string;
}

export interface FunctionSignature {
  name: string;
  params: SignatureParam[];
  minParams: number;
  maxParams: number;
  returnType: string;
  description?: string;
  docUrl?: string;
  docUrlV12?: string;
  deprecatedInV12?: boolean;
  performanceNote?: { recommended: string; reason: string };
}

/**
 * Render a TI signature as `Name(p1, p2, ...)`. Variadic signatures
 * (`maxParams === Infinity`) append a `, ...` marker.
 */
export function buildSignatureLabel(sig: Pick<FunctionSignature, 'name' | 'params' | 'maxParams'>): string {
  const names = sig.params.map((p) => p.name);
  const paramStr = sig.maxParams === Infinity ? names.join(', ') + ', ...' : names.join(', ');
  return `${sig.name}(${paramStr})`;
}

/**
 * Build a Monaco snippet insert text with `${1:param}` placeholders.
 * - 0-arg void statement → bare `Name`; other 0-arg func → `Name()`.
 * - String-typed params are wrapped in single quotes.
 * - Variadic signatures emit only `minParams` placeholders (or fewer if
 *   `params.length` is smaller); the variable tail is filled by context AC.
 */
export function buildSnippetInsertText(
  sig: Pick<FunctionSignature, 'name' | 'params' | 'minParams' | 'maxParams' | 'returnType'>,
): string {
  if (sig.params.length === 0 && sig.returnType === 'void') { return sig.name; }
  if (sig.params.length === 0) { return sig.name + '()'; }
  const placeholderCount = sig.maxParams === Infinity
    ? Math.min(sig.minParams, sig.params.length)
    : sig.params.length;
  const selected = sig.params.slice(0, placeholderCount);
  const parts = selected.map((p, i) => {
    const placeholder = `\${${i + 1}:${p.name}}`;
    return p.type === 'string' ? `'${placeholder}'` : placeholder;
  });
  return `${sig.name}(${parts.join(', ')})`;
}

/**
 * Optional localized labels for `buildMarkdownDoc`. Each field is a raw string
 * (possibly with `{0}`/`{1}` positional placeholders) resolved by the caller
 * from the injected `window.__l10n` map. When omitted, English defaults apply
 * so the pure module (and its unit tests) stay locale-independent.
 */
export interface MarkdownDocLabels {
  /** Header above the parameter list. Default `'**Parameters:**'`. */
  parameters?: string;
  /** Return-type line; `{0}` = returnType. Default `'**Returns:** *{0}*'`. */
  returns?: string;
  /** Variadic note; `{0}` = minParams. Default `'*Variadic: at least {0} arguments.*'`. */
  variadic?: string;
  /** v12-deprecated warning. Default English one-liner. */
  deprecatedV12?: string;
  /** Performance hint; `{0}` = recommended section, `{1}` = reason. */
  performance?: string;
}

const DEFAULT_MARKDOWN_DOC_LABELS: Required<MarkdownDocLabels> = {
  parameters: '**Parameters:**',
  returns: '**Returns:** *{0}*',
  variadic: '*Variadic: at least {0} arguments.*',
  deprecatedV12: '⚠️ **Not available in TM1 v12 (Planning Analytics Cloud Native).**',
  performance: '💡 **Performance:** Ideal in the `{0}` section ({1}).',
};

/** Positional `{0}`/`{1}` interpolation, matching `_shared/l10n.ts#fmt`. */
function fmtLabel(tpl: string, ...args: (string | number)[]): string {
  return tpl.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ''));
}

/**
 * Render a hover markdown doc for a TI signature: fenced signature block,
 * optional description, parameter list, return type, variadic note,
 * v12-deprecated warning, performance hint, and optional IBM-Docs link.
 *
 * `labels` supplies localized strings (see `MarkdownDocLabels`); when omitted,
 * English defaults are used so the pure module is locale-independent.
 * `v12` picks the 3.1.0 doc page over the 2.1.0 one.
 */
export function buildMarkdownDoc(sig: FunctionSignature, labels?: MarkdownDocLabels, v12 = false): string {
  const L: Required<MarkdownDocLabels> = {
    parameters: labels?.parameters ?? DEFAULT_MARKDOWN_DOC_LABELS.parameters,
    returns: labels?.returns ?? DEFAULT_MARKDOWN_DOC_LABELS.returns,
    variadic: labels?.variadic ?? DEFAULT_MARKDOWN_DOC_LABELS.variadic,
    deprecatedV12: labels?.deprecatedV12 ?? DEFAULT_MARKDOWN_DOC_LABELS.deprecatedV12,
    performance: labels?.performance ?? DEFAULT_MARKDOWN_DOC_LABELS.performance,
  };
  const lines: string[] = [];
  lines.push('```ti');
  lines.push(buildSignatureLabel(sig));
  lines.push('```');
  lines.push('');
  if (sig.description) {
    lines.push(sig.description);
    lines.push('');
  }
  if (sig.params.length > 0) {
    lines.push(L.parameters);
    for (const p of sig.params) {
      const doc = p.doc ? ` — ${p.doc}` : '';
      lines.push(`- \`${p.name}\` *(${p.type})*${doc}`);
    }
    lines.push('');
  }
  lines.push(fmtLabel(L.returns, sig.returnType));
  if (sig.maxParams === Infinity) {
    lines.push('');
    lines.push(fmtLabel(L.variadic, sig.minParams));
  }
  if (sig.deprecatedInV12) {
    lines.push('');
    lines.push(L.deprecatedV12);
  }
  if (sig.performanceNote) {
    lines.push('');
    lines.push(fmtLabel(L.performance, sig.performanceNote.recommended, sig.performanceNote.reason));
  }
  const docUrl = v12 ? sig.docUrlV12 ?? sig.docUrl : sig.docUrl;
  if (docUrl) {
    lines.push('');
    lines.push(`[IBM Docs](${docUrl})`);
  }
  return lines.join('\n');
}

/**
 * Extract `MarkdownDocLabels` from an injected `window.__l10n` map (see
 * `_shared/l10n.ts`). Missing keys stay `undefined` so `buildMarkdownDoc`
 * falls back to its English defaults. Keys: `sigParameters`, `sigReturns`,
 * `sigVariadic`, `sigDeprecatedV12`, `sigPerformance`.
 */
export function markdownDocLabelsFromL10n(map: Record<string, string>): MarkdownDocLabels {
  return {
    parameters: map.sigParameters,
    returns: map.sigReturns,
    variadic: map.sigVariadic,
    deprecatedV12: map.sigDeprecatedV12,
    performance: map.sigPerformance,
  };
}
