import * as vscode from 'vscode';
import { apiRequest, type ProcessParameter, type ProcessVariable } from '../../tm1Client';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { parseTiCodeAccumulating } from '../../tiLogicVisualizer/tiParser';
import { isV12Active } from '../../utils/v12Mode';
import { lintTiAstWithContext, collectAllReads, collectReadsWithLines, collectAssignedVariables, findInconsistentCasing } from '../../tiLogicVisualizer/tiLinter';
import { KNOWN_SIGNATURES } from '../../tiLogicVisualizer/tiSignatures';
import { TI_SYSTEM_VARIABLES } from '../../tiLogicVisualizer/tiSystemVars';
import type { VariableTypeMap, LintDiagnose } from '../../tiLogicVisualizer/lintTypes';
import { fetchNames } from '../../providers/fetchNames';
import { lintTiServer } from '../../tiLogicVisualizer/tiServerLinter';
import { peekReferenceIndex } from '../../references/referenceIndexService';
import { applyLintRuleConfig } from '../../tiLogicVisualizer/tiLinter/ruleConfig';
import { findVersionIncompatibleCalls } from '../../tiLogicVisualizer/tiLinter/versionCompatPure';
import { censusHierarchyStyle, isBedrockObject } from '../../tiLogicVisualizer/tiLinter/hierarchyStylePure';
import { parseLintSuppressions, filterSuppressed } from '../../tiLogicVisualizer/tiLinter/lintSuppressPure';
import { localizeLintDiagnostics } from '../../providers/lintLocalize';
import { loadLintConfig } from './lintConfigStore';
import { postTo, type MessageTarget } from '../../webviews/typedPost';
import type { HostToWebview } from '../../webviewClient/processEditorMonaco/protocol';

const KNOWN_SIGNATURES_LOWER = new Set([...KNOWN_SIGNATURES.keys()]);

/**
 * Lints all 4 TI sections in order, passing variable context between sections.
 */
