import * as vscode from 'vscode';
import { parseTiCodeAccumulating } from '../tiLogicVisualizer/tiParser';
import { lintTiAst, lintTiAstWithContext, findUndefinedVariables, findInconsistentCasing, collectAllReads } from '../tiLogicVisualizer/tiLinter';
import type { TiAst } from '../tiLogicVisualizer/types';
import { LintDiagnose, TiSection } from '../tiLogicVisualizer/lintTypes';
import { lintRules, lintRulesServer, RulesLintDiagnose } from '../tiLogicVisualizer/rulesLinter';
import { lintTiServer } from '../tiLogicVisualizer/tiServerLinter';
import { apiRequest } from '../tm1Client';
import { serverConfigForFile, serverConfigForUri } from './serverConfigForFile';
import { peekReferenceIndex } from '../references/referenceIndexService';
import { fetchNames } from './fetchNames';
import * as fs from 'fs';
import { parseParametersFromFileContent, type TiParam } from '../utils/proFile';
import { parseSections, toRestVariables } from '../utils/proFile';
import {
  parseSectionsWithOffsets,
  tiFileSectionsWithOffsets,
  tiHeaderNames,
  type SectionChunk,
  computeV12DeprecatedRanges,
  findVersionIncompatibleCalls,
} from './tiDiagnosticsProviderPure';
import { applyLintRuleConfig, type LintRuleConfig } from '../tiLogicVisualizer/tiLinter/ruleConfig';
import { parseLintSuppressions, filterSuppressed } from '../tiLogicVisualizer/tiLinter/lintSuppressPure';
import { censusHierarchyStyle } from '../tiLogicVisualizer/tiLinter/hierarchyStylePure';
import { renderLintMessage } from './lintLocalize';
import { isV12Active } from '../utils/v12Mode';

/** What the checks need from a process file, parsed once (see `_fileContext`). */
interface FileContext {
  chunks: SectionChunk[] | null;
  sectionsForCheck: { prolog: string; metadata: string; data: string; epilog: string };
  params: TiParam[];
  dsVarNames: string[];
  /**
   * False for a `.ti` whose `.json` cannot be read — a git diff's server side
   * (`tm1-git:`), a git history view (`git:`), a lone file. The
   * undefined-variable check then stays silent instead of flagging every
   * parameter.
   */
  headerKnown: boolean;
}

/**
 * Provides real-time lint diagnostics for .pro and .ti files.
 * Parses the document, runs the TI linter, and maps results
 * to vscode.Diagnostic objects in a DiagnosticCollection.
 */
