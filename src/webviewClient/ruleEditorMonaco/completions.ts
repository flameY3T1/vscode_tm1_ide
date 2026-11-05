import type * as monacoType from 'monaco-editor';
import { KNOWN_SIGNATURES } from '../../tiLogicVisualizer/tiSignatures';
import {
  buildSignatureLabel,
  buildSnippetInsertText,
  buildMarkdownDoc,
  markdownDocLabelsFromL10n,
  getFuncArgContext,
  buildCubeInsertText,
} from './completionsPure';
import { SNIPPET_RULE, KIND_FUNCTION, KIND_KEYWORD, KIND_VALUE, KIND_SNIPPET } from '../_shared/monacoEnums';
import { getL10n, fmt } from '../_shared/l10n';

const L = getL10n();
const MD_LABELS = markdownDocLabelsFromL10n(L);
/** Injected by the host from the panel's connection; picks the 3.1.0 IBM doc page over 2.1.0. */
const V12 = (globalThis as unknown as { __v12?: boolean }).__v12 === true;

/**
 * Functions the rule editor offers, keyed lowercase.
 *
 * This is an ALLOWLIST, unlike the TI editor which filters by `!sig.rulesOnly`.
 * New signatures therefore show up in TI on their own but must be added here by
 * hand — which is how ROUNDP stayed missing. `ruleFunctionAllowlist.test.ts`
 * guards both directions: no key without a signature, no rulesOnly function left
 * out. Membership follows IBM's own wording ("valid in both rules and
 * TurboIntegrator processes"); TI-only functions must NOT be listed.
 *
 * DB is deliberately absent: it has no entry in `KNOWN_SIGNATURES` and is pushed
 * as an explicit suggestion in `registerWordCompletions` instead. Listing it here
 * did nothing.
 *
 * NValue and SValue are deliberately absent too, and for a different reason: they
 * are not functions but TurboIntegrator LOCAL VARIABLES, meaningful only when
 * `DatasourceType='VIEW'` (IBM docs, `?topic=variables-nvalue` / `?topic=tlv-svalue`).
 * They live in `tiLogicVisualizer/tiSystemVars.ts` and belong to TI, not to rules.
 *
 * Exported for that test.
 */
export const RULES_FUNCTION_KEYS = new Set([
  'cellgetn', 'cellgets', 'cellputn', 'cellputs',
  'cellisupdateable',
  'attrs', 'attrn',
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
  'int', 'round', 'abs', 'mod', 'max', 'min', 'exp', 'sign',
  'log', 'ln', 'sqrt', 'sin', 'cos', 'tan', 'acos', 'asin', 'atan',
  'fv', 'pv', 'paymt',
  'now', 'today', 'date', 'dates', 'time', 'dayno', 'month', 'year', 'day',
  'timst',
  'isund',
  'numbertostring', 'stringtonumber', 'expand',
  'rand',
  // Live gegen die IBM-Doku geprueft (2026-08-07): 'valid in both rules and
  // TurboIntegrator processes'.
  'roundp', 'elementcount', 'elementattrn', 'elementattrs', 'levelcount', 'codew', 'tabdim',
]);

const SECTION_KEYWORDS = [
  { label: 'FEEDERS',     insert: 'FEEDERS;',     detail: 'Rules Section' },
  { label: 'SKIPCHECK',   insert: 'SKIPCHECK;',   detail: 'Rules Section' },
  { label: 'FEEDSTRINGS', insert: 'FEEDSTRINGS;', detail: 'Rules Section' },
  { label: 'STET',        insert: 'STET',         detail: L.detailRuleConstNoCalc },
  { label: 'CONTINUE',    insert: 'CONTINUE',     detail: L.detailRuleConstNextRule },
];
const RULE_TYPE_KEYWORDS = [
  { label: 'C:', insert: 'C:' },
  { label: 'N:', insert: 'N:' },
  { label: 'S:', insert: 'S:' },
];
const CONTROL_FLOW = ['IF', 'ELSE', 'ELSEIF', 'ENDIF'];

