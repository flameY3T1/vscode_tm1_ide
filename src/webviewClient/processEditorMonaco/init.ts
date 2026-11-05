/**
 * Sub-module initialization + content-change wires + bridges.
 *
 * Extracted from `index.ts` in Post-H17 #5 split.
 */

import * as monaco from 'monaco-editor';
import { editor, models, sharedState, vscode, SECTION_ORDER } from './state';
import { switchToSection, updateLineCountBadge, updateAllLineCountBadges } from './sections';
import { refreshAllIdentHighlights, refreshIdentHighlights } from './highlights';
import { scheduleLint, scheduleResolver, requestResolver } from './lint';
import { registerVariableCompletions } from './variableCompletions';
import { registerSnippetCompletions } from './snippetCompletions';
import { getParameters, renderParameters, setOnChange, initSecurity } from './parameters';
import {
  getDataSource, renderDataSource, setOnChange as setDsOnChange, setServerBridge as setDsServerBridge,
  setVariableNameSource,
} from './dataSource';
import {
  renderVariables, getVariables, getUsedVariables, setOnChange as setVarsOnChange, setTabVisible as setVarsTabVisible,
} from './variables';
import { initLinter } from './linter';
import { registerTiQuickFixes } from './quickFix';
import { initReferences, refreshReferences } from '../_shared/monacoReferences';
import { registerTiRename } from './rename';
import { initResolver, refreshResolverLiveValues } from './resolver';
import {
  initBreakpoints, getBreakpoints, setBreakpointCondition, syncBreakpointsFromContent, toggleBreakpoint,
  clearAllBreakpoints,
} from './breakpoints';
import { initBreakpointsOverview } from './breakpointsOverview';
import { initBreakpointCondition } from './breakpointCondition';
import { collectIdentifierNames } from './tiIdentifiers';
import { getL10n, fmt } from '../_shared/l10n';
import { initDebug, isDebugging, lookupDebugValue } from './debug';
import { initIdentifierHover } from './identifierHover';
import { initProcessNav } from './processNav';
import { initCrossSectionFind } from './crossSectionFind';
import { setContextCompletionBridge } from './contextCompletions';
import { updateDebugUi } from './debugUi';
import { renderDebugVarsPanel } from './debugVarsPanel';
import { markContentChanged } from './draftSync';
import { initGutterNumbersRightVar } from '../_shared/gutterLayout';
import type { SectionKey } from './sectionTypes';
import type { ProtocolDataSource, ProtocolProcessParameter, ProtocolProcessVariable } from './protocol';
import type { ProcessParameter } from './parameters';
import type { DataSource } from './dataSource';
import type { ProcessVariable } from './variables';

export {};

const REF_SECTION_LABELS: Record<SectionKey, string> = {
  prolog: 'Prolog', metadata: 'Metadata', data: 'Data', epilog: 'Epilog',
};

/**
 * Reports the right edge of the line numbers to the editor as a CSS variable —
 * shared calculation with the rule editor, rationale in
 * `../_shared/gutterLayout.ts`.
 */
function initGutterRules(): void {
  const mount = document.getElementById('monaco-editor-mount');
  if (!mount) { return; }
  initGutterNumbersRightVar(editor, mount);
}