export class TiDiagnosticsProvider implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly disposables: vscode.Disposable[] = [];
  /** Tracks lint generation per .rux uri to discard stale async results. */
  private readonly _ruxVersion = new Map<string, number>();
  /** Tracks lint generation per .pro/.ti uri to discard stale async results. */
  private readonly _tiVersion = new Map<string, number>();

  /** Debounce timers per uri for onDidChangeTextDocument — coalesces keystroke bursts. */
  private readonly _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly _DEBOUNCE_MS = 300;

  /** Strikethrough decoration for v12-deprecated function names */
  private readonly v12DecoType = vscode.window.createTextEditorDecorationType({
    textDecoration: 'line-through',
  });

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection('ti-linter');

    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument(doc => this.updateDiagnostics(doc)),
      vscode.workspace.onDidChangeTextDocument(e => {
        this.scheduleDiagnostics(e.document);
        // A process file's parameters and variables live in the `.json` next
        // to the `.ti`: re-lint the open `.ti` when its header changes.
        if (e.document.uri.path.endsWith('.json')) {
          const tiPath = e.document.uri.path.replace(/\.json$/, '.ti');
          const ti = vscode.workspace.textDocuments.find(d => d.uri.path === tiPath);
          if (ti) { this.scheduleDiagnostics(ti); }
        }
      }),
      vscode.workspace.onDidCloseTextDocument(doc => {
        const uriStr = doc.uri.toString();
        const t = this._debounceTimers.get(uriStr);
        if (t) { clearTimeout(t); this._debounceTimers.delete(uriStr); }
        this.collection.delete(doc.uri);
        this.clearV12Decorations(doc);
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('tm1.v12Mode')) { this.refreshAll(); }
      }),
      // Re-apply decorations when the user switches to a different editor tab
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) { this.applyV12Decorations(editor.document, [editor]); }
      }),
    );
  }

  /** Re-run diagnostics on all open .pro/.ti documents (e.g. after V12-mode toggle). */
  refreshAll(): void {
    for (const doc of vscode.workspace.textDocuments) {
      this.updateDiagnostics(doc);
    }
  }

  dispose(): void {
    for (const t of this._debounceTimers.values()) { clearTimeout(t); }
    this._debounceTimers.clear();
    for (const d of this.disposables) { d.dispose(); }
    this.collection.dispose();
    this.v12DecoType.dispose();
  }

  /** Debounced entry for rapid edits — coalesces bursts into one full-document lint. */
  private scheduleDiagnostics(doc: vscode.TextDocument): void {
    const uriStr = doc.uri.toString();
    const existing = this._debounceTimers.get(uriStr);
    if (existing) { clearTimeout(existing); }
    this._debounceTimers.set(uriStr, setTimeout(() => {
      this._debounceTimers.delete(uriStr);
      this.updateDiagnostics(doc);
    }, TiDiagnosticsProvider._DEBOUNCE_MS));
  }

  /** Apply (or clear) strikethrough decorations on all visible editors for this document. */
  private applyV12Decorations(doc: vscode.TextDocument, editors: readonly vscode.TextEditor[]): void {
    const enabled = isV12Active(serverConfigForUri(doc.uri));
    const ranges = enabled ? this.computeV12Ranges(doc.getText()) : [];
    for (const ed of editors) {
      if (ed.document === doc) { ed.setDecorations(this.v12DecoType, ranges); }
    }
  }

  /** Clear strikethrough decorations on all visible editors for this document. */
  private clearV12Decorations(doc: vscode.TextDocument): void {
    for (const ed of vscode.window.visibleTextEditors) {
      if (ed.document === doc) { ed.setDecorations(this.v12DecoType, []); }
    }
  }

  /** Returns ranges for all deprecated-in-v12 function name occurrences in the text. */
  private computeV12Ranges(text: string): vscode.Range[] {
    return computeV12DeprecatedRanges(text).map(
      r => new vscode.Range(r.line, r.startCol, r.line, r.endCol),
    );
  }

  private updateDiagnostics(doc: vscode.TextDocument): void {
    if (doc.languageId === 'tm1rules') {
      const uriStr = doc.uri.toString();
      const version = (this._ruxVersion.get(uriStr) ?? 0) + 1;
      this._ruxVersion.set(uriStr, version);

      const text = doc.getText();
      const syncDiags = lintRules(text);
      this.collection.set(doc.uri, syncDiags.map(d => this.toRulesDiagnostic(d)));

      // Async server checks — fire and forget; discard if a newer lint has started
      const docUri = doc.uri;
      const ruxCfg = serverConfigForUri(doc.uri);
      lintRulesServer(text, (method, path) => apiRequest(method, path, undefined, undefined, ruxCfg)).then(serverDiags => {
        if (this._ruxVersion.get(uriStr) !== version) { return; }
        this.collection.set(docUri, [...syncDiags, ...serverDiags].map(d => this.toRulesDiagnostic(d)));
      }).catch(() => { /* no server connection — silently ignore */ });
      return;
    }

    if (doc.languageId !== 'ti') {
      return;
    }

    const uriStr = doc.uri.toString();
    const tiVer = (this._tiVersion.get(uriStr) ?? 0) + 1;
    this._tiVersion.set(uriStr, tiVer);

    const text = doc.getText();
    const syncDiags = this._computeTiDiagnostics(text, doc.fileName, doc.uri);

    this.collection.set(doc.uri, syncDiags);
    this.applyV12Decorations(doc, vscode.window.visibleTextEditors);

    // Async server-side validation — fire and forget; discard if a newer lint has started
    const docUri = doc.uri;
    const cfg = serverConfigForUri(doc.uri);
    lintTiServer(text, (method, path) => apiRequest(method, path, undefined, undefined, cfg), (ep) => fetchNames(ep, cfg), { nameWhitespaceInsensitive: vscode.workspace.getConfiguration('tm1').get<boolean>('lint.nameWhitespaceInsensitive', true) }, (name) => peekReferenceIndex(cfg)?.processParams.get(name.toLowerCase())).then(serverDiags => {
      if (this._tiVersion.get(uriStr) !== tiVer) { return; }
      // `syncDiags` is already filtered; the second pass costs nothing and
      // saves a second spot where the suppression could be missing.
      this.collection.set(docUri, this._applySuppressions(text, [
        ...syncDiags,
        ...serverDiags.map(d => this.toRulesDiagnostic(d)),
      ]));
    }).catch(() => { /* no server connection — silently ignore */ });
  }

  /** Default rule config for native .pro/.ti files (no server context). */
  private static readonly _DEFAULT_LINT_CONFIG: LintRuleConfig = { rules: {} };

  /** Runs all synchronous TI lint checks and returns VS Code Diagnostic objects. */
  private _computeTiDiagnostics(text: string, fileName?: string, uri?: vscode.Uri): vscode.Diagnostic[] {
    // The IBM bedrock library (`}bedrock.*.pro`) is legacy code we don't
    // edit — unused-variable / dead-store is just noise in the Problems panel.
    const bedrockMode = !!fileName && /[\\/]\}bedrock\./i.test(fileName);
    // Process name for `recursive-process-call`: .pro header line 602,"Name",
    // fallback: file basename without extension. Missing → rule stays silent.
    const headerName = text.match(/^602\s*,\s*"([^"]*)"/m)?.[1];
    const baseName = fileName
      ? fileName.replace(/\\/g, '/').split('/').pop()?.replace(/\.(pro|ti)$/i, '')
      : undefined;
    const processName = headerName || baseName || undefined;
    const nameWhitespaceInsensitive = vscode.workspace.getConfiguration('tm1').get<boolean>('lint.nameWhitespaceInsensitive', true);
    // A .pro/.ti file inside a connected server's git folder belongs to that server; any
    // other file has no binding, and the active connection is the only context there is.
    // Process editors do NOT come through here; each of those uses its own panel's config.
    const v12Mode = isV12Active(uri ? serverConfigForUri(uri) : serverConfigForFile(fileName));
    const lintOptions = { ...(bedrockMode ? { bedrockMode: true } : {}), processName, nameWhitespaceInsensitive, v12Mode };
    const ctx = this._fileContext(text, fileName, uri);
    const sections = ctx.chunks;

    if (sections) {
      // .pro or git-export .ti: lint each section separately with section context and cross-section variables
      const allDiagnostics: vscode.Diagnostic[] = [];
      const fileParams = ctx.params;
      let knownVariables: ReturnType<typeof lintTiAstWithContext>['variableTypes'] | undefined =
        fileParams.length > 0
          ? new Map(fileParams.map(p => [
              p.Name.toLowerCase(),
              { type: (p.Type === 1 ? 'numeric' : 'string') as 'numeric' | 'string', firstAssignmentLine: 0 },
            ]))
          : undefined;

      // Pass 1: parse all sections via the accumulating parser so EVERY parse
      // error in a section is surfaced (not just the first), and a partial
      // AST is recovered for downstream AST-based checks.
      type ParsedSection = { ast: TiAst; code: string; section: TiSection; lineOffset: number };
      const parsedSections: ParsedSection[] = sections.map(({ section, code, lineOffset }) => {
        const acc = parseTiCodeAccumulating(code);
        for (const err of acc.errors) {
          const absLine = Math.max(lineOffset + err.line - 1, 0);
          const parseDiag = new vscode.Diagnostic(
            new vscode.Range(absLine, 0, absLine, Number.MAX_SAFE_INTEGER),
            vscode.l10n.t(err.messageKey, ...err.messageArgs.map(String)),
            vscode.DiagnosticSeverity.Error,
          );
          parseDiag.code = err.message.includes('semicolon') ? 'missing-semicolon' : 'parse-error';
          allDiagnostics.push(parseDiag);
        }
        return { ast: acc.ast, code, section, lineOffset };
      });

      // Pre-compute the set of variable reads per section for cross-section unused-variable detection
      const sectionReads = parsedSections.map(p => collectAllReads(p.ast));

      // Pass 2: lint each section, passing futureReads = union of reads in all later sections
      for (let i = 0; i < parsedSections.length; i++) {
        const p = parsedSections[i];
        if (p.ast.length === 0) { continue; }

        const futureReads = new Set<string>();
        for (let j = i + 1; j < parsedSections.length; j++) {
          for (const v of sectionReads[j]) { futureReads.add(v); }
        }

        // Cross-section look-ahead for cube-logging-not-restored / temp-object-not-destroyed:
        // ASTs of all LATER sections (disable/create here + restore/destroy later = ok).
        const futureAsts = parsedSections.slice(i + 1).map(s => s.ast);
        const { diagnostics: lintResults, variableTypes } = lintTiAstWithContext(
          p.ast, knownVariables, p.code, futureReads.size > 0 ? futureReads : undefined, p.section,
          { ...lintOptions, futureAsts, previousAsts: parsedSections.slice(0, i).map(s => s.ast) },
        );
        const gatedResults = applyLintRuleConfig(lintResults, TiDiagnosticsProvider._DEFAULT_LINT_CONFIG, p.section);
        for (const d of gatedResults) {
          allDiagnostics.push(this.toDiagnostic({ ...d, line: p.lineOffset + d.line }));
        }
        knownVariables = variableTypes;
      }

      this.addUndefinedVarDiagnostics(ctx, allDiagnostics);
      this.addInconsistentCasingDiagnostics(ctx, allDiagnostics);
      this.addVersionCompatDiagnostics(text, allDiagnostics, v12Mode);
      this.addHierarchyStyleDiagnostics(text, allDiagnostics, bedrockMode);
      return this._applySuppressions(text, allDiagnostics);
    }

    // Plain .ti file without section markers
    const acc = parseTiCodeAccumulating(text);
    const allDiagnostics: vscode.Diagnostic[] = [];
    for (const err of acc.errors) {
      const line = Math.max(err.line - 1, 0);
      const diag = new vscode.Diagnostic(
        new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
        vscode.l10n.t(err.messageKey, ...err.messageArgs.map(String)),
        vscode.DiagnosticSeverity.Error,
      );
      diag.code = err.message.includes('semicolon') ? 'missing-semicolon' : 'parse-error';
      allDiagnostics.push(diag);
    }
    const lintResults = lintTiAst(acc.ast, undefined, text, undefined, undefined, lintOptions);
    const gatedResults = applyLintRuleConfig(lintResults, TiDiagnosticsProvider._DEFAULT_LINT_CONFIG);
    for (const d of gatedResults) { allDiagnostics.push(this.toDiagnostic(d)); }
    this.addUndefinedVarDiagnostics(ctx, allDiagnostics);
    this.addInconsistentCasingDiagnostics(ctx, allDiagnostics);
    this.addVersionCompatDiagnostics(text, allDiagnostics, v12Mode);
    this.addHierarchyStyleDiagnostics(text, allDiagnostics, bedrockMode);
    return this._applySuppressions(text, allDiagnostics);
  }

  /**
   * Applies the `# tm1lint: disable` comments.
   *
   * Deliberately right at the end, over the FINISHED list: this provider's
   * diagnostics come from five sources (parser errors, AST rules, undefined
   * variables, casing, version compatibility), and only three of them go
   * through `applyLintRuleConfig`. A guard per source would be four
   * opportunities to forget one.
   *
   * The lines here are absolute and 0-based, and the source text is the whole
   * file content — so nobody has to recompute a section offset.
   */
  private _applySuppressions(text: string, diags: vscode.Diagnostic[]): vscode.Diagnostic[] {
    return filterSuppressed(
      diags,
      parseLintSuppressions(text),
      d => d.range.start.line,
      d => (typeof d.code === 'string' ? d.code : undefined),
    );
  }

  /**
   * Sections, parameters and data source variables of a process file, parsed
   * once for every check. A `.pro` carries all of it in its header lines; a
   * git-export `.ti` has `#region` tabs and keeps the header in the `.json`
   * next to it (the open document if there is one — it may be ahead of disk;
   * only a `file:` document has a sibling on disk).
   */
  private _fileContext(text: string, fileName?: string, uri?: vscode.Uri): FileContext {
    const tiChunks = fileName && /\.ti$/i.test(fileName) ? tiFileSectionsWithOffsets(text) : null;
    if (tiChunks) {
      const jsonPath = fileName!.replace(/\.ti$/i, '.json');
      const open = vscode.workspace.textDocuments.find(d => d.fileName === jsonPath);
      let json: string | undefined;
      try {
        json = open ? open.getText() : uri?.scheme === 'file' ? fs.readFileSync(jsonPath, 'utf8') : undefined;
      } catch { json = undefined; }
      const header = tiHeaderNames(json);
      const bySection = new Map(tiChunks.map(c => [c.section, c.code]));
      return {
        chunks: tiChunks,
        sectionsForCheck: {
          prolog: bySection.get('prolog') ?? '', metadata: bySection.get('metadata') ?? '',
          data: bySection.get('data') ?? '', epilog: bySection.get('epilog') ?? '',
        },
        params: header?.params ?? [],
        dsVarNames: header?.dsVarNames ?? [],
        headerKnown: header !== undefined,
      };
    }
    const proSections = parseSections(text);
    const allEmpty = !proSections.prolog && !proSections.metadata && !proSections.data && !proSections.epilog;
    return {
      chunks: parseSectionsWithOffsets(text),
      sectionsForCheck: allEmpty ? { prolog: text, metadata: '', data: '', epilog: '' } : proSections,
      params: parseParametersFromFileContent(text),
      // Ignored columns are skipped by TM1 and unavailable to the code — listing them
      // as defined would hide genuine "undefined variable" findings.
      dsVarNames: toRestVariables(text).filter(v => !v.Ignored).map(v => v.Name),
      headerKnown: true,
    };
  }

  /** Name context for the undefined-variable and casing checks. */
  private _buildNameContext(ctx: FileContext): {
    sectionsForCheck: FileContext['sectionsForCheck'];
    paramNames: string[];
    dsVarNames: string[];
    chunks: SectionChunk[];
  } {
    return {
      sectionsForCheck: ctx.sectionsForCheck,
      paramNames: ctx.params.map(p => p.Name),
      dsVarNames: ctx.dsVarNames,
      chunks: ctx.chunks ?? [{ lineOffset: 0, code: ctx.sectionsForCheck.prolog, section: 'prolog' as const }],
    };
  }

  /**
   * Runs findUndefinedVariables and appends Warning diagnostics.
   * Params and datasource variables are extracted from .pro headers when available.
   */
  private addUndefinedVarDiagnostics(ctx: FileContext, out: vscode.Diagnostic[]): void {
    if (!ctx.headerKnown) { return; }
    try {
      const { sectionsForCheck, paramNames, dsVarNames, chunks } = this._buildNameContext(ctx);

      const undefinedVars = findUndefinedVariables(sectionsForCheck, new Set(paramNames), new Set(dsVarNames));
      if (undefinedVars.length === 0) { return; }

      // Map each section to its absolute line offset (same as the casing check).
      // findUndefinedVariables now reports the section + 0-based line of the first
      // REAL read (AST-based, so comments/strings mentioning the name no longer
      // pull the diagnostic onto line 1).
      const offsetOf = new Map(chunks.map(c => [c.section, c.lineOffset]));

      for (const v of undefinedVars) {
        const absLine = (offsetOf.get(v.section) ?? 0) + v.line;
        out.push(new vscode.Diagnostic(
          new vscode.Range(absLine, 0, absLine, Number.MAX_SAFE_INTEGER),
          `[undefined-variable] ${vscode.l10n.t('Variable "{0}" is not defined (no parameter, no datasource variable, no assignment in the code)', v.name)}`,
          vscode.DiagnosticSeverity.Error,
        ));
      }
    } catch {
      // Never block diagnostics due to an error in the undefined-variable check
    }
  }

  /** Runs findInconsistentCasing and appends Warning diagnostics. */
  private addInconsistentCasingDiagnostics(ctx: FileContext, out: vscode.Diagnostic[]): void {
    try {
      const { sectionsForCheck, paramNames, dsVarNames, chunks } = this._buildNameContext(ctx);

      const hits = findInconsistentCasing(sectionsForCheck, paramNames, dsVarNames);
      if (hits.length === 0) { return; }

      const offsetOf = new Map(chunks.map(c => [c.section, c.lineOffset]));

      for (const h of hits) {
        const absLine = (offsetOf.get(h.section) ?? 0) + h.line;
        out.push(new vscode.Diagnostic(
          new vscode.Range(absLine, 0, absLine, Number.MAX_SAFE_INTEGER),
          `[inconsistent-var-casing] ${vscode.l10n.t(`Identifier '{0}' should be spelled '{1}' for consistency.`, h.name, h.canonical)}`,
          vscode.DiagnosticSeverity.Warning,
        ));
      }
    } catch {
      // Never block diagnostics due to an error in the casing check
    }
  }

  /**
   * Version compatibility check for the function set — both directions.
   *
   * When v12 applies (server connection or toggle), the functions dropped in
   * v12 are reported; when 11.x applies, the ones that exist only from v12 on.
   * The second direction was missing entirely until 2026-08-31, even though
   * `v12Only` has always been in the signatures — completion already hid them
   * on 11.x, it just never told anyone who typed them anyway.
   */
  private addVersionCompatDiagnostics(text: string, out: vscode.Diagnostic[], v12Mode: boolean): void {
    const target = v12Mode ? 'v12' : 'v11';
    for (const hit of findVersionIncompatibleCalls(text, target)) {
      const message = hit.kind === 'deprecated-in-v12'
        ? (hit.replacement
          ? vscode.l10n.t('{0}() is no longer available in TM1 / Planning Analytics v12 — use {1}() instead', hit.name, hit.replacement)
          : vscode.l10n.t('{0}() is no longer available in TM1 / Planning Analytics v12', hit.name))
        : vscode.l10n.t('{0} exists only from TM1 / Planning Analytics v12 on — the current target is 11.x', hit.name);
      const ruleId = hit.kind === 'deprecated-in-v12' ? 'v12-deprecated' : 'v12-only';
      const diag = new vscode.Diagnostic(
        new vscode.Range(hit.line, hit.startCol, hit.line, hit.endCol),
        `[${ruleId}] ${message}`,
        vscode.DiagnosticSeverity.Information,
      );
      diag.code = ruleId;
      out.push(diag);
    }
  }

  /**
   * Hierarchy awareness, "consistency" mode.
   *
   * Only the mixture gets reported: if the process names a hierarchy
   * anywhere, the hierarchy-blind calls next to it are the spots that
   * silently land on the default hierarchy. A process that stays consistently
   * in the dimension form stays silent.
   */
  private addHierarchyStyleDiagnostics(text: string, out: vscode.Diagnostic[], bedrockMode: boolean): void {
    if (bedrockMode) { return; }
    const census = censusHierarchyStyle(text);
    if (census.modernCount === 0) { return; }
    const sample = census.modernSample ?? '';
    for (const hit of census.legacy) {
      const message = hit.kind === 'legacy-name'
        ? vscode.l10n.t('{0}() cannot name a hierarchy and always uses the default one, while this process names a hierarchy elsewhere ({1}()) — use {2}() here.', hit.name, sample, hit.modern)
        : vscode.l10n.t('{0}() is called without the hierarchy argument and falls back to the default hierarchy, while this process names a hierarchy elsewhere ({1}()).', hit.name, sample);
      const diag = new vscode.Diagnostic(
        new vscode.Range(hit.line, hit.startCol, hit.line, hit.endCol),
        `[hierarchy-style-mixed] ${message}`,
        vscode.DiagnosticSeverity.Warning,
      );
      diag.code = 'hierarchy-style-mixed';
      out.push(diag);
    }
  }


  private toRulesDiagnostic(d: RulesLintDiagnose): vscode.Diagnostic {
    const sev = d.severity === 'error'
      ? vscode.DiagnosticSeverity.Error
      : d.severity === 'warning'
        ? vscode.DiagnosticSeverity.Warning
        : d.severity === 'info'
          ? vscode.DiagnosticSeverity.Information
          : vscode.DiagnosticSeverity.Hint;
    const diag = new vscode.Diagnostic(
      new vscode.Range(d.line, 0, d.line, Number.MAX_SAFE_INTEGER),
      renderLintMessage(d),
      sev,
    );
    diag.code = d.ruleId;
    return diag;
  }

  private toDiagnostic(d: LintDiagnose): vscode.Diagnostic {
    const line = Math.max(d.line - 1, 0);
    const severity = d.severity === 'error'
      ? vscode.DiagnosticSeverity.Error
      : d.severity === 'warning'
        ? vscode.DiagnosticSeverity.Warning
        : d.severity === 'info'
          ? vscode.DiagnosticSeverity.Information
          : vscode.DiagnosticSeverity.Hint;

    const diag = new vscode.Diagnostic(
      new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
      renderLintMessage(d),
      severity,
    );
    diag.code = d.ruleId;
    return diag;
  }
}