// Monaco enum numeric literals: ../_shared/monacoEnums (S3 dedup).

function rulesSignatures() {
  return Array.from(KNOWN_SIGNATURES.entries())
    .filter(([key]) => RULES_FUNCTION_KEYS.has(key))
    .map(([, sig]) => sig);
}

// buildSignatureLabel, buildSnippetInsertText, buildMarkdownDoc → completionsPure

export function registerHover(monaco: typeof monacoType): void {
  const rulesSigs = new Map(rulesSignatures().map(s => [s.name.toLowerCase(), s]));
  monaco.languages.registerHoverProvider('tm1rules', {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) { return null; }
      const sig = rulesSigs.get(word.word.toLowerCase());
      if (!sig) { return null; }
      return {
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        },
        contents: [{ value: buildMarkdownDoc(sig, MD_LABELS, V12) }],
      };
    },
  });
}

export function registerWordCompletions(monaco: typeof monacoType): void {
  const sigs = rulesSignatures();
  monaco.languages.registerCompletionItemProvider('tm1rules', {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const lineContent = model.getLineContent(position.lineNumber);
      if (/^\s*#/.test(lineContent)) { return { suggestions: [] }; }

      const range: monacoType.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const suggestions: monacoType.languages.CompletionItem[] = [];

      // DB is a rules-only function — not in KNOWN_SIGNATURES. Add it here so it shows
      // up in word completions; the cube and dim args are filled by context AC after the `(`.
      suggestions.push({
        label: 'DB',
        kind: KIND_FUNCTION,
        insertText: "DB('$1')",
        insertTextRules: SNIPPET_RULE,
        detail: "DB(CubeName, Elem1, Elem2, ...) → numeric|string",
        documentation: { value: [
          '```ti',
          'DB(CubeName, Elem1, Elem2, ...)',
          '```',
          '',
          L.dbDoc,
        ].join('\n') },
        sortText: '1DB',
        range,
      });

      for (const sig of sigs) {
        suggestions.push({
          label: sig.name,
          kind: KIND_FUNCTION,
          insertText: buildSnippetInsertText(sig),
          insertTextRules: SNIPPET_RULE,
          detail: buildSignatureLabel(sig),
          documentation: { value: buildMarkdownDoc(sig, MD_LABELS, V12) },
          sortText: '1' + sig.name,
          range,
        });
      }

      for (const kw of CONTROL_FLOW) {
        suggestions.push({
          label: kw,
          kind: KIND_KEYWORD,
          insertText: kw,
          detail: 'Control Flow',
          sortText: '0' + kw,
          range,
        });
      }

      for (const kw of SECTION_KEYWORDS) {
        suggestions.push({
          label: kw.label,
          kind: KIND_KEYWORD,
          insertText: kw.insert,
          detail: kw.detail,
          filterText: kw.label,
          sortText: '0' + kw.label,
          range,
        });
      }

      for (const kw of RULE_TYPE_KEYWORDS) {
        suggestions.push({
          label: kw.label,
          kind: KIND_KEYWORD,
          insertText: kw.insert,
          detail: 'Rule Type',
          filterText: kw.label.replace(':', ''),
          sortText: '0' + kw.label,
          range,
        });
      }

      // Cell-ref snippet
      suggestions.push({
        label: "['Dim':'Elem']",
        kind: KIND_SNIPPET,
        insertText: "['${1:Dimension}':'${2:Element}']",
        insertTextRules: SNIPPET_RULE,
        detail: L.detailCellRef,
        filterText: 'cell',
        sortText: '0zcell',
        range,
      });

      return { suggestions };
    },
  });
}

