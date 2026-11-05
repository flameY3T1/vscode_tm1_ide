/**
 * Resolver view for the process editor tab "Resolver".
 *
 * Takes the code of the 4 sections (prolog/metadata/data/epilog) + ParamNames + DS vars
 * and returns a list of all function calls with resolved arguments.
 *
 * Cumulative: the env grows across all sections; for each call line
 * the env "before this line" is computed via `buildProcessEnv(..., stopAtLine)`.
 *
 * Flow-insensitive — multi-assignment becomes `dynamic`. Params and
 * data source variables stay symbolic (with type display).
 */

import * as vscode from 'vscode';

import { KNOWN_SIGNATURES } from '../tiLogicVisualizer/tiSignatures';
import { neutralizeLine } from '../utils/tiLineText';
import { buildProcessEnv, resolveExpression, type TiVarType, type BuildEnvOptions, type ProcessEnv } from './variableEnv';
import { buildProcessEnvFlow } from './flowSensitiveEnv';
import { splitArgs } from '../tiLogicVisualizer/tiObjectCalls';

function buildEnv(text: string, paramNames: string[], opts: BuildEnvOptions): ProcessEnv {
  if (opts.flowSensitive) {
    return buildProcessEnvFlow(text, paramNames, opts);
  }
  return buildProcessEnv(text, paramNames, opts);
}

export type ResolverSection = 'prolog' | 'metadata' | 'data' | 'epilog';
export type ResolverArgKind = 'literal' | 'param' | 'datasource' | 'dynamic';

export interface ResolverArgPart {
  /** The identifier as written in the original (original casing). */
  identifier: string;
  /** Classification of the resolved value. */
  kind: Exclude<ResolverArgKind, 'dynamic'>;
  /** Anzeige-String analog zu ResolverArg.display. */
  display: string;
}

export interface ResolverArg {
  /** Parameter name from KNOWN_SIGNATURES (e.g. `CubeName`, `Value`) or `argN` as fallback. */
  name: string;
  /** verbatim as it stands in the code. */
  raw: string;
  /** Classification of the resolved value. */
  kind: ResolverArgKind;
  /** Anzeige-String: `"2026"`, `«pMonth: String»`, `«V2: String»`, `«dynamic»`. */
  display: string;
  /**
   * Only set when `kind === 'dynamic'` and the raw expression contains resolvable identifiers:
   * individual identifiers with their respective resolution (param/DS/local literal).
   */
  parts?: ResolverArgPart[];
}

export interface ResolverRow {
  section: ResolverSection;
  /** 1-based line number within the section. */
  line: number;
  /** Function name in original casing from KNOWN_SIGNATURES. */
  funcName: string;
  args: ResolverArg[];
}

export interface ResolverInput {
  prolog: string;
  metadata: string;
  data: string;
  epilog: string;
}

export interface ResolverMeta {
  /** Prozess-Parameter mit Name+Typ. */
  params?: Array<{ name: string; type: TiVarType }>;
  /** DataSource-Variablen mit Name+Typ. */
  datasourceVars?: Array<{ name: string; type: TiVarType }>;
}

const SECTIONS: ResolverSection[] = ['prolog', 'metadata', 'data', 'epilog'];

// Known function names once as a lowercase set for fast lookup.
const KNOWN_FUNC_NAMES_LC: Set<string> = new Set(KNOWN_SIGNATURES.keys());

// Control-flow keywords with a condition in parentheses — no KNOWN_SIGNATURES entry,
// but important for traceability (arg name "Condition").
const CONTROL_FLOW_LC: Map<string, string> = new Map([
  ['if', 'IF'],
  ['elseif', 'ELSEIF'],
  ['while', 'WHILE'],
]);

