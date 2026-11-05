import * as vscode from 'vscode';
import { ReleaseNotesPanel } from '../../webviews/releaseNotesWebview';

// Same version-resolution pattern as src/tm1Rest/transport/auth.ts: esbuild
// replaces __EXT_VERSION__ at bundle time; unbundled test runs fall back to
// the npm-provided env var.
declare const __EXT_VERSION__: string | undefined;
const EXT_VERSION: string =
  (typeof __EXT_VERSION__ !== 'undefined' && __EXT_VERSION__) ||
  (typeof process !== 'undefined' && process.env?.npm_package_version) ||
  '0.0.0';

const LAST_SHOWN_KEY = 'tm1.lastShownVersion';

/** Registers the manual "What's New" command and runs the on-update gate. */
export function registerReleaseNotesCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.showReleaseNotes', () =>
      ReleaseNotesPanel.show(context.extensionUri, EXT_VERSION)),
  );
  void maybeShowOnUpdate(context);
}

async function maybeShowOnUpdate(context: vscode.ExtensionContext): Promise<void> {
  const stored = context.globalState.get<string>(LAST_SHOWN_KEY);
  // Fresh install: record silently, never nag a brand-new user.
  if (stored === undefined) {
    await context.globalState.update(LAST_SHOWN_KEY, EXT_VERSION);
    return;
  }
  if (stored === EXT_VERSION) { return; }
  // Record (and let the write land) BEFORE the toast, so a second window
  // activating concurrently reads the new version and doesn't double-toast.
  await context.globalState.update(LAST_SHOWN_KEY, EXT_VERSION);
  const btn = vscode.l10n.t("What's New");
  void vscode.window
    .showInformationMessage(vscode.l10n.t('TM1 IDE updated to {0}', EXT_VERSION), btn)
    .then((choice) => {
      if (choice === btn) { void ReleaseNotesPanel.show(context.extensionUri, EXT_VERSION); }
    });
}