/** funcName (lowercase) → which arg index expects a dimension name. */
const FUNC_DIM_ARG: Record<string, number> = {
  'dimsiz': 0, 'dimnm': 0, 'dimix': 0, 'dnxt': 0, 'dnlev': 0, 'dtype': 0,
  'ellev': 0, 'elisanc': 0, 'elispar': 0, 'elisstr': 0,
  'elpar': 0, 'elparn': 0, 'elcomp': 0, 'elcompn': 0, 'elweight': 0,
  'elementexists': 0, 'elementindex': 0, 'elementname': 0, 'elementlevel': 0,
  'elementcomponent': 0, 'elementcomponentcount': 0,
  'elementtype': 0, 'elementparent': 0, 'elementparentcount': 0,
  'attrs': 0, 'attrn': 0, 'attre': 0, 'attributeget': 0,
};

/** funcName (lowercase) → which arg index expects a cube name. Auto-derived
 *  from KNOWN_SIGNATURES (restricted to rules-relevant functions); DB is added
 *  manually because it's rules-specific and not in KNOWN_SIGNATURES. */
const FUNC_CUBE_ARG: Record<string, number> = (() => {
  const map: Record<string, number> = { 'db': 0 };
  for (const [key, sig] of KNOWN_SIGNATURES) {
    if (!RULES_FUNCTION_KEYS.has(key)) { continue; }
    const cubeIdx = sig.params.findIndex(p => p.name.toLowerCase() === 'cubename');
    if (cubeIdx !== -1) { map[key] = cubeIdx; }
  }
  return map;
})();

/** Functions where the cube arg is followed by variadic element args.
 *  Picking a cube in these should expand the full call with one placeholder
 *  per cube dimension; DB is added manually. */
const FUNC_CUBE_WITH_DIMS: Set<string> = (() => {
  const set = new Set<string>(['db']);
  for (const [key, sig] of KNOWN_SIGNATURES) {
    if (!RULES_FUNCTION_KEYS.has(key)) { continue; }
    const cubeIdx = sig.params.findIndex(p => p.name.toLowerCase() === 'cubename');
    if (cubeIdx === -1) { continue; }
    const hasTrailingElems = sig.maxParams === Infinity && cubeIdx < sig.params.length - 1;
    if (hasTrailingElems) { set.add(key); }
  }
  return set;
})();
/** funcName (lowercase) → { dimIdx, attrIdx } */
const FUNC_ATTR_ARG: Record<string, { dimIdx: number; attrIdx: number }> = {
  'attrs':         { dimIdx: 0, attrIdx: 2 },
  'attrn':         { dimIdx: 0, attrIdx: 2 },
  'attre':         { dimIdx: 0, attrIdx: 2 },
  'attributeget':  { dimIdx: 0, attrIdx: 2 },
};

// FuncArgContext + getFuncArgContext → completionsPure

interface CubeWithDims { name: string; dims: string[] }

interface Bridge {
  fetchDimensions: () => void;
  fetchAttributes: (dimension: string) => void;
  fetchCubes: () => void;
  fetchCubesWithDims: () => void;
}

const cache: {
  dimensions: string[] | null;
  cubes: string[] | null;
  cubesWithDims: CubeWithDims[] | null;
  attributes: Map<string, string[]>;
  dimensionsResolvers: Array<(v: string[]) => void>;
  cubesResolvers: Array<(v: string[]) => void>;
  cubesWithDimsResolvers: Array<(v: CubeWithDims[]) => void>;
  attributesResolvers: Map<string, Array<(v: string[]) => void>>;
} = {
  dimensions: null,
  cubes: null,
  cubesWithDims: null,
  attributes: new Map(),
  dimensionsResolvers: [],
  cubesResolvers: [],
  cubesWithDimsResolvers: [],
  attributesResolvers: new Map(),
};

let bridge: Bridge | null = null;

export function setContextBridge(b: Bridge): void {
  bridge = b;
}

export function receiveDimensions(items: string[]): void {
  cache.dimensions = items;
  for (const r of cache.dimensionsResolvers) { r(items); }
  cache.dimensionsResolvers = [];
}

export function receiveCubes(items: string[]): void {
  cache.cubes = items;
  for (const r of cache.cubesResolvers) { r(items); }
  cache.cubesResolvers = [];
}