const FUNC_CALL_RE = /\b([A-Za-z_]\w*)\s*\(/g;

/**
 * Finds all KNOWN_SIGNATURES calls + control-flow IF/ELSEIF/WHILE and splits their arguments.
 */
function extractCallsFromLine(line: string): Array<{ funcName: string; args: string[]; isControlFlow?: boolean }> {
  const calls: Array<{ funcName: string; args: string[]; isControlFlow?: boolean }> = [];
  const neutralized = neutralizeLine(line);
  if (neutralized.trim() === '') { return calls; }

  FUNC_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FUNC_CALL_RE.exec(neutralized)) !== null) {
    const funcLower = m[1].toLowerCase();
    const isControlFlow = CONTROL_FLOW_LC.has(funcLower);
    if (!KNOWN_FUNC_NAMES_LC.has(funcLower) && !isControlFlow) { continue; }

    const openParen = m.index + m[0].length - 1;
    let depth = 1;
    let i = openParen + 1;
    while (i < neutralized.length && depth > 0) {
      if (neutralized[i] === '(')      { depth++; }
      else if (neutralized[i] === ')') { depth--; }
      i++;
    }
    if (depth !== 0) { continue; }

    const argsStr = line.slice(openParen + 1, i - 1);
    const args = splitArgs(argsStr);
    if (isControlFlow) {
      calls.push({ funcName: CONTROL_FLOW_LC.get(funcLower)!, args, isControlFlow: true });
    } else {
      const sig = KNOWN_SIGNATURES.get(funcLower)!;
      calls.push({ funcName: sig.name, args });
    }
  }
  return calls;
}

function paramNameFor(funcLower: string, argIdx: number, isControlFlow?: boolean): string {
  if (isControlFlow) { return argIdx === 0 ? 'Condition' : `arg${argIdx + 1}`; }
  const sig = KNOWN_SIGNATURES.get(funcLower);
  if (!sig) { return `arg${argIdx + 1}`; }
  // For variadic functions: the last param (often `ElemN`) repeats.
  if (argIdx < sig.params.length) { return sig.params[argIdx].name; }
  const last = sig.params[sig.params.length - 1];
  return last ? last.name : `arg${argIdx + 1}`;
}

function displayLiteral(value: string): string   { return `"${value}"`; }
function displayTyped(name: string, type?: TiVarType): string {
  return type ? `«${name}: ${type}»` : `«${name}»`;
}

function bindingToDisplay(binding: import('./variableEnv').VarBinding): { kind: ResolverArgKind; display: string } {
  switch (binding.kind) {
    case 'literal':    return { kind: 'literal',    display: displayLiteral(binding.value) };
    case 'param':      return { kind: 'param',      display: displayTyped(binding.paramName, binding.paramType) };
    case 'datasource': return { kind: 'datasource', display: displayTyped(binding.varName, binding.varType) };
    case 'dynamic':    return { kind: 'dynamic',    display: '«dynamic»' };
  }
}

// Words that are not variables despite their identifier form — keywords/operators.
const RESERVED_WORDS_LC: Set<string> = new Set([
  'and', 'or', 'not', 'if', 'else', 'elseif', 'endif', 'while', 'end',
  'for', 'next', 'true', 'false', 'eq', 'ne', 'lt', 'gt', 'le', 'ge',
]);

const IDENTIFIER_SCAN_RE = /[A-Za-z_]\w*/g;

/**
 * Finds all resolvable identifiers within a (dynamic) expression and returns
 * their respective resolution. Strings/comments are neutralised beforehand so that
 * literals are not misinterpreted as identifiers.
 *
 * Only identifiers with a non-dynamic resolution end up in the list — purely dynamic
 * ones (e.g. unknown variables) are ignored, because they carry no information.
 *
 * Dedup per lowercase name.
 */
function extractIdentifierParts(raw: string, env: import('./variableEnv').ProcessEnv): ResolverArgPart[] {
  const parts: ResolverArgPart[] = [];
  const seen = new Set<string>();

  const neutral = raw
    .replace(/'[^']*'/g, s => ' '.repeat(s.length))
    .replace(/#.*$/, '');

  IDENTIFIER_SCAN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IDENTIFIER_SCAN_RE.exec(neutral)) !== null) {
    const word = m[0];
    const wordLc = word.toLowerCase();
    if (seen.has(wordLc)) { continue; }
    if (RESERVED_WORDS_LC.has(wordLc)) { continue; }
    if (KNOWN_FUNC_NAMES_LC.has(wordLc)) { continue; }
    if (CONTROL_FLOW_LC.has(wordLc)) { continue; }

    const binding = resolveExpression(word, env);
    if (binding.kind === 'dynamic') { continue; }

    seen.add(wordLc);
    const display =
      binding.kind === 'literal'    ? displayLiteral(binding.value)
      : binding.kind === 'param'    ? displayTyped(binding.paramName, binding.paramType)
      :                               displayTyped(binding.varName, binding.varType);
    parts.push({ identifier: word, kind: binding.kind, display });
  }
  return parts;
}

