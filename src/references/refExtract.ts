// Reference detection per section: TI calls with object names (argument
// position derived from the signatures) and rule texts. The building of the
// index lives in referenceIndex.ts, the data source in dataSourceRefs.ts.
import { extractDbCalls, extractBracketRefs, parseBracketDimRefs, validateBracketRefSyntax } from '../tiLogicVisualizer/rulesLinter';
import { scanObjectCalls, extractStringLiteral, OBJECT_ARG_IDX, PARAM_PAIR_FUNCS } from '../tiLogicVisualizer/tiObjectCalls';
import { resolveExpression, TI_ASSIGN_RE, type ProcessEnv, type VarBinding } from './variableEnv';
import type { CallParam, CallParamResolution, RefTargetKind } from './referenceTypes';

export function truncateSnippet(line: string): string {
  const t = line.trim();
  return t.length > 200 ? t.slice(0, 197) + '…' : t;
}

// ─── TI reference extraction (one section at a time) ─────────────────────────

interface RawTiRef {
  line: number;
  funcName: string;
  targetKind: RefTargetKind;
  targetName: string;
  snippet: string;
  params?: CallParam[];
}

/**
 * Resolve a single value-arg of an ExecuteProcess param-value pair.
 * Uses the caller's ProcessEnv to resolve bare variables to literals or
 * caller-param references.
 */
function resolveValueArg(arg: string, env: ProcessEnv): { resolution: CallParamResolution; valueRaw: string } {
  const valueRaw = arg.trim();
  const binding: VarBinding = resolveExpression(valueRaw, env);
  if (binding.kind === 'literal')    { return { resolution: { kind: 'literal',     value: binding.value }, valueRaw }; }
  if (binding.kind === 'param')      { return { resolution: { kind: 'passthrough', paramName: binding.paramName }, valueRaw }; }
  return { resolution: { kind: 'dynamic' }, valueRaw };
}

/**
 * For ExecuteProcess/RunProcess: parse param pairs starting at arg index 1.
 * Dangling single args (odd count) and pairs with a dynamic param-name arg
 * are skipped.
 */
function extractCallParams(args: string[], env: ProcessEnv): CallParam[] {
  const params: CallParam[] = [];
  for (let i = 1; i + 1 < args.length; i += 2) {
    const nameLit = extractStringLiteral(args[i]);
    if (nameLit === null) { continue; }
    const { resolution, valueRaw } = resolveValueArg(args[i + 1], env);
    params.push({ name: nameLit, resolution, valueRaw });
  }
  return params;
}

/**
 * Extracts cube/dimension/process references from a single TI text (one section).
 * Pure function — no network, no vscode.
 *
 * @param text       TI source (prolog/metadata/data/epilog)
 * @param env        Process environment for variable resolution in ExecuteProcess args.
 *                   Defaults to an empty env (no param refs, no local vars) if omitted.
 */
export function extractTiReferences(
  text: string,
  env?: ProcessEnv,
  sharedLiveVars?: Map<string, VarBinding>,
): RawTiRef[] {
  const baseEnv: ProcessEnv = env ?? {
    paramsLc: new Set(),
    paramOriginal: new Map(),
    paramTypes: new Map(),
    datasourceVars: new Map(),
    vars: new Map(),
  };
  // Flow-sensitive variable tracking: base env (params/DS vars/cross-section vars) + live
  // updated local vars. Every assignment overwrites (last-assignment-wins), so that
  // orchestrator patterns like `sProc='A'; RUNPROCESS(sProc,…); sProc='B'; RUNPROCESS(sProc,…);`
  // resolve both calls as their own refs instead of demoting them to `dynamic`.
  // sharedLiveVars is passed through across sections (a prolog assignment is visible in data/epilog).
  const liveVars = sharedLiveVars ?? new Map(baseEnv.vars);
  const callerEnv: ProcessEnv = { ...baseEnv, vars: liveVars };
  const refs: RawTiRef[] = [];

  // Before call detection: record assignments in liveVars (last-assignment-wins).
  const onLine = (line: string): void => {
    const aM = TI_ASSIGN_RE.exec(line);
    if (aM && !aM[2].startsWith('=')) {
      const varLc = aM[1].toLowerCase();
      if (!baseEnv.paramsLc.has(varLc) && !baseEnv.datasourceVars.has(varLc)) {
        liveVars.set(varLc, resolveExpression(aM[2], callerEnv));
      }
    }
  };

  scanObjectCalls(text, ({ lineIdx, line, funcName, funcLower, args }) => {
    const snippet = truncateSnippet(line);
    const pushRef = (kind: RefTargetKind, argIdx: number | undefined) => {
      if (argIdx === undefined || argIdx >= args.length) { return; }
      // Unlike the server linter, an empty literal '' is kept as a name here.
      let targetName = extractStringLiteral(args[argIdx]);
      if (targetName === null) {
        const binding = resolveExpression(args[argIdx], callerEnv);
        if (binding.kind !== 'literal') { return; }
        targetName = binding.value;
      }
      const params = kind === 'process' && PARAM_PAIR_FUNCS.has(funcLower)
        ? extractCallParams(args, callerEnv)
        : undefined;
      refs.push({ line: lineIdx, funcName, targetKind: kind, targetName, snippet, params });
    };
    pushRef('cube',      OBJECT_ARG_IDX.cube.get(funcLower));
    pushRef('dimension', OBJECT_ARG_IDX.dimension.get(funcLower));
    pushRef('process',   OBJECT_ARG_IDX.process.get(funcLower));
  }, onLine);
  return refs;
}


// ─── Rules reference extraction ──────────────────────────────────────────────

interface RawRuleRef {
  line: number;
  section: 'rules' | 'feeders';
  funcName?: string;
  targetKind: 'cube' | 'dimension';
  targetName: string;
  snippet: string;
}

const FEEDERS_MARKER_RE = /^\s*FEEDERS\s*;/i;

/**
 * Extracts cube (from DB()) and dimension (from [...] refs) references
 * from a rules/feeders text. Pure function.
 */
export function extractRulesReferences(text: string): RawRuleRef[] {
  const refs: RawRuleRef[] = [];
  const lines = text.split('\n');
  let section: 'rules' | 'feeders' = 'rules';

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx].replace(/\r$/, '');
    const trimmed = line.trim();
    if (FEEDERS_MARKER_RE.test(trimmed)) { section = 'feeders'; continue; }
    if (trimmed === '' || trimmed.startsWith('#')) { continue; }

    const snippet = truncateSnippet(line);

    // DB(...) → cube reference
    for (const call of extractDbCalls(line)) {
      if (call.cubeName !== null) {
        refs.push({ line: lineIdx, section, funcName: 'DB', targetKind: 'cube', targetName: call.cubeName, snippet });
      }
    }

    // [...] → dimension references (only valid syntactic refs)
    for (const bracket of extractBracketRefs(line)) {
      if (validateBracketRefSyntax(bracket) !== null) { continue; }
      if (!bracket.includes("'")) { continue; }
      for (const { dim } of parseBracketDimRefs(bracket)) {
        refs.push({ line: lineIdx, section, targetKind: 'dimension', targetName: dim, snippet });
      }
    }
  }
  return refs;
}