export function receiveCubesWithDims(items: CubeWithDims[]): void {
  cache.cubesWithDims = items;
  for (const r of cache.cubesWithDimsResolvers) { r(items); }
  cache.cubesWithDimsResolvers = [];
}

export function receiveAttributes(dimension: string, items: string[]): void {
  cache.attributes.set(dimension, items);
  const resolvers = cache.attributesResolvers.get(dimension);
  if (resolvers) {
    for (const r of resolvers) { r(items); }
    cache.attributesResolvers.delete(dimension);
  }
}

function getDimensions(): Promise<string[]> {
  if (cache.dimensions) { return Promise.resolve(cache.dimensions); }
  if (cache.dimensionsResolvers.length === 0 && bridge) { bridge.fetchDimensions(); }
  return new Promise((resolve) => { cache.dimensionsResolvers.push(resolve); });
}

function getCubes(): Promise<string[]> {
  if (cache.cubes) { return Promise.resolve(cache.cubes); }
  if (cache.cubesResolvers.length === 0 && bridge) { bridge.fetchCubes(); }
  return new Promise((resolve) => { cache.cubesResolvers.push(resolve); });
}

function getCubesWithDims(): Promise<CubeWithDims[]> {
  if (cache.cubesWithDims) { return Promise.resolve(cache.cubesWithDims); }
  if (cache.cubesWithDimsResolvers.length === 0 && bridge) { bridge.fetchCubesWithDims(); }
  return new Promise((resolve) => { cache.cubesWithDimsResolvers.push(resolve); });
}

function getAttributes(dimension: string): Promise<string[]> {
  const cached = cache.attributes.get(dimension);
  if (cached) { return Promise.resolve(cached); }
  let resolvers = cache.attributesResolvers.get(dimension);
  if (!resolvers) {
    resolvers = [];
    cache.attributesResolvers.set(dimension, resolvers);
    if (bridge) { bridge.fetchAttributes(dimension); }
  }
  return new Promise((resolve) => { resolvers!.push(resolve); });
}

export function registerContextCompletions(monaco: typeof monacoType): void {
  monaco.languages.registerCompletionItemProvider('tm1rules', {
    triggerCharacters: ["'"],

    provideCompletionItems: async (model, position) => {
      const lineContent = model.getLineContent(position.lineNumber);
      const before = lineContent.slice(0, position.column - 1);
      if (/^\s*#/.test(lineContent)) { return { suggestions: [] }; }

      // DB('… → cube names (lookup via Dimensions bridge's sibling? — handled by rulesCompletionProvider.
      // Here we focus on dim/attr — cube names are handled server-side only via the extension dialog's fetchNames)
      // For rules, let's also support DB-cube-via-name path.

      const ctx = getFuncArgContext(before);
      if (!ctx) {
        // Also handle the bracket-cellref case: ['<partial>
        if (/\['[^'\]]*$/.test(before)) {
          const items = await getDimensions();
          const openQuoteIdx = before.lastIndexOf("'");
          const startColumn = openQuoteIdx + 2;
          const range: monacoType.IRange = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn,
            endColumn: position.column,
          };
          return {
            suggestions: items.map(name => ({
              label: name,
              kind: KIND_VALUE,
              insertText: name,
              detail: L.detailDimension,
              range,
              sortText: name.toLowerCase(),
            })),
          };
        }
        return { suggestions: [] };
      }

      const openQuoteIdx = before.lastIndexOf("'");
      const startColumn = openQuoteIdx + 2;
      const range: monacoType.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn,
        endColumn: position.column,
      };

      const cubeArgIdx = FUNC_CUBE_ARG[ctx.funcName];
      if (cubeArgIdx !== undefined && ctx.argIdx === cubeArgIdx) {
        // Cube-with-Dims: expand the whole call; dims matching the rule's own
        // cube are inserted as `!DimName`, others as placeholder string literals.
        if (FUNC_CUBE_WITH_DIMS.has(ctx.funcName)) {
          const cubes = await getCubesWithDims();
          const after = lineContent.slice(position.column - 1);
          // Consume up to the closing `)` on this line so the snippet can replace
          // everything inside the call atomically.
          let depth = 1;
          let closeIdx = -1;
          for (let i = 0; i < after.length; i++) {
            if (after[i] === '(') { depth++; }
            else if (after[i] === ')') { depth--; if (depth === 0) { closeIdx = i; break; } }
          }
          const extRange: monacoType.IRange = closeIdx === -1 ? range : {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn,
            endColumn: position.column + closeIdx,
          };
          const ruleDims = new Set(cubeDimensionsCache.map(d => d.toLowerCase()));
          return {
            suggestions: cubes.map(cube => buildCubeWithDimsSuggestion(cube, extRange, ruleDims)),
          };
        }
        const items = await getCubes();
        return {
          suggestions: items.map(name => ({
            label: name,
            kind: KIND_VALUE,
            insertText: name,
            detail: L.detailCube,
            range,
            sortText: name.toLowerCase(),
          })),
        };
      }

      const dimArgIdx = FUNC_DIM_ARG[ctx.funcName];
      if (dimArgIdx !== undefined && ctx.argIdx === dimArgIdx) {
        const items = await getDimensions();
        return {
          suggestions: items.map(name => ({
            label: name,
            kind: KIND_VALUE,
            insertText: name,
            detail: 'Dimension',
            range,
            sortText: name.toLowerCase(),
          })),
        };
      }

      const attrEntry = FUNC_ATTR_ARG[ctx.funcName];
      if (attrEntry && ctx.argIdx === attrEntry.attrIdx) {
        const dimName = ctx.args[attrEntry.dimIdx];
        if (!dimName) { return { suggestions: [] }; }
        const items = await getAttributes(dimName);
        return {
          suggestions: items.map(name => ({
            label: name,
            kind: KIND_VALUE,
            insertText: name,
            detail: fmt(L, 'detailAttributeOf', dimName),
            range,
            sortText: name.toLowerCase(),
          })),
        };
      }

      return { suggestions: [] };
    },
  });
}