export function initSubModules(): void {
  initGutterRules();

  try {
    registerVariableCompletions(
      monaco,
      () => SECTION_ORDER.map(k => models[k]),
      () => getParameters(),
      () => getUsedVariables(),
    );
  } catch (e) { console.error('[Monaco] registerVariableCompletions failed:', e); }

  try {
    registerSnippetCompletions(monaco);
  } catch (e) { console.error('[Monaco] registerSnippetCompletions failed:', e); }

  try {
    registerTiQuickFixes(monaco);
  } catch (e) { console.error('[Monaco] registerTiQuickFixes failed:', e); }

  initLinter(monaco, {
    getModel: (section) => models[section],
    revealSectionLine: (section, line) => {
      switchToSection(section);
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.focus();
    },
  });

  initCrossSectionFind(monaco, {
    getModels: () => models,
    getEditor: () => editor,
    switchToSection,
  });

  const refL10n = getL10n();
  initReferences(monaco, {
    editor,
    sources: () => SECTION_ORDER.map(k => ({ key: k, label: REF_SECTION_LABELS[k], model: models[k] })),
    reveal: (section, line) => {
      switchToSection(section as SectionKey);
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.focus();
    },
    sectionHeaderHtml: 'Section',
    text: {
      hintHtml: refL10n.refDoubleClickHint,
      noneHtml: refL10n.refNoOccurrences,
      noFilterMatchHtml: refL10n.lintNoFilterMatch,
      colLineHtml: refL10n.lintHdrLine,
      colContextHtml: refL10n.refHdrContext,
      jumpToLineHtml: refL10n.lintJumpToLine,
      wordLabelHtml: (strong) => refL10n.refWordLabel + ' ' + strong,
      count: (n) => fmt(refL10n, 'refCountOccurrences', n),
      filtered: (n, total) => fmt(refL10n, 'refCountFiltered', n, total),
    },
  });

  registerTiRename(monaco, { getAllModels: () => models });

  // Ctrl/Cmd+click on an ExecuteProcess/RunProcess name literal → open that process.
  try { initProcessNav(); } catch (e) { console.error('[Monaco] initProcessNav failed:', e); }

  initResolver(monaco, {
    revealSectionLine: (section, line) => {
      switchToSection(section);
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.focus();
    },
    requestResolver,
    getLiveValue: (ident) => lookupDebugValue(ident),
  });

  initBreakpoints(monaco, {
    getEditor: () => editor,
    getModel: (section) => models[section],
    getCurrentSection: () => sharedState.currentSection,
    isDebugging: () => isDebugging(),
    sendSetBreakpoint: (section, line, enabled) => {
      vscode.postMessage({ type: 'setBreakpoint', section, line, enabled });
    },
    sendSetBreakpointCondition: (section, line, rule) => {
      vscode.postMessage({ type: 'setBreakpointCondition', section, line, condition: rule.condition, hitCondition: rule.hitCondition });
    },
  });

  initBreakpointsOverview({
    revealSectionLine: (section, line) => {
      switchToSection(section);
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.focus();
    },
    setCondition: (section, line, condition, hitCondition) => setBreakpointCondition(section, line, condition, hitCondition),
    // Row "✕": toggling an existing breakpoint removes it (and informs the
    // debug server when a session is live). "Delete all" goes through the
    // batched clear: it still sends one removal per breakpoint to the server
    // (no bulk form in the protocol) but rebuilds the table only once.
    removeBreakpoint: (section, line) => toggleBreakpoint(section, line),
    clearAll: () => clearAllBreakpoints(),
  });

  const condL10n = getL10n();
  initBreakpointCondition(monaco, {
    getEditor: () => editor,
    getCurrentSection: () => sharedState.currentSection,
    hasBreakpoint: (section, line) => getBreakpoints().some((b) => b.section === section && b.line === line),
    getVariableNames: () => {
      const names = new Set<string>();
      for (const p of getParameters()) { if (p.Name) { names.add(p.Name); } }
      for (const v of getUsedVariables()) { if (v.Name) { names.add(v.Name); } }
      for (const n of collectIdentifierNames(SECTION_ORDER.map(k => models[k].getValue()))) {
        names.add(n);
      }
      return [...names];
    },
    labels: {
      placeholder: condL10n['bpConditionPlaceholder'] ?? 'Condition expression (e.g. vCount > 10)',
      hitPlaceholder: condL10n['bpHitCountPlaceholder'] ?? 'Hit count (e.g. >=5)',
    },
  });

  initDebug(monaco, {
    getEditor: () => editor,
    getModel: (section) => models[section],
    switchToSection,
    post: (msg) => vscode.postMessage(msg),
    onStateChanged: () => {
      updateDebugUi();
      refreshResolverLiveValues();
      renderDebugVarsPanel();
    },
  });

  initIdentifierHover(monaco, {
    sectionOfModel: (m) => {
      for (const s of SECTION_ORDER) { if (models[s] === m) { return s; } }
      return null;
    },
    post: (msg) => {
      vscode.postMessage({
        ...(msg as any),
        sections: {
          prolog: models.prolog.getValue(),
          metadata: models.metadata.getValue(),
          data: models.data.getValue(),
          epilog: models.epilog.getValue(),
        },
        parameters: getParameters(),
        variables: getVariables(),
      });
    },
  });

  for (const section of SECTION_ORDER) {
    models[section].onDidChangeContent(() => {
      refreshIdentHighlights(section);
      refreshReferences();
      scheduleLint();
      scheduleResolver();
      updateLineCountBadge(section);
      if (sharedState.suppressChange) { return; }
      syncBreakpointsFromContent(section);
      markContentChanged();
    });
  }
  updateAllLineCountBadges();

  setOnChange(() => {
    refreshAllIdentHighlights();
    scheduleLint();
    scheduleResolver();
    markContentChanged();
  });

  // "Security access" checkbox (above the parameter table) → mark dirty on toggle.
  initSecurity();

  setDsOnChange(() => {
    markContentChanged();
    const dsType = getDataSource().Type;
    setVarsTabVisible(dsType !== 'None');
  });

  setVarsOnChange(() => {
    refreshAllIdentHighlights();
    scheduleLint();
    scheduleResolver();
    markContentChanged();
  });

  // The ODBC preview labels its columns with the process's own variable names —
  // ODBC returns none, and those names are what the TI code will call them.
  setVariableNameSource(() => getVariables().slice()
    .sort((a, b) => (a.Position ?? 0) - (b.Position ?? 0))
    .map(v => v.Name));

  setDsServerBridge({
    fetchCubes: () => vscode.postMessage({ type: 'fetchCubes' }),
    fetchViews: (cubeName) => vscode.postMessage({ type: 'fetchViews', cubeName }),
    fetchDimensions: () => vscode.postMessage({ type: 'fetchDimensions' }),
    fetchSubsets: (dimensionName) => vscode.postMessage({ type: 'fetchSubsets', dimensionName }),
    fetchCubeDimensions: (cubeName) => vscode.postMessage({ type: 'fetchCubeDimensions', cubeName }),
    fetchOdbcDsns: () => vscode.postMessage({ type: 'fetchOdbcDsns' }),
    fetchAsciiPreview: (args) => vscode.postMessage({ type: 'fetchAsciiPreview', ...args }),
    fetchOdbcPreview: (args) => vscode.postMessage({ type: 'fetchOdbcPreview', ...args }),
    applyVariables: (variables) => {
      renderVariables(variables);
      setVarsTabVisible(true);
      refreshAllIdentHighlights();
      scheduleLint();
      markContentChanged();
    },
  });

  setContextCompletionBridge({
    fetchCubes: () => vscode.postMessage({ type: 'fetchCubes' }),
    fetchDimensions: () => vscode.postMessage({ type: 'fetchDimensions' }),
    fetchProcesses: () => vscode.postMessage({ type: 'fetchProcesses' }),
    fetchCubesWithDims: () => vscode.postMessage({ type: 'fetchCubesWithDims' }),
  fetchHierarchies: (dimension) => vscode.postMessage({ type: 'fetchHierarchies', dimension }),
    getVariables: () => getUsedVariables(),
  });
}

export function rerenderParameters(params: ProtocolProcessParameter[]): void {
  renderParameters(params as ProcessParameter[]);
  refreshAllIdentHighlights();
}

export function rerenderDataSource(ds: ProtocolDataSource): void {
  renderDataSource(ds as DataSource);
  setVarsTabVisible(ds.Type !== 'None');
}

export function rerenderVariables(vars: ProtocolProcessVariable[]): void {
  renderVariables(vars as ProcessVariable[]);
  refreshAllIdentHighlights();
}
