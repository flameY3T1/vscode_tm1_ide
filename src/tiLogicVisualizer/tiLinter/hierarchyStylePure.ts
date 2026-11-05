/**
 * Hierarchy awareness: dimension form versus hierarchy form, mode
 * "uniform".
 *
 * For almost every dimension-wide access TM1 has a hierarchy-aware
 * version. `ELPAR('Kunde', sKunde, 1)` always reads the default hierarchy,
 * `ElementParent('Kunde', 'Region', sKunde, 1)` the named one. As long as a
 * process consistently uses the one kind, nothing is wrong with it — an
 * 11.x model without a second hierarchy gets by with the dimension form.
 *
 * Therefore ONLY the mixture is reported: as soon as the same process names a
 * hierarchy anywhere, the hierarchy-blind calls next to it are the
 * places that silently end up on the default hierarchy. That is the
 * class of error, not the dimension form itself. A process entirely without
 * hierarchy form stays silent — that is why the rule can be on by default.
 *
 * Two manifestations of the same thing:
 *
 * - `legacy-name`: a name that CANNOT take a hierarchy at all
 *   (`DIMSIZ`, `DimensionElementExists`, `SubsetCreate`, `ElementSecurityGet`).
 *   The hierarchy version is named differently.
 * - `missing-hierarchy-arg`: a long form that could take a hierarchy
 *   but is called without it (`ElementIndex(dim, elem)` instead of
 *   `ElementIndex(dim, hier, elem)`). Same name, omitted argument.
 *   Without this second case the rule missed the most common real mixture:
 *   a process that consistently uses the long form and forgets the
 *   hierarchy argument in one place.
 *
 * The pair table is maintained by hand, not derived from the names. A
 * mechanical match (cut off `Hierarchy` and look up) yields 52
 * pairs, several of which are wrong: `HierarchyAttrN(dim, hier, attr)` reads
 * an attribute OF THE HIERARCHY and is not a successor of
 * `ATTRN(dim, elem, attr)` — that is `ElementAttrN`. Likewise
 * `DimensionCreate`/`DimensionDestroy`/`DimensionExists` are not predecessors of
 * `HierarchyCreate`/`HierarchyDestroy`/`HierarchyExists`: they work on
 * different subjects. Also deliberately left out are
 * `DimensionSortOrder`, `DimensionDeleteElements`, `SubsetAttrInsert` and
 * `SubsetAttrDelete`, whose hierarchy versions mean different parameters.
 *
 * Pure text scan as in the version comparison (`versionCompatPure.ts`): this way
 * the check also applies in a section whose AST is stuck on a parse error.
 * The arity for `missing-hierarchy-arg` comes from `KNOWN_SIGNATURES`,
 * not from a second list in the header.
 *
 * Two things do NOT count as evidence of hierarchy awareness, both measured on
 * the real model (2026-09-01, 332 processes): a hierarchy argument
 * that equals the dimension (`ElementAttrInsert(csDim, csDim, …)` — the
 * default hierarchy carries the name of its dimension), and an empty
 * literal. Without this distinction the rule was 100 % false alarms on the
 * customer part. And the IBM Bedrock library is left out entirely,
 * see `isBedrockObject`.
 *
 * Occasion: comparison with the open TI linter deutschebahn/linti (C410). No
 * code taken over.
 */
import { KNOWN_SIGNATURES } from '../tiSignatures';
import { splitByCommaAtDepthZero } from './helpers/parse';
import { isStringLiteral } from './helpers/expressions';
import { stringLiteralInner, tiTokensMatch } from './helpers/calls';
import { stripNonCode } from './versionCompatPure';

export type HierarchyStyleKind = 'legacy-name' | 'missing-hierarchy-arg';

export interface HierarchyStyleHit {
  /** 0-based, like the line counting of vscode.Range. */
  line: number;
  startCol: number;
  endCol: number;
  /** Name in the spelling of the signature, not that of the source text. */
  name: string;
  /** Hierarchy-aware successor. For `missing-hierarchy-arg` the same name. */
  modern: string;
  kind: HierarchyStyleKind;
}