function buildCubeWithDimsSuggestion(
  cube: CubeWithDims,
  range: monacoType.IRange,
  ruleDims: Set<string>,
): monacoType.languages.CompletionItem {
  const { insertText, isSnippet } = buildCubeInsertText(cube.name, cube.dims, ruleDims);
  const item: monacoType.languages.CompletionItem = {
    label: cube.name,
    kind: KIND_VALUE,
    insertText,
    detail: fmt(L, 'detailCubeDims', cube.dims.length, cube.dims.length === 1 ? L.dimensionSingular : L.dimensionPlural),
    documentation: { value: '```\n' + cube.dims.join('\n') + '\n```' },
    range,
    sortText: cube.name.toLowerCase(),
  };
  if (isSnippet) { item.insertTextRules = SNIPPET_RULE; }
  return item;
}

let cubeDimensionsCache: string[] = [];

export function setCubeDimensions(dims: string[]): void {
  cubeDimensionsCache = dims.slice();
}

export function registerBangCompletions(monaco: typeof monacoType): void {
  monaco.languages.registerCompletionItemProvider('tm1rules', {
    triggerCharacters: ['!'],

    provideCompletionItems: (model, position) => {
      const lineContent = model.getLineContent(position.lineNumber);
      if (/^\s*#/.test(lineContent)) { return { suggestions: [] }; }
      const before = lineContent.slice(0, position.column - 1);
      // Match the !word pattern at end of line (before cursor).
      const m = /(![A-Za-z0-9_]*)$/.exec(before);
      if (!m) { return { suggestions: [] }; }
      const startColumn = position.column - m[0].length;
      const range: monacoType.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn,
        endColumn: position.column,
      };
      return {
        suggestions: cubeDimensionsCache.map(dim => ({
          label: '!' + dim,
          kind: KIND_VALUE,
          insertText: '!' + dim,
          detail: L.detailCubeDimIterator,
          range,
          sortText: dim.toLowerCase(),
        })),
      };
    },
  });
}