export function lintAllSections(
  panel: { webview: MessageTarget },
  processData: { prolog: string; metadata: string; data: string; epilog: string; parameters?: ProcessParameter[]; variables?: ProcessVariable[]; processName?: string },
  lintVersion: { value: number },
  config: Tm1Config,
  serverKey: string = '__default__',
  // The process overview lints every process at once: the server pass would
  // fire one request batch per process for existence checks. Local only there.
  opts: { serverLint?: boolean } = {},
): void {
  const sections = ['Prolog', 'Metadata', 'Data', 'Epilog'] as const;

  const allReadsPerSection: Set<string>[] = [];
  const allAssigned = new Set<string>();
  const parsedAsts: Array<import('../../tiLogicVisualizer/types').TiAst | null> = [];
  const parseErrorsPerSection: Array<import('../../tiLogicVisualizer/types').TiParseError[]> = [];

  for (const section of sections) {
    const code = processData[section.toLowerCase() as keyof typeof processData] as string ?? '';
    const acc = parseTiCodeAccumulating(code);
    parseErrorsPerSection.push(acc.errors);
    allReadsPerSection.push(collectAllReads(acc.ast));
    for (const v of collectAssignedVariables(acc.ast)) { allAssigned.add(v); }
    parsedAsts.push(acc.ast);
  }

  const paramNamesLower = new Set((processData.parameters ?? []).map(p => p.Name.toLowerCase()));
  // Ignored datasource columns never reach the TI code — counting them as defined
  // would suppress genuine "undefined variable" findings.
  const usedVariables = (processData.variables ?? []).filter(v => !v.Ignored);
  const dsVarNamesLower = new Set(usedVariables.map(v => v.Name.toLowerCase()));
  const paramNames = (processData.parameters ?? []).map(p => p.Name);
  const datasourceVars = usedVariables.map(v => v.Name);
  const ruleConfig = loadLintConfig(serverKey);
  const namingPrefixes = ruleConfig.namingPrefixes;

  const casingHits = (() => {
    try {
      return findInconsistentCasing(
        {
          prolog:   processData.prolog   as string ?? '',
          metadata: processData.metadata as string ?? '',
          data:     processData.data     as string ?? '',
          epilog:   processData.epilog   as string ?? '',
        },
        paramNames,
        datasourceVars,
      );
    } catch { return []; }
  })();

  // Hierarchy awareness, "consistent" mode: whether it is mixed is decided by
  // the WHOLE process — the hierarchy form can be set in the Prolog and the
  // blind call can be in the Data section. So count once across all four
  // sections and then report the findings per section.
  const hierarchyMixed = isBedrockObject(processData.processName) ? { legacy: [], modernCount: 0 } : censusHierarchyStyle(
    sections.map(s => processData[s.toLowerCase() as keyof typeof processData] as string ?? '').join('\n'),
  );

  let vars: VariableTypeMap | undefined = (processData.parameters ?? []).length > 0
    ? new Map((processData.parameters ?? []).map(p => [
        p.Name.toLowerCase(),
        { type: (p.Type === 'Numeric' ? 'numeric' : 'string') as 'numeric' | 'string', firstAssignmentLine: 0 },
      ]))
    : undefined;

  for (let i = 0; i < sections.length; i++) {
    const code = processData[sections[i].toLowerCase() as keyof typeof processData] as string ?? '';
    const futureReads = new Set<string>();
    for (let j = i + 1; j < sections.length; j++) {
      for (const v of allReadsPerSection[j]) { futureReads.add(v); }
    }

    const ast = parsedAsts[i] ?? [];
    const mainDiags: import('../../tiLogicVisualizer/lintTypes').LintDiagnose[] = [];
    let variableTypes: VariableTypeMap = new Map(vars ?? []);

    for (const err of parseErrorsPerSection[i]) {
      const ruleId = err.message.includes('semicolon') ? 'missing-semicolon' : 'parse-error';
      const localized = vscode.l10n.t(err.messageKey, ...err.messageArgs.map(String));
      mainDiags.push({
        line: err.line,
        severity: 'error',
        ruleId,
        message: `[${ruleId}] ${localized}`,
      });
    }
    const sectionKey = sections[i].toLowerCase() as import('../../tiLogicVisualizer/lintTypes').TiSection;
    // Cross-section look-ahead for cube-logging-not-restored / temp-object-not-destroyed:
    // ASTs of all LATER sections (disable/create here + restore/destroy later = ok).
    const futureAsts = parsedAsts.slice(i + 1).map(a => a ?? []);
    const r = lintTiAstWithContext(ast, vars, code, futureReads, sectionKey, {
      paramNames, datasourceVars, namingPrefixes,
      processName: processData.processName, futureAsts,
      previousAsts: parsedAsts.slice(0, i).map(a => a ?? []),
      nameWhitespaceInsensitive: vscode.workspace.getConfiguration('tm1').get<boolean>('lint.nameWhitespaceInsensitive', true),
      v12Mode: isV12Active(config),
    });
    mainDiags.push(...r.diagnostics);
    variableTypes = r.variableTypes;

    const undefDiags: import('../../tiLogicVisualizer/lintTypes').LintDiagnose[] = [];
    if (ast.length > 0) {
      const sectionReads = allReadsPerSection[i];
      const readLines = collectReadsWithLines(ast);
      for (const readLower of sectionReads) {
        if (allAssigned.has(readLower)) { continue; }
        if (paramNamesLower.has(readLower)) { continue; }
        if (dsVarNamesLower.has(readLower)) { continue; }
        if (KNOWN_SIGNATURES_LOWER.has(readLower)) { continue; }
        if (TI_SYSTEM_VARIABLES.has(readLower)) { continue; }
        const original = code.match(new RegExp(`\\b${readLower}\\b`, 'i'))?.[0] ?? readLower;
        undefDiags.push({
          ruleId: 'undefined-variable',
          line: readLines.get(readLower) ?? 1,
          message: `[undefined-variable] ${vscode.l10n.t('Variable "{0}" is not defined (no parameter, no datasource variable, no assignment in the code)', original)}`,
          severity: 'error',
        });
      }
    }

    // Version comparison, both directions. Until 2026-08-31 it ran ONLY in
    // the file check (`tiDiagnosticsProvider`) — it never fired in the process
    // editor, even though the gear menu had always offered `v12-deprecated`
    // for turning it off.
    const versionDiags: import('../../tiLogicVisualizer/lintTypes').LintDiagnose[] =
      findVersionIncompatibleCalls(code, isV12Active(config) ? 'v12' : 'v11').map(hit => {
        const ruleId = hit.kind === 'deprecated-in-v12' ? 'v12-deprecated' as const : 'v12-only' as const;
        const message = hit.kind === 'deprecated-in-v12'
          ? (hit.replacement
            ? vscode.l10n.t('{0}() is no longer available in TM1 / Planning Analytics v12 — use {1}() instead', hit.name, hit.replacement)
            : vscode.l10n.t('{0}() is no longer available in TM1 / Planning Analytics v12', hit.name))
          : vscode.l10n.t('{0} exists only from TM1 / Planning Analytics v12 on — the current target is 11.x', hit.name);
        return {
          ruleId,
          line: hit.line + 1,
          message: `[${ruleId}] ${message}`,
          severity: 'info' as const,
        };
      });

    const hierarchyDiags: import('../../tiLogicVisualizer/lintTypes').LintDiagnose[] =
      hierarchyMixed.modernCount === 0 ? [] : censusHierarchyStyle(code).legacy.map(hit => {
        const sample = hierarchyMixed.modernSample ?? '';
        const message = hit.kind === 'legacy-name'
          ? vscode.l10n.t('{0}() cannot name a hierarchy and always uses the default one, while this process names a hierarchy elsewhere ({1}()) — use {2}() here.', hit.name, sample, hit.modern)
          : vscode.l10n.t('{0}() is called without the hierarchy argument and falls back to the default hierarchy, while this process names a hierarchy elsewhere ({1}()).', hit.name, sample);
        return {
          ruleId: 'hierarchy-style-mixed' as const,
          line: hit.line + 1,
          message: `[hierarchy-style-mixed] ${message}`,
          severity: 'warning' as const,
        };
      });

    const casingDiags: import('../../tiLogicVisualizer/lintTypes').LintDiagnose[] = casingHits
      .filter(h => h.section === sectionKey)
      .map(h => ({
        ruleId: 'inconsistent-var-casing' as const,
        line: h.line + 1,
        // The webview's quick fix reads the spellings from here.
        messageArgs: [h.name, h.canonical],
        message: `[inconsistent-var-casing] ${vscode.l10n.t(`Identifier '{0}' should be spelled '{1}' for consistency.`, h.name, h.canonical)}`,
        severity: 'warning' as const,
      }));

    const allSectionDiags = [...mainDiags, ...undefDiags, ...casingDiags, ...versionDiags, ...hierarchyDiags];
    // `# tm1lint: disable[-next-line][=ids]` applies to EVERYTHING this
    // section reports — parser errors, AST rules, undefined variables,
    // spelling, version comparison. That is why it is here at the end, not
    // per source.
    const suppressions = parseLintSuppressions(code);
    const filteredDiags = filterSuppressed(
      applyLintRuleConfig(allSectionDiags, ruleConfig, sectionKey),
      suppressions,
      d => d.line - 1,
      d => d.ruleId,
    );
    postTo<HostToWebview>(panel.webview, {
      type: 'lintResults',
      section: sections[i],
      diagnostics: localizeLintDiagnostics(filteredDiags),
    });

    vars = variableTypes;
  }

  if (opts.serverLint === false) { return; }
  // Async server-side lint — fire and forget; discard if a newer lint has started
  const capturedVersion = lintVersion.value;
  const fullCode = sections.map(s => processData[s.toLowerCase() as keyof typeof processData] as string ?? '').join('\n');
  const boundFetchNames = (ep: string) => fetchNames(ep, config);
  const boundApi = (method: string, path: string) => apiRequest(method, path, undefined, undefined, config);
  lintTiServer(fullCode, boundApi, boundFetchNames, { nameWhitespaceInsensitive: vscode.workspace.getConfiguration('tm1').get<boolean>('lint.nameWhitespaceInsensitive', true) }, (name) => peekReferenceIndex(config)?.processParams.get(name.toLowerCase())).then(serverDiags => {
    if (lintVersion.value !== capturedVersion) { return; }
    const sectionOffsets: number[] = [];
    let offset = 0;
    for (const s of sections) {
      sectionOffsets.push(offset);
      offset += ((processData[s.toLowerCase() as keyof typeof processData] as string) ?? '').split('\n').length;
    }
    for (let i = 0; i < sections.length; i++) {
      const sectionStart = sectionOffsets[i];
      const sectionEnd = i + 1 < sections.length ? sectionOffsets[i + 1] : Infinity;
      const sectionDiags: LintDiagnose[] = serverDiags
        .filter(d => d.line >= sectionStart && d.line < sectionEnd)
        .map(d => ({ ...d, line: d.line - sectionStart })) as LintDiagnose[];
      const serverSectionKey = sections[i].toLowerCase() as import('../../tiLogicVisualizer/lintTypes').TiSection;
      const sectionCode = (processData[sections[i].toLowerCase() as keyof typeof processData] as string) ?? '';
      const filteredServerDiags = filterSuppressed(
        applyLintRuleConfig(sectionDiags, ruleConfig, serverSectionKey),
        parseLintSuppressions(sectionCode),
        // The server linter counts 0-based (`line: ref.lineIndex`), the
        // synchronous path 1-based. So NO -1 here.
        d => d.line,
        d => d.ruleId,
      );
      postTo<HostToWebview>(panel.webview, { type: 'serverLintResults', section: sections[i], diagnostics: localizeLintDiagnostics(filteredServerDiags) });
    }
  }).catch(() => { /* no server connection — silently ignore */ });
}