export interface HierarchyStyleCensus {
  /** Hierarchieblinde Aufrufe, in Quellreihenfolge. */
  legacy: HierarchyStyleHit[];
  /** Number of calls that name a hierarchy. */
  modernCount: number;
  /** First hierarchy-aware call — for the message text. */
  modernSample?: string;
}

/**
 * Dimension form → hierarchy form. Checked by hand, each entry a pair
 * of the same meaning with an inserted hierarchy argument.
 *
 * `src/test/tiLinter/hierarchyStylePure.test.ts` ensures that both names
 * of every pair are in `KNOWN_SIGNATURES` and that the hierarchy version requires exactly one
 * argument more — a rename in the signatures therefore cannot let the table
 * silently rot.
 */
export const HIERARCHY_PAIRS: ReadonlyArray<readonly [legacy: string, modern: string]> = [
  // Kurzform → Langform (Elementzugriff; die Langform nimmt die Hierarchie als
  // zweites Argument).
  ['DIMSIZ', 'ElementCount'],
  ['DIMNM', 'ElementName'],
  ['DIMIX', 'ElementIndex'],
  ['DTYPE', 'ElementType'],
  ['ELPAR', 'ElementParent'],
  ['ELPARN', 'ElementParentCount'],
  ['ELLEV', 'ElementLevel'],
  ['ELCOMP', 'ElementComponent'],
  ['ELCOMPN', 'ElementComponentCount'],
  ['ELWEIGHT', 'ElementWeight'],

  // Element attributes: short form → `ElementAttr*`. NOT `HierarchyAttr*` — that
  // reads an attribute of the hierarchy, not that of an element.
  ['ATTRN', 'ElementAttrN'],
  ['ATTRS', 'ElementAttrS'],
  ['AttrNL', 'ElementAttrNL'],
  ['AttrSL', 'ElementAttrSL'],
  ['AttrPutN', 'ElementAttrPutN'],
  ['AttrPutS', 'ElementAttrPutS'],
  ['AttrInsert', 'ElementAttrInsert'],
  ['AttrDelete', 'ElementAttrDelete'],

  // Dimensionsweite Elementpflege → `Hierarchy*`.
  ['DimensionElementExists', 'HierarchyElementExists'],
  ['DimensionElementDelete', 'HierarchyElementDelete'],
  ['DimensionElementInsert', 'HierarchyElementInsert'],
  ['DimensionElementInsertDirect', 'HierarchyElementInsertDirect'],
  ['DimensionElementDeleteDirect', 'HierarchyElementDeleteDirect'],
  ['DimensionElementPrincipalName', 'HierarchyElementPrincipalName'],
  ['DimensionElementComponentAdd', 'HierarchyElementComponentAdd'],
  ['DimensionElementComponentAddDirect', 'HierarchyElementComponentAddDirect'],
  ['DimensionElementComponentDelete', 'HierarchyElementComponentDelete'],
  ['DimensionElementComponentDeleteDirect', 'HierarchyElementComponentDeleteDirect'],
  ['DimensionTopElementInsert', 'HierarchyTopElementInsert'],
  ['DimensionTopElementInsertDirect', 'HierarchyTopElementInsertDirect'],
  ['DimensionDeleteAllElements', 'HierarchyDeleteAllElements'],
  ['DimensionTimeLastUpdated', 'HierarchyTimeLastUpdated'],
  ['DimensionUpdateDirect', 'HierarchyUpdateDirect'],

  // Teilmengen → `HierarchySubset*`.
  ['SubsetCreate', 'HierarchySubsetCreate'],
  ['SubsetDestroy', 'HierarchySubsetDestroy'],
  ['SubsetExists', 'HierarchySubsetExists'],
  ['SubsetDeleteAllElements', 'HierarchySubsetDeleteAllElements'],
  ['SubsetElementInsert', 'HierarchySubsetElementInsert'],
  ['SubsetElementDelete', 'HierarchySubsetElementDelete'],
  ['SubsetElementExists', 'HierarchySubsetElementExists'],
  ['SubsetElementGetIndex', 'HierarchySubsetElementGetIndex'],
  ['SubsetGetElementName', 'HierarchySubsetGetElementName'],
  ['SubsetGetSize', 'HierarchySubsetGetSize'],
  ['SubsetIsAllSet', 'HierarchySubsetIsAllSet'],
  ['SubsetMDXGet', 'HierarchySubsetMDXGet'],
  ['SubsetMDXSet', 'HierarchySubsetMDXSet'],
  ['SubsetAliasGet', 'HierarchySubsetAliasGet'],
  ['SubsetAliasSet', 'HierarchySubsetAliasSet'],
  ['SubsetAttrN', 'HierarchySubsetAttrN'],
  ['SubsetAttrS', 'HierarchySubsetAttrS'],
  ['SubsetAttrNL', 'HierarchySubsetAttrNL'],
  ['SubsetAttrSL', 'HierarchySubsetAttrSL'],
  ['SubsetAttrPutN', 'HierarchySubsetAttrPutN'],
  ['SubsetAttrPutS', 'HierarchySubsetAttrPutS'],

  // Elementsicherheit.
  ['ElementSecurityGet', 'HierarchyElementSecurityGet'],
  ['ElementSecurityPut', 'HierarchyElementSecurityPut'],
];

