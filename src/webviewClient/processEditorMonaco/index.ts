/**
 * Process Editor (Monaco) webview client — Bootstrap facade.
 *
 * Bundled by esbuild from `src/webviewClient/processEditorMonaco/index.ts` →
 * `out/webview/processEditorMonaco.js` and loaded by
 * `src/commands/processEditor/processEditorMonacoWebview.ts`.
 *
 * Post-H17 #5 split (2026-05-18): index.ts is a pure bootstrap.
 *
 * Module responsibilities:
 * - state.ts        — Monaco models + editor + sharedState (created eagerly)
 * - highlights.ts   — refreshIdentHighlights, refreshAllIdentHighlights
 * - sections.ts     — switchToSection, currentSections, line-count badges
 * - lint.ts         — scheduleLint/Resolver + requestLint/Resolver
 * - save.ts         — buildSavePayload, show/hideSaveBanner
 * - format.ts       — formatAllSections
 * - debugUi.ts      — updateDebugUi
 * - editorEvents.ts — paste/clipboard/drag-drop/external-links/#-comment-toggle
 * - init.ts         — initSubModules (linter/refs/resolver/breakpoints/debug/
 *                     identHover/crossSection + content-change wires + bridges)
 * - msg.ts          — initMsgHandler (postMessage-Router)
 * - toolbar.ts      — initToolbar (buttons + tabs + keyboard commands)
 */

// MUST be the FIRST import — populates KNOWN_SIGNATURES from inline JSON
// before any module that reads the Map (e.g. state.ts → initMonacoLanguage).
import '../_shared/sigsBootstrap';
import { vscode } from './state';
import { initEditorEvents } from './editorEvents';
import { initSubModules } from './init';
import { initMsgHandler } from './msg';
import { initToolbar } from './toolbar';
import { initDebugVarsPanel } from './debugVarsPanel';

export {};

initEditorEvents();
initSubModules();
initMsgHandler();
initToolbar();
initDebugVarsPanel();

vscode.postMessage({ type: 'monacoReady' });
