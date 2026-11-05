/**
 * postMessage router.
 *
 * Extracted from `index.ts` in Post-H17 #5 split.
 */

import { showParamPrompt } from '../_shared/paramPrompt';
import * as monaco from 'monaco-editor';
import type { HostToWebview } from './protocol';
import type { LintDiagnose } from '../../tiLogicVisualizer/lintTypes';
import type { IdentifierInfo } from './identifierHover';
import { editor, models, sharedState, SECTION_ORDER, SectionKey } from './state';
import { refreshAllIdentHighlights } from './highlights';
import { updateAllLineCountBadges, switchToSection } from './sections';
import { clearReferences } from '../_shared/monacoReferences';
import { rerenderParameters, rerenderDataSource, rerenderVariables } from './init';
import { setSecurity } from './parameters';
import { answerProbe, applyExternalSections, enableFileMode } from './fileMode';
import { hideSaveBanner, showSaveBanner } from './save';
import {
  receiveCubes, receiveViews, receiveDimensions, receiveSubsets,
  receiveCubeDimensions, receiveAsciiPreview,
  receiveOdbcPreview, receiveOdbcDsns,
} from './dataSource';
import {
  receiveContextCubes, receiveContextDimensions, receiveContextProcesses,
  receiveContextCubesWithDims,
  receiveContextHierarchies,
} from './contextCompletions';
import { receiveLintResults, receiveServerLintResults, receiveCompileResults, clearCompileResults } from './linter';
import { receiveResolverResults } from './resolver';

/** Schreibt die Statuszeile; fehlt sie, passiert nichts. */
function setStatus(text: string): void {
  const el = document.getElementById('status');
  if (el) { el.textContent = text; }
}
import { receiveSnippets } from './snippetCompletions';
import { onDebugMessage } from './debug';
import { setBreakpointStatus, resetBreakpointStatuses, setBreakpointConditionError } from './breakpoints';
import { receiveIdentifierInfo } from './identifierHover';
import { setFormatConfig } from './format';
import { renderFormatMenu } from './formatMenu';
import { onLintConfig } from './lintMenu';
import { setV12Mode } from './completions';
import { getL10n } from '../_shared/l10n';

export {};

const L = getL10n();