/**
 * Special rendering for `ExecuteProcess(name, p1, v1, p2, v2, ...)` and `RunProcess(...)`.
 * - Arg 0: ProcessName (resolved normally)
 * - After that pairs: arg i (odd) = param name, arg i+1 = value.
 *   The param name is shown as `name` in the table (extracted from the literal or raw),
 *   the value is resolved and shown in `display`.
 * - An "orphaned" last arg (odd total count after ProcessName) stays visible on its own.
 */
function buildProcessCallArgs(rawArgs: string[], env: import('./variableEnv').ProcessEnv): ResolverArg[] {
  const args: ResolverArg[] = [];
  if (rawArgs.length === 0) { return args; }

  const nameRaw = rawArgs[0];
  args.push({ name: 'ProcessName', raw: nameRaw, ...bindingToDisplay(resolveExpression(nameRaw, env)) });

  for (let i = 1; i < rawArgs.length; i += 2) {
    const paramNameRaw = rawArgs[i];
    const valueRaw = rawArgs[i + 1];

    const paramNameBinding = resolveExpression(paramNameRaw, env);
    const paramName =
      paramNameBinding.kind === 'literal' ? paramNameBinding.value
      : paramNameRaw.trim();

    if (valueRaw === undefined) {
      // Ungerade Anzahl → letzter Arg ohne passenden Wert.
      args.push({ name: `arg${i + 1}`, raw: paramNameRaw, ...bindingToDisplay(paramNameBinding) });
    } else {
      args.push({ name: paramName, raw: valueRaw, ...bindingToDisplay(resolveExpression(valueRaw, env)) });
    }
  }
  return args;
}

/**
 * Main function: builds the resolver rows for all 4 sections.
 */
export function buildResolverView(
  input: ResolverInput,
  paramNames: string[],
  meta?: ResolverMeta,
): ResolverRow[] {
  const paramTypes = new Map<string, TiVarType>();
  for (const p of meta?.params ?? []) { paramTypes.set(p.name.toLowerCase(), p.type); }

  // Full text of all sections (for cumulative env building).
  // Remember line offsets so we can compute back to section + local line.
  const fullLines: string[] = [];
  const sectionOfGlobalLine: ResolverSection[] = [];
  const localLineOfGlobalLine: number[] = []; // 1-basiert pro Section

  for (const section of SECTIONS) {
    const secText = input[section] ?? '';
    const lines = secText.split('\n');
    for (let i = 0; i < lines.length; i++) {
      fullLines.push(lines[i]);
      sectionOfGlobalLine.push(section);
      localLineOfGlobalLine.push(i + 1);
    }
  }
  const fullText = fullLines.join('\n');

  const rows: ResolverRow[] = [];

  for (let g = 0; g < fullLines.length; g++) {
    const line = fullLines[g];
    if (line.trim() === '') { continue; }

    const calls = extractCallsFromLine(line);
    if (calls.length === 0) { continue; }

    // Env before this line (exclusive). "Last assignment wins" — shows the
    // value currently valid at the call site, even if the same name was
    // assigned differently further up in the process.
    const env = buildEnv(fullText, paramNames, {
      stopAtLine: g,
      paramTypes,
      datasourceVars: meta?.datasourceVars,
      lastAssignmentWins: true,
      flowSensitive: true,
    });

    for (const call of calls) {
      const funcLower = call.funcName.toLowerCase();
      let args: ResolverArg[];
      if (funcLower === 'executeprocess' || funcLower === 'runprocess') {
        args = buildProcessCallArgs(call.args, env);
      } else {
        args = call.args.map((raw, idx) => {
          const binding = resolveExpression(raw, env);
          const base: ResolverArg = {
            name: paramNameFor(funcLower, idx, call.isControlFlow),
            raw,
            ...bindingToDisplay(binding),
          };
          if (binding.kind === 'dynamic') {
            const parts = extractIdentifierParts(raw, env);
            if (parts.length > 0) { base.parts = parts; }
          }
          return base;
        });
      }
      rows.push({
        section: sectionOfGlobalLine[g],
        line: localLineOfGlobalLine[g],
        funcName: call.funcName,
        args,
      });
    }
  }

  return rows;
}

// ─── Identifier-Hover-Lookup ───────────────────────────────────────────────────