/**
 * Long forms in which the second argument is the hierarchy and may be omitted.
 * If it is missing, the default hierarchy applies — the same blind spot
 * as with a short-form name, only without a name change.
 *
 * The list is written out and not derived from `minParams`/`maxParams`,
 * because the figure alone does not carry: `ElementAttrNL` is
 * likewise at `[4-5]`, but its optional argument is the locale key
 * at the END — so the short form does name the hierarchy. Which position is
 * optional is not stated by the arity.
 */
export const OPTIONAL_HIERARCHY_ARG: readonly string[] = [
  'ElementCount',
  'ElementIndex',
  'ElementName',
  'ElementLevel',
  'ElementType',
  'ElementParent',
  'ElementParentCount',
  'ElementComponent',
  'ElementComponentCount',
  'ElementWeight',
];

/** Kleinbuchstaben-Name → [Originalschreibweise, Hierarchiefassung]. */
export const LEGACY_NAMES: Map<string, readonly [string, string]> = new Map(
  HIERARCHY_PAIRS.map(([legacy, modern]) => [legacy.toLowerCase(), [legacy, modern] as const]),
);

const OPTIONAL_LOWER = new Set(OPTIONAL_HIERARCHY_ARG.map(n => n.toLowerCase()));

/**
/**
 * Names whose mere occurrence marks the process as hierarchy-aware:
 * the whole `Hierarchy*` family from the signatures plus the successors of the
 * pair table that have no short version without a hierarchy (`ElementAttr*`).
 * The twelve from `OPTIONAL_HIERARCHY_ARG` count only WITH a hierarchy argument and
 * are therefore only decided when counting.
 */
export const MODERN_NAMES: Map<string, string> = new Map([
  ...[...KNOWN_SIGNATURES.entries()]
    .filter(([, sig]) => /^Hierarchy/i.test(sig.name))
    .map(([key, sig]) => [key, sig.name] as const),
  ...HIERARCHY_PAIRS
    .map(([, modern]) => modern)
    .filter(modern => !OPTIONAL_LOWER.has(modern.toLowerCase()))
    .map(modern => [modern.toLowerCase(), modern] as const),
]);

/**
/**
 * One pattern for all three name sets together. Longest first, because the
 * alternation is first-match (`AttrNL` before `ATTRN`,
 * `DimensionElementDeleteDirect` before `DimensionElementDelete`).
 *
 * The trailing word boundary protects additionally: in `SubsetGetElementName`
 * a word character precedes `ElementName`, so `\b` does not match there at all.
 */
