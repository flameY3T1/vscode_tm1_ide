import * as vscode from 'vscode';

/** HTML body for the per-server Git config panel. Labels localized; values are
 *  populated client-side from window.__GIT_INIT__ by the panel's inline script. */
export function buildGitConfigBody(): string {
  return [
    '<div class="form">',
    '  <h2>' + vscode.l10n.t('Git configuration') + '</h2>',
    '  <label class="row"><input type="checkbox" id="git-enabled"> ' + vscode.l10n.t('Enable Git mirror for this server') + '</label>',
    '  <label class="row">' + vscode.l10n.t('Repository path') + '<br>',
    '    <input type="text" id="git-repoPath" placeholder="${workspaceFolder}/tm1" style="width:100%"></label>',
    '  <label class="row"><input type="checkbox" id="git-includeServerFolder"> ' + vscode.l10n.t('Add a subfolder named after the server (recommended)') + '</label>',
    '  <label class="row">' + vscode.l10n.t('Parallel fetch') + '<br>',
    '    <input type="number" id="git-parallelFetch" min="1" step="1" value="8"></label>',
    '  <div class="row"><button id="git-save">' + vscode.l10n.t('Save') + '</button></div>',
    '</div>',
  ].join('\n');
}
