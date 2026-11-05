/**
 * Async server-side Rules linter.
 *
 * Extracted from `rulesLinter.ts` in Post-H17 #6 split.
 */

import { parseRules } from '../rulesParser';
import type { ApiRequestFn, BracketDimRef, DbCall, RulesLintDiagnose } from './types';
import { extractBracketRefs, parseBracketDimRefs, validateBracketRefSyntax } from './brackets';
import { extractDbCalls } from './dbCalls';
import { parseODataValueBody } from '../../tm1Rest/parseRest';
import { encodeODataKey } from '../../utils/odataKey';
import { normalizeElementName, attributeStringValues } from '../../utils/tm1ElementName';
import { mapLimit } from '../../utils/mapLimit';
import { isOk } from '../../tm1Rest/httpError';

export {};

/**
 * Max simultaneous REST calls per lint run.
 *
 * The request list is derived from server data (one `Elements` load per cube
 * dimension), so an unbounded fan-out scales with the model, not with the rule
 * being edited: 30 dimensions à 100k elements meant 30 parallel full-element
 * payloads — triggered by Diagnostics, without any user action. Kept low
 * deliberately; lint latency matters far less than not stampeding a shared
 * extension host and a production TM1 server.
 */
export const RULES_LINT_FETCH_CONCURRENCY = 4;

interface LineServerData {
  lineIndex: number;
  dbCalls: DbCall[];
  bracketRefs: Array<{ dimRefs: BracketDimRef[] }>;
}