let _pattern: RegExp | null | undefined;
function namePattern(): RegExp | null {
  if (_pattern === undefined) {
    const all = [
      ...LEGACY_NAMES.keys(),
      ...MODERN_NAMES.keys(),
      ...OPTIONAL_LOWER,
    ].sort((a, b) => b.length - a.length);
    _pattern = all.length === 0 ? null : new RegExp(`\\b(${all.join('|')})\\b`, 'gi');
  }
  return _pattern;
}

/**
/**
 * Reads the arguments of a call that ends at `nameEnd`. Expects the
 * opening parenthesis; without it this is not a call (a variable of the same
 * name, say) and the answer is `null`.
 *
 * The parentheses are searched in the MASKED text — none can come from a
 * literal there —, but the content is cut from the RAW text: the mask
 * blanks out strings, and two different literals of the same length
 * would look identical in it. Both texts have the same length character for
 * character, so the boundaries fit onto each other. The search runs across
 * line boundaries, because long calls are wrapped.
 */
function readArgs(masked: string, raw: string, nameEnd: number): string[] | null {
  let i = nameEnd;
  while (i < masked.length && /\s/.test(masked[i])) { i++; }
  if (masked[i] !== '(') { return null; }
  const open = i;
  let depth = 0;
  for (; i < masked.length; i++) {
    if (masked[i] === '(') { depth++; continue; }
    if (masked[i] === ')') {
      depth--;
      if (depth === 0) {
        const inner = raw.slice(open + 1, i);
        return inner.trim() === '' ? [] : splitByCommaAtDepthZero(inner);
      }
    }
  }
  return null; // unbalanced — no usable call
}

interface SigLike {
  params: ReadonlyArray<{ name: string }>;
}

/**
 * Says whether a call with a hierarchy argument actually addresses the
 * DEFAULT hierarchy. Two spellings, both measured on the real model
 * (2026-09-01, 332 processes):
 *
 * - `ElementAttrInsert(csDim, csDim, '', 'NAME', 'A')` — hierarchy equals
 *   dimension. The default hierarchy carries the name of its dimension, that is
 *   the usual spelling for "no hierarchy reference".
 * - `ElementIndex(sDim, '', sEl)` — empty literal.
 *
 * Without this distinction the rule was 100 % false alarms on the customer
 * part of the model: five processes, 51 findings, triggered without exception by
 * `ElementAttrInsert(x, x, …)`. Such calls therefore do NOT count as evidence
 * for hierarchy awareness — but they are not reported themselves either, because
 * the rule is about the mixture and not about the spelling.
 *
 * APPLIES ONLY TO THE LONG FORMS. For them the hierarchy argument is mandatory,
 * so `f(dim, dim, …)` is the mandatory spelling for "without hierarchy reference" and
 * no commitment. Whoever types `HierarchyElementExists`, on the other hand, has decided against
 * the shorter `DimensionElementExists` — that IS a commitment,
 * even if the call hits the default hierarchy. Measured (2026-09-01,
 * 332 processes): not a single `Hierarchy*(x, x, …)` call in the whole model,
 * all 219 name another hierarchy. So the exception costs nothing.
 */
function addressesDefaultHierarchy(sig: SigLike, args: string[]): boolean {
  const dimIdx = sig.params.findIndex(p => /^dim(ension)?name$/i.test(p.name));
  const hierIdx = sig.params.findIndex(p => /^hier(archy)?name$/i.test(p.name));
  if (dimIdx < 0 || hierIdx < 0 || hierIdx >= args.length) { return false; }
  const hier = args[hierIdx].trim();
  if (isStringLiteral(hier) && stringLiteralInner(hier) === '') { return true; }
  return dimIdx < args.length && tiTokensMatch(args[dimIdx], hier);
}