export interface IdentifierInfo {
  /** Category for styling. */
  kind: 'param' | 'datasource' | 'local-literal' | 'local-param' | 'local-datasource' | 'local-dynamic' | 'function' | 'unknown';
  /** Titel-Zeile im Tooltip. */
  title: string;
  /** Zusatz-Zeilen (z.B. Typ, Herkunft, Wert). */
  details: string[];
  /** Structured fields for compact rendering (e.g. Monaco hover).
   *  All optional — the existing legacy tooltip uses only title+details. */
  type?: TiVarType;
  /** Assignment value for local-literal. */
  value?: string;
  /** Origin for local-param / local-datasource. */
  source?: { kind: 'param' | 'datasource'; name: string; type?: TiVarType };
}

/**
 * Returns hover info for an identifier at a code location.
 * @param fullText  Full text of all 4 sections together.
 * @param globalLine 0-based line number in fullText (for stopAtLine).
 */
export function lookupIdentifierInfo(
  word: string,
  fullText: string,
  globalLine: number,
  paramNames: string[],
  meta?: ResolverMeta,
): IdentifierInfo | null {
  if (!word) { return null; }
  const wordLc = word.toLowerCase();

  // Funktionsaufruf?
  const sig = KNOWN_SIGNATURES.get(wordLc);
  if (sig) {
    const paramsStr = sig.params.map(p => `${p.name}: ${p.type}`).join(', ');
    return {
      kind: 'function',
      title: `${sig.name}(${paramsStr}) → ${sig.returnType}`,
      details: sig.deprecatedInV12 ? [vscode.l10n.t('Not available in v12.')] : [],
    };
  }

  const paramTypes = new Map<string, TiVarType>();
  for (const p of meta?.params ?? []) { paramTypes.set(p.name.toLowerCase(), p.type); }

  // Param?
  const paramIdx = paramNames.findIndex(p => p.toLowerCase() === wordLc);
  if (paramIdx >= 0) {
    const origName = paramNames[paramIdx];
    const type = paramTypes.get(wordLc);
    return {
      kind: 'param',
      title: origName,
      details: [`Parameter${type ? ` (${type})` : ''}`, vscode.l10n.t('Value is passed at call time.')],
      type,
    };
  }

  // DataSource-Var?
  const dsVar = (meta?.datasourceVars ?? []).find(v => v.name.toLowerCase() === wordLc);
  if (dsVar) {
    return {
      kind: 'datasource',
      title: dsVar.name,
      details: [vscode.l10n.t('DataSource variable ({0})', dsVar.type), vscode.l10n.t('Value comes per data row from the source.')],
      type: dsVar.type,
    };
  }

  // Local variable → build env up to the line ("last assignment wins")
  const env = buildEnv(fullText, paramNames, {
    stopAtLine: globalLine + 1,  // inkl. aktueller Zeile, falls Zuweisung hier steht
    paramTypes,
    datasourceVars: meta?.datasourceVars,
    lastAssignmentWins: true,
    flowSensitive: true,
  });
  const bound = env.vars.get(wordLc);
  if (!bound) { return null; }

  switch (bound.kind) {
    case 'literal': {
      // Infer the literal's type from its text form: pure `-?\d+(\.\d+)?` is
      // Numeric, everything else is treated as String (same rule variableEnv
      // uses when parsing literals).
      const isNumeric = /^-?\d+(?:\.\d+)?$/.test(bound.value);
      return {
        kind: 'local-literal',
        title: word,
        details: ['Lokale Variable', `Zugewiesen als Literal: "${bound.value}"`],
        value: bound.value,
        type: isNumeric ? 'Numeric' : 'String',
      };
    }
    case 'param':
      return {
        kind: 'local-param',
        title: word,
        details: [
          'Lokale Variable',
          `Zugewiesen aus Parameter ${bound.paramName}${bound.paramType ? ` (${bound.paramType})` : ''}`,
        ],
        source: { kind: 'param', name: bound.paramName, type: bound.paramType },
      };
    case 'datasource':
      return {
        kind: 'local-datasource',
        title: word,
        details: [
          'Lokale Variable',
          `Zugewiesen aus DataSource-Variable ${bound.varName} (${bound.varType})`,
        ],
        source: { kind: 'datasource', name: bound.varName, type: bound.varType },
      };
    case 'dynamic':
      return {
        kind: 'local-dynamic',
        title: word,
        details: [vscode.l10n.t('Local variable'), vscode.l10n.t('Value dynamic (function call, concat, multiple assignment, etc.)')],
      };
  }
}