export function initMsgHandler(): void {
  window.addEventListener('message', (ev: MessageEvent<HostToWebview | null | undefined>) => {
    const msg = ev.data;
    if (!msg || !msg.type) { return; }

    switch (msg.type) {
      case 'askParams':
        showParamPrompt(msg);
        break;
      case 'setExecuting':
        document.body.classList.toggle('executing', !!msg.running);
        break;
      case 'v12ModeChanged':
        setV12Mode(!!msg.v12Mode);
        break;
      case 'snippets':
        receiveSnippets(msg.snippets);
        break;
      case 'revealSectionLine': {
        switchToSection(msg.section);
        const line = Math.max(1, Number(msg.line) || 1);
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        editor.focus();
        break;
      }
      case 'monacoFileMode':
        enableFileMode();
        break;
      case 'fileModeProbe':
        answerProbe(msg);
        break;
      case 'monacoApplyExternal':
        applyExternalSections(msg.sections, msg.seq);
        refreshAllIdentHighlights();
        updateAllLineCountBadges();
        break;
      case 'monacoSetContent': {
        sharedState.suppressChange = true;
        const sections = msg.sections ?? {};
        for (const s of SECTION_ORDER) {
          models[s].setValue(sections[s] ?? '');
        }
        sharedState.suppressChange = false;
        refreshAllIdentHighlights();
        clearReferences();
        updateAllLineCountBadges();
        // Only NOW is the editor ready — and then the status line
        // has nothing left to say: clear it, the stylesheet hides it entirely via `:empty`.
        // A lingering "Ready." would waste space on something
        // self-evident. If "Loading…" stays, the request is hanging.
        setStatus('');
        break;
      }
      case 'pasteText': {
        const text = msg.text ?? '';
        if (!text) { return; }
        const sel = editor.getSelection();
        if (!sel) { return; }
        editor.executeEdits('paste', [{
          range: sel,
          text,
          forceMoveMarkers: true,
        }]);
        editor.focus();
        break;
      }
      case 'insertText': {
        const text = msg.text ?? '';
        if (!text) { return; }
        const pos = editor.getPosition();
        if (!pos) { return; }
        editor.focus();
        if (msg.snippet) {
          // Monaco snippet syntax (${1:x}); Tab walks the placeholders.
          (editor.getContribution('snippetController2') as { insert(t: string): void } | null)?.insert(text);
          break;
        }
        const sel = editor.getSelection();
        const range = sel ?? new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
        // Tree insert: continuation lines follow the indent of the line the cursor sits on.
        // Public API text arrives verbatim, as in the rule editor.
        const indent = msg.indent ? /^\s*/.exec(editor.getModel()?.getLineContent(range.startLineNumber) ?? '')?.[0] ?? '' : '';
        editor.executeEdits('tm1-insert', [{ range, text: indent ? text.replace(/\n/g, `\n${indent}`) : text, forceMoveMarkers: true }]);
        break;
      }
      case 'monacoSetParameters': {
        rerenderParameters(msg.parameters ?? []);
        break;
      }
      case 'monacoSetDataSource': {
        rerenderDataSource(msg.dataSource ?? { Type: 'None' });
        break;
      }
      case 'monacoSetVariables': {
        rerenderVariables(msg.variables ?? []);
        break;
      }
      case 'monacoSetSecurity': {
        setSecurity(!!msg.hasSecurity);
        break;
      }
      case 'cubeList': {
        const list = msg.cubes ?? [];
        receiveCubes(list);
        receiveContextCubes(list);
        break;
      }
      case 'viewList': {
        receiveViews(msg.cubeName ?? '', msg.views ?? []);
        break;
      }
      case 'dimensionList': {
        const list = msg.dimensions ?? [];
        receiveDimensions(list);
        receiveContextDimensions(list);
        break;
      }
      case 'subsetList': {
        receiveSubsets(msg.dimensionName ?? '', msg.subsets ?? []);
        break;
      }
      case 'odbcDsnList': {
        receiveOdbcDsns(msg.items ?? []);
        break;
      }
      case 'processList': {
        receiveContextProcesses(msg.processes ?? []);
        break;
      }
      case 'cubesWithDims': {
        receiveContextCubesWithDims(msg.cubes ?? []);
        break;
      }
      case 'hierarchyList': {
        receiveContextHierarchies(msg.dimension ?? '', msg.hierarchies ?? []);
        break;
      }
      case 'cubeDimensions': {
        receiveCubeDimensions(msg.cubeName ?? '', msg.dimensions ?? []);
        break;
      }
      case 'asciiPreview': {
        receiveAsciiPreview(msg);
        break;
      }
      case 'odbcPreview': {
        receiveOdbcPreview(msg);
        break;
      }
      case 'lintResults': {
        receiveLintResults(msg.section ?? '', Array.isArray(msg.diagnostics) ? (msg.diagnostics as unknown as LintDiagnose[]) : []);
        break;
      }
      case 'serverLintResults': {
        receiveServerLintResults(msg.section ?? '', Array.isArray(msg.diagnostics) ? (msg.diagnostics as unknown as LintDiagnose[]) : []);
        break;
      }
      case 'compileResults': {
        receiveCompileResults(msg.errorsBySection ?? {});
        break;
      }
      case 'clearCompileResults': {
        clearCompileResults();
        hideSaveBanner();
        break;
      }
      case 'saveError': {
        showSaveBanner('error', msg.message ?? L.msgSaveError);
        break;
      }
      case 'saveSuccess': {
        showSaveBanner('success', msg.message ?? L.msgSaved, 3000);
        break;
      }
      case 'resolverData': {
        receiveResolverResults(msg.rows, typeof msg.error === 'string' ? msg.error : undefined);
        break;
      }
      case 'debugSessionStarted':
      case 'debugStateUpdate':
      case 'debugSessionEnded': {
        onDebugMessage(msg);
        if (msg.type === 'debugSessionEnded') { resetBreakpointStatuses(); }
        break;
      }
      case 'breakpointVerified': {
        const sec = (msg.section ?? '').toLowerCase();
        if (sec !== 'prolog' && sec !== 'metadata' && sec !== 'data' && sec !== 'epilog') { break; }
        setBreakpointStatus(sec as SectionKey, msg.line ?? 0, msg.verified ? 'active' : 'unverified');
        break;
      }
      case 'breakpointConditionError': {
        const sec = (msg.section ?? '').toLowerCase();
        if (sec !== 'prolog' && sec !== 'metadata' && sec !== 'data' && sec !== 'epilog') { break; }
        setBreakpointConditionError(sec as SectionKey, msg.line ?? 0, String(msg.message ?? ''));
        break;
      }
      case 'identifierInfo': {
        receiveIdentifierInfo(msg.requestId ?? '', (msg.info as IdentifierInfo | null) ?? null);
        break;
      }
      case 'formatConfig':
        setFormatConfig(msg.config);
        renderFormatMenu(msg.config);
        break;
      case 'lintConfig':
        onLintConfig(msg.config);
        break;
      case 'setLoading':
        // Debug start: the host awaits `startDebug` before any debug message
        // arrives. Without this the button stayed live and F5 could start a
        // second session (review 2026-10-03, A3).
        document.body.classList.toggle('loading', !!msg.loading);
        break;
      case 'saveCancelled':
        // The user dismissed the "save anyway?" dialog. The client shows no
        // saving state, so there is nothing to undo — listed so the
        // exhaustiveness check below stays meaningful.
        break;
      default: {
        // A host message without a case was dropped silently twice
        // (setLoading, saveCancelled). New protocol members now fail tsc here.
        const unhandled: never = msg;
        void unhandled;
      }
    }
  });
}
