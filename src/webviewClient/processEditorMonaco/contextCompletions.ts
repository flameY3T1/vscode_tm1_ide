import type * as monacoType from 'monaco-editor';
import { getTiContextEndpoint, getTiHierarchyContext } from '../../providers/tiContextPatternsPure';
import { KNOWN_SIGNATURES } from '../../tiLogicVisualizer/tiSignatures';
import {
  getEnclosingFunctionName,
  buildCubeInsertTextWithVars,
  buildProcessInsertText,
} from './contextCompletionsPure';
import { KIND_VALUE, SNIPPET_RULE } from '../_shared/monacoEnums';
import { getL10n, fmt } from '../_shared/l10n';

const L = getL10n();

/** funcName (lowercase) → true if it takes a CubeName followed by variadic dim-element args. */
const CUBE_WITH_DIMS_FUNCS: Set<string> = (() => {
  const set = new Set<string>();
  for (const sig of KNOWN_SIGNATURES.values()) {
    const cubeIdx = sig.params.findIndex(p => p.name.toLowerCase() === 'cubename');
    if (cubeIdx === -1) { continue; }
    // CubeName is followed by element params (variadic) — CellGet/Put/DB-style.
    const hasTrailingElems = sig.maxParams === Infinity && cubeIdx < sig.params.length - 1;
    if (hasTrailingElems) { set.add(sig.name.toLowerCase()); }
  }
  return set;
})();

// getEnclosingFunctionName → contextCompletionsPure
// KIND_VALUE / SNIPPET_RULE → ../_shared/monacoEnums (S3 dedup)

interface ProcessParamInfo { name: string; type: 'Numeric' | 'String' }
interface ProcessInfo { name: string; sig: string; params?: ProcessParamInfo[] }

type Resolver<T> = (value: T) => void;

interface CubeWithDims { name: string; dims: string[] }

const cache: {
  cubes: string[] | null;
  dimensions: string[] | null;
  processes: ProcessInfo[] | null;
  cubesWithDims: CubeWithDims[] | null;
  cubesResolvers: Resolver<string[]>[];
  dimensionsResolvers: Resolver<string[]>[];
  processesResolvers: Resolver<ProcessInfo[]>[];
  cubesWithDimsResolvers: Resolver<CubeWithDims[]>[];
  /** One list and one queue per dimension. */
  hierarchies: Map<string, string[]>;
  hierarchiesResolvers: Map<string, Resolver<string[]>[]>;
} = {
  cubes: null,
  dimensions: null,
  processes: null,
  cubesWithDims: null,
  cubesResolvers: [],
  dimensionsResolvers: [],
  processesResolvers: [],
  cubesWithDimsResolvers: [],
  hierarchies: new Map(),
  hierarchiesResolvers: new Map(),
};

interface Bridge {
  fetchCubes: () => void;
  /** Hierarchies of ONE dimension — they exist only under it. */
  fetchHierarchies: (dimension: string) => void;
  fetchDimensions: () => void;
  fetchProcesses: () => void;
  fetchCubesWithDims: () => void;
  getVariables: () => Array<{ Name: string; Type: string }>;
}
let bridge: Bridge | null = null;

export function setContextCompletionBridge(b: Bridge): void {
  bridge = b;
}

export function receiveContextCubes(cubes: string[]): void {
  cache.cubes = cubes;
  for (const r of cache.cubesResolvers) { r(cubes); }
  cache.cubesResolvers = [];
}
export function receiveContextDimensions(dims: string[]): void {
  cache.dimensions = dims;
  for (const r of cache.dimensionsResolvers) { r(dims); }
  cache.dimensionsResolvers = [];
}
export function receiveContextProcesses(procs: ProcessInfo[]): void {
  cache.processes = procs;
  for (const r of cache.processesResolvers) { r(procs); }
  cache.processesResolvers = [];
}

export function receiveContextHierarchies(dimension: string, hierarchies: string[]): void {
  cache.hierarchies.set(dimension, hierarchies);
  for (const r of cache.hierarchiesResolvers.get(dimension) ?? []) { r(hierarchies); }
  cache.hierarchiesResolvers.delete(dimension);
}

export function receiveContextCubesWithDims(cubes: CubeWithDims[]): void {
  cache.cubesWithDims = cubes;
  for (const r of cache.cubesWithDimsResolvers) { r(cubes); }
  cache.cubesWithDimsResolvers = [];
}

function getCubes(): Promise<string[]> {
  if (cache.cubes) { return Promise.resolve(cache.cubes); }
  if (cache.cubesResolvers.length === 0 && bridge) { bridge.fetchCubes(); }
  return new Promise((resolve) => { cache.cubesResolvers.push(resolve); });
}
function getDimensions(): Promise<string[]> {
  if (cache.dimensions) { return Promise.resolve(cache.dimensions); }
  if (cache.dimensionsResolvers.length === 0 && bridge) { bridge.fetchDimensions(); }
  return new Promise((resolve) => { cache.dimensionsResolvers.push(resolve); });
}
function getProcesses(): Promise<ProcessInfo[]> {
  if (cache.processes) { return Promise.resolve(cache.processes); }
  if (cache.processesResolvers.length === 0 && bridge) { bridge.fetchProcesses(); }
  return new Promise((resolve) => { cache.processesResolvers.push(resolve); });
}

function getCubesWithDims(): Promise<CubeWithDims[]> {
  if (cache.cubesWithDims) { return Promise.resolve(cache.cubesWithDims); }
  if (cache.cubesWithDimsResolvers.length === 0 && bridge) { bridge.fetchCubesWithDims(); }
  return new Promise((resolve) => { cache.cubesWithDimsResolvers.push(resolve); });
}