/**
/**
 * Takes the whole process text and says which calls are hierarchy-blind
 * and whether a hierarchy is named at all.
 *
 * The lines are masked individually and reassembled, so that the
 * argument counting can work across a line break while the columns
 * still match.
 */
export function censusHierarchyStyle(text: string): HierarchyStyleCensus {
  const pattern = namePattern();
  const empty: HierarchyStyleCensus = { legacy: [], modernCount: 0 };
  if (!pattern) { return empty; }

  const rawLines = text.split('\n');
  // `stripNonCode` cuts off the rest of the comment instead of overwriting it —
  // irrelevant for the line-by-line scan of the version comparison, but not here: the
  // reassembled text would be shorter than the source text and every hit
  // behind the first `#` would get the wrong line and column.
  const masked = rawLines.map(l => stripNonCode(l).padEnd(l.length, ' ')).join('\n');
  const lineStarts: number[] = [];
  let acc = 0;
  for (const l of rawLines) { lineStarts.push(acc); acc += l.length + 1; }

  const legacy: HierarchyStyleHit[] = [];
  let modernCount = 0;
  let modernSample: string | undefined;
  // The hits come in ascending order, so the line pointer advances along instead of
  // searching anew for each hit.
  let lineCursor = 0;

  pattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(masked)) !== null) {
    const lower = m[1].toLowerCase();
    const args = readArgs(masked, text, m.index + m[1].length);
    if (args === null) { continue; } // not a call
    const argc = args.length;

    const pair = LEGACY_NAMES.get(lower);
    const modernFixed = MODERN_NAMES.get(lower);
    const optional = OPTIONAL_LOWER.has(lower);

    let name: string | undefined;
    let modern: string | undefined;
    let kind: HierarchyStyleKind | undefined;

    if (pair) {
      [name, modern] = pair;
      kind = 'legacy-name';
    } else if (optional) {
      const sig = KNOWN_SIGNATURES.get(lower);
      // The short form omits exactly the hierarchy argument.
      if (sig && argc === sig.minParams && sig.maxParams === sig.minParams + 1) {
        name = sig.name;
        modern = sig.name;
        kind = 'missing-hierarchy-arg';
      } else if (sig) {
        if (!addressesDefaultHierarchy(sig, args)) {
          modernCount++;
          modernSample ??= sig.name;
        }
        continue;
      } else {
        continue;
      }
    } else if (modernFixed) {
      // The `Hierarchy*` family always counts — see the header of
      // `addressesDefaultHierarchy`. For the remaining successors
      // (`ElementAttr*`) `f(dim, dim, …)` is the mandatory spelling.
      const sig = KNOWN_SIGNATURES.get(lower);
      const explicit = /^hierarchy/i.test(modernFixed)
        || !sig || !addressesDefaultHierarchy(sig, args);
      if (explicit) {
        modernCount++;
        modernSample ??= modernFixed;
      }
      continue;
    } else {
      continue;
    }

    // Compute line/column back from the location in the reassembled text.
    while (lineCursor + 1 < lineStarts.length && lineStarts[lineCursor + 1] <= m.index) { lineCursor++; }
    const startCol = m.index - lineStarts[lineCursor];
    legacy.push({ line: lineCursor, startCol, endCol: startCol + m[1].length, name, modern, kind });
  }

  return { legacy, modernCount, modernSample };
}

/**
 * The IBM Bedrock library is left out — same reasoning as for
 * `unused-variable`/`dead-store` (`LintOptions.bedrockMode`): foreign code that
 * nobody edits here.
 *
 * Not guessed, counted (2026-09-01, 332 processes of the test instance): of 33
 * mixed processes 28 were `}bedrock.*`, and they carried 270 of the 321
 * findings. The mixture in them is real — `}bedrock.dim.clone` puts `DIMIX`
 * next to `ElementIndex(dim, hier, …)` —, nobody just changes it.
 */
export function isBedrockObject(name: string | undefined): boolean {
  return !!name && /^\}bedrock\./i.test(name.trim());
}