export async function lintRulesServer(
  text: string,
  api: ApiRequestFn,
): Promise<RulesLintDiagnose[]> {
  const ast = parseRules(text);
  const diags: RulesLintDiagnose[] = [];

  const cubeOriginal = new Map<string, string>();
  const dimOriginal  = new Map<string, string>();
  // dimLc → (hierLc → originalHierName) for explicit 'Dim':'Hier':'Elem' refs.
  const hierOriginal = new Map<string, Map<string, string>>();
  const lineData: LineServerData[] = [];

  for (const l of ast.lines) {
    if (l.isBlank || l.isComment || l.isSkipcheck || l.isFeedstrings || l.isUndefvals || l.isFeedersMarker) { continue; }

    const dbCalls = extractDbCalls(l.trimmed);
    const rawRefs = extractBracketRefs(l.trimmed);

    const bracketRefs: LineServerData['bracketRefs'] = [];
    for (const content of rawRefs) {
      if (validateBracketRefSyntax(content) === null && content.includes("'")) {
        const dimRefs = parseBracketDimRefs(content);
        if (dimRefs.length > 0) {
          bracketRefs.push({ dimRefs });
          for (const { dim, hier } of dimRefs) {
            const lc = dim.toLowerCase();
            if (!dimOriginal.has(lc)) { dimOriginal.set(lc, dim); }
            if (hier !== undefined) {
              let hm = hierOriginal.get(lc);
              if (hm === undefined) { hm = new Map(); hierOriginal.set(lc, hm); }
              const hlc = hier.toLowerCase();
              if (!hm.has(hlc)) { hm.set(hlc, hier); }
            }
          }
        }
      }
    }

    for (const call of dbCalls) {
      if (call.cubeName !== null && call.args.length >= 2) {
        const lc = call.cubeName.toLowerCase();
        if (!cubeOriginal.has(lc)) { cubeOriginal.set(lc, call.cubeName); }
      }
    }

    const hasRelevantDb = dbCalls.some(c => c.cubeName !== null && c.args.length >= 2);
    if (hasRelevantDb || bracketRefs.length > 0) {
      lineData.push({ lineIndex: l.lineIndex, dbCalls, bracketRefs });
    }
  }

  if (cubeOriginal.size === 0 && dimOriginal.size === 0) { return []; }

  const cubeDimDetails = new Map<string, string[] | 'not-found'>();
  await mapLimit([...cubeOriginal.entries()], RULES_LINT_FETCH_CONCURRENCY, async ([lc, orig]) => {
    try {
      const res = await api('GET', `Cubes('${encodeODataKey(orig)}')/Dimensions?$select=Name`);
      if (res.statusCode === 404) {
        cubeDimDetails.set(lc, 'not-found');
      } else if (isOk(res)) {
        const dims = parseODataValueBody<{ Name: string }>(res).map((d) => String(d.Name));
        cubeDimDetails.set(lc, dims);
      }
    } catch { /* network error — skip */ }
  });

  for (const { dbCalls } of lineData) {
    for (const call of dbCalls) {
      if (call.cubeName === null) { continue; }
      const dims = cubeDimDetails.get(call.cubeName.toLowerCase());
      if (!Array.isArray(dims) || call.args.length !== dims.length + 1) { continue; }
      for (let i = 1; i < call.args.length; i++) {
        const arg = call.args[i].trim();
        if (!arg.startsWith("'") || !arg.endsWith("'") || arg.length < 3) { continue; }
        if (arg.slice(1, -1).includes("'")) { continue; }
        const dimIdx = i - 1;
        if (dimIdx < dims.length) {
          const dim = dims[dimIdx];
          const lc = dim.toLowerCase();
          if (!dimOriginal.has(lc)) { dimOriginal.set(lc, dim); }
        }
      }
    }
  }

  const dimElements = new Map<string, Set<string> | 'not-found'>();
  await mapLimit([...dimOriginal.entries()], RULES_LINT_FETCH_CONCURRENCY, async ([lc, orig]) => {
    try {
      const enc = encodeODataKey(orig);
      const res = await api('GET',
        `Dimensions('${enc}')/Hierarchies('${enc}')/Elements?$select=Name,Attributes`,
      );
      if (res.statusCode === 404) {
        dimElements.set(lc, 'not-found');
      } else if (isOk(res)) {
        // Match TM1 semantics: names are case- and whitespace-insensitive, and
        // alias (string-attribute) values are valid element references too.
        const names = new Set<string>();
        for (const e of parseODataValueBody<{ Name: string; Attributes?: unknown }>(res)) {
          names.add(normalizeElementName(String(e.Name)));
          for (const alias of attributeStringValues(e.Attributes)) {
            names.add(normalizeElementName(alias));
          }
        }
        dimElements.set(lc, names);
      }
    } catch { /* network error — skip */ }
  });

  // Explicit hierarchies from 'Dim':'Hier':'Elem': hierarchy list per dim +
  // element set per (dim, hier) — every hierarchy has its own elements.
  // Two bounded passes instead of one nested fan-out: nested
  // `mapLimit` calls would multiply (outer × inner), flattening
  // keeps the upper bound at exactly RULES_LINT_FETCH_CONCURRENCY.
  const dimHierNames = new Map<string, Set<string> | 'not-found'>();
  const hierElements = new Map<string, Set<string> | 'not-found'>();
  await mapLimit([...hierOriginal.keys()], RULES_LINT_FETCH_CONCURRENCY, async (dimLc) => {
    const dimOrig = dimOriginal.get(dimLc);
    if (dimOrig === undefined) { return; }
    try {
      const res = await api('GET', `Dimensions('${encodeODataKey(dimOrig)}')/Hierarchies?$select=Name`);
      if (res.statusCode === 404) {
        dimHierNames.set(dimLc, 'not-found');
      } else if (isOk(res)) {
        const set = new Set<string>();
        for (const h of parseODataValueBody<{ Name: string }>(res)) {
          set.add(String(h.Name).toLowerCase());
        }
        dimHierNames.set(dimLc, set);
      }
    } catch { /* network error — skip */ }
  });

  const hierTargets: Array<{ dimLc: string; dimOrig: string; hierLc: string; hierOrig: string }> = [];
  for (const [dimLc, hiers] of hierOriginal.entries()) {
    const dimOrig = dimOriginal.get(dimLc);
    const hierSet = dimHierNames.get(dimLc);
    if (dimOrig === undefined || !(hierSet instanceof Set)) { continue; }
    for (const [hierLc, hierOrig] of hiers.entries()) {
      if (hierSet.has(hierLc)) { hierTargets.push({ dimLc, dimOrig, hierLc, hierOrig }); }
    }
  }

  await mapLimit(hierTargets, RULES_LINT_FETCH_CONCURRENCY, async ({ dimLc, dimOrig, hierLc, hierOrig }) => {
    try {
      const res = await api('GET',
        `Dimensions('${encodeODataKey(dimOrig)}')/Hierarchies('${encodeODataKey(hierOrig)}')/Elements?$select=Name,Attributes`,
      );
      if (isOk(res)) {
        const names = new Set<string>();
        for (const e of parseODataValueBody<{ Name: string; Attributes?: unknown }>(res)) {
          names.add(normalizeElementName(String(e.Name)));
          for (const alias of attributeStringValues(e.Attributes)) {
            names.add(normalizeElementName(alias));
          }
        }
        hierElements.set(`${dimLc}\\u0000${hierLc}`, names);
      }
    } catch { /* network error — skip */ }
  });

  for (const { lineIndex, dbCalls, bracketRefs } of lineData) {
    for (const call of dbCalls) {
      if (call.cubeName === null || call.args.length < 2) { continue; }
      const lc = call.cubeName.toLowerCase();
      const dims = cubeDimDetails.get(lc);

      if (dims === 'not-found') {
        diags.push({
          line: lineIndex,
          messageKey: `Cube '{0}' was not found on the server.`,
          messageArgs: [call.cubeName],
          severity: 'warning',
          ruleId: 'db-unknown-cube',
        });
      } else if (Array.isArray(dims)) {
        const expected = dims.length + 1;
        if (call.args.length !== expected) {
          diags.push({
            line: lineIndex,
            messageKey: `DB('{0}') expects {1} arguments ({2} dimension(s)), but got {3}.`,
            messageArgs: [call.cubeName, expected, dims.length, call.args.length],
            severity: 'error',
            ruleId: 'db-arg-count-mismatch',
          });
        } else {
          for (let i = 1; i < call.args.length; i++) {
            const arg = call.args[i].trim();
            if (!arg.startsWith("'") || !arg.endsWith("'") || arg.length < 3) { continue; }
            const inner = arg.slice(1, -1);
            if (inner.includes("'")) { continue; }
            const dimIdx = i - 1;
            const dim = dims[dimIdx];
            const elemSet = dimElements.get(dim.toLowerCase());
            if (elemSet instanceof Set && !elemSet.has(normalizeElementName(inner))) {
              diags.push({
                line: lineIndex,
                messageKey: `Element '{0}' in dimension '{1}' (DB() arg {2}) not found.`,
                messageArgs: [inner, dim, i + 1],
                severity: 'warning',
                ruleId: 'db-element-not-found',
              });
            }
          }
        }
      }
    }

    for (const { dimRefs } of bracketRefs) {
      for (const { dim, hier, elems } of dimRefs) {
        const dimLc = dim.toLowerCase();
        const elemSet = dimElements.get(dimLc);

        if (elemSet === 'not-found') {
          diags.push({
            line: lineIndex,
            messageKey: `Dimension '{0}' was not found on the server.`,
            messageArgs: [dim],
            severity: 'error',
            ruleId: 'dimension-not-found',
          });
          continue;
        }

        // 'Dim':'Hier':'Elem' — validate the hierarchy, then check the elements against THIS
        // hierarchy (every hierarchy has its own elements).
        if (hier !== undefined) {
          const hierLc = hier.toLowerCase();
          const hierSet = dimHierNames.get(dimLc);
          if (hierSet instanceof Set && !hierSet.has(hierLc)) {
            diags.push({
              line: lineIndex,
              messageKey: `Hierarchy '{0}' in dimension '{1}' was not found on the server.`,
              messageArgs: [hier, dim],
              severity: 'error',
              ruleId: 'hierarchy-not-found',
            });
            continue;
          }
          const hElems = hierElements.get(`${dimLc}\\u0000${hierLc}`);
          if (hElems instanceof Set) {
            for (const elem of elems) {
              if (!hElems.has(normalizeElementName(elem))) {
                diags.push({
                  line: lineIndex,
                  messageKey: `Element '{0}' in dimension '{1}' hierarchy '{2}' not found.`,
                  messageArgs: [elem, dim, hier],
                  severity: 'warning',
                  ruleId: 'element-not-found',
                });
              }
            }
          }
          continue;
        }

        if (elemSet instanceof Set) {
          for (const elem of elems) {
            if (!elemSet.has(normalizeElementName(elem))) {
              diags.push({
                line: lineIndex,
                messageKey: `Element '{0}' in dimension '{1}' not found.`,
                messageArgs: [elem, dim],
                severity: 'warning',
                ruleId: 'element-not-found',
              });
            }
          }
        }
      }
    }
  }

  return diags;
}