function getHierarchies(dimension: string): Promise<string[]> {
  const ready = cache.hierarchies.get(dimension);
  if (ready) { return Promise.resolve(ready); }
  const waiting = cache.hierarchiesResolvers.get(dimension);
  if (!waiting) {
    cache.hierarchiesResolvers.set(dimension, []);
    bridge?.fetchHierarchies(dimension);
  }
  return new Promise((resolve) => {
    cache.hierarchiesResolvers.get(dimension)?.push(resolve);
  });
}

function buildCubeWithDimsSuggestion(
  cube: CubeWithDims,
  range: monacoType.IRange,
): monacoType.languages.CompletionItem {
  const variables = bridge?.getVariables() ?? [];
  const varByName = new Map<string, string>();
  for (const v of variables) { varByName.set(v.Name.toLowerCase(), v.Name); }
  const { insertText, isSnippet } = buildCubeInsertTextWithVars(cube.name, cube.dims, varByName);
  const item: monacoType.languages.CompletionItem = {
    label: cube.name,
    kind: KIND_VALUE,
    insertText,
    detail: fmt(L, cube.dims.length === 1 ? 'ccCubeDimension' : 'ccCubeDimensions', cube.dims.length),
    documentation: { value: '```\n' + cube.dims.join('\n') + '\n```' },
    range,
    sortText: cube.name.toLowerCase(),
  };
  if (isSnippet) { item.insertTextRules = SNIPPET_RULE; }
  return item;
}

function buildProcessSuggestion(
  p: ProcessInfo,
  range: monacoType.IRange,
): monacoType.languages.CompletionItem {
  const { insertText, isSnippet } = buildProcessInsertText(p.name, p.params ?? []);
  const item: monacoType.languages.CompletionItem = {
    label: p.name,
    kind: KIND_VALUE,
    insertText,
    detail: p.sig || 'Process',
    range,
    sortText: p.name.toLowerCase(),
  };
  if (isSnippet) { item.insertTextRules = SNIPPET_RULE; }
  return item;
}

export function registerContextCompletions(monaco: typeof monacoType): void {
  monaco.languages.registerCompletionItemProvider('ti', {
    triggerCharacters: ["'"],

    provideCompletionItems: async (model, position) => {
      const lineContent = model.getLineContent(position.lineNumber);
      const before = lineContent.slice(0, position.column - 1);
      // Check the hierarchy first: its argument sits AFTER the
      // dimension argument of the same call, and the position matching of the
      // three other endpoints only sees the first matching argument.
      const hierContext = getTiHierarchyContext(before);
      const endpoint = hierContext ? 'Hierarchies' as const : getTiContextEndpoint(before);
      if (!endpoint) { return { suggestions: [] }; }

      const openQuoteIdx = before.lastIndexOf("'");
      if (openQuoteIdx === -1) { return { suggestions: [] }; }
      const startColumn = openQuoteIdx + 2;
      const range: monacoType.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn,
        endColumn: position.column,
      };

      // Detect the Cube-with-dims case: if cursor is in a cube arg of a
      // function that takes dim-element args after it (CellGet/Put N/S, DB),
      // switch to cube+dims batch loader so we can expand the full call.
      const funcName = getEnclosingFunctionName(before);
      const isCubeWithDims = endpoint === 'Cubes' && funcName !== null
        && CUBE_WITH_DIMS_FUNCS.has(funcName.toLowerCase());

      let items: (string | ProcessInfo | CubeWithDims)[];
      if (hierContext) { items = await getHierarchies(hierContext.dimension); }
      else if (isCubeWithDims) { items = await getCubesWithDims(); }
      else if (endpoint === 'Cubes') { items = await getCubes(); }
      else if (endpoint === 'Dimensions') { items = await getDimensions(); }
      else { items = await getProcesses(); }

      // For Processes and Cube-with-Dims, extend the replacement range so the
      // snippet can also append the following args in a single atomic insert.
      let extRange: monacoType.IRange = range;
      if (endpoint === 'Processes' || isCubeWithDims) {
        const after = lineContent.slice(position.column - 1);
        if (isCubeWithDims) {
          // Consume up to the closing `)` of this function call on this line.
          let depth = 1;
          let closeIdx = -1;
          for (let i = 0; i < after.length; i++) {
            if (after[i] === '(') { depth++; }
            else if (after[i] === ')') {
              depth--;
              if (depth === 0) { closeIdx = i; break; }
            }
          }
          if (closeIdx !== -1) {
            extRange = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn,
              endColumn: position.column + closeIdx,
            };
          }
        } else {
          const nextQuote = after.indexOf("'");
          if (nextQuote !== -1) {
            extRange = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn,
              endColumn: position.column + nextQuote + 1,
            };
          }
        }
      }

      const suggestions: monacoType.languages.CompletionItem[] = items.map(it => {
        if (endpoint === 'Processes' && typeof it !== 'string' && 'sig' in it) {
          return buildProcessSuggestion(it as ProcessInfo, extRange);
        }
        if (isCubeWithDims && typeof it !== 'string' && 'dims' in it) {
          return buildCubeWithDimsSuggestion(it as CubeWithDims, extRange);
        }
        const name = typeof it === 'string' ? it : it.name;
        const sig = typeof it === 'string' ? '' : ('sig' in it ? (it as { sig: string }).sig : '');
        return {
          label: name,
          kind: KIND_VALUE,
          insertText: name,
          detail: sig || endpoint.slice(0, -1),
          range,
          sortText: name.toLowerCase(),
        };
      });
      return { suggestions };
    },
  });
}
