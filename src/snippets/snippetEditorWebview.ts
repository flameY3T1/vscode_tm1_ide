import * as vscode from 'vscode';
import { renderWebviewShell } from '../webviews/webviewShell';
import { TiSnippet } from './snippetStorage';
import { escapeHtml } from '../utils/escapeHtml';

export function getSnippetEditorHtml(snippet: TiSnippet | null, cspSource: string, scriptUri: string): string {
  const trigger     = snippet?.trigger     ?? '';
  const name        = snippet?.name        ?? '';
  const description = snippet?.description ?? '';
  const servers     = snippet?.servers     ?? '';
  const body        = snippet?.body        ?? '';
  const isNew       = snippet === null;
  const title       = isNew ? vscode.l10n.t('Create new snippet') : vscode.l10n.t('Edit snippet');

  return renderWebviewShell({
    cspSource,
    title,
    viewport: true,
    css: `
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 20px 24px;
    margin: 0;
    max-width: 720px;
  }
  h2 {
    margin: 0 0 20px;
    font-size: 1.15em;
    font-weight: 600;
    border-bottom: 1px solid var(--vscode-widget-border, #444);
    padding-bottom: 10px;
  }
  .field { margin-bottom: 16px; }
  label {
    display: block;
    margin-bottom: 5px;
    font-size: 0.82em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vscode-foreground);
  }
  label .hint {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    color: var(--vscode-descriptionForeground);
    margin-left: 5px;
    font-size: 1em;
  }
  input, textarea {
    width: 100%;
    box-sizing: border-box;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #555);
    padding: 6px 8px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    outline: none;
    border-radius: 2px;
  }
  input:focus, textarea:focus { border-color: var(--vscode-focusBorder); }
  textarea {
    font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    resize: vertical;
    min-height: 300px;
    line-height: 1.5;
  }
  .row { display: flex; gap: 12px; align-items: flex-start; }
  .row .field { flex: 1; }
  .row label { min-height: 2.4em; }
  .actions { margin-top: 20px; display: flex; gap: 8px; }
  button {
    padding: 6px 20px;
    border: none;
    cursor: pointer;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    border-radius: 2px;
  }
  #btn-save {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: 1px solid var(--vscode-button-border, transparent);
  }
  #btn-save:hover { background: var(--vscode-button-hoverBackground); }
  #btn-cancel {
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-input-border, #555);
  }
  #btn-cancel:hover { background: rgba(255,255,255,0.06); }
  .err { color: var(--vscode-errorForeground); font-size: 0.82em; margin-top: 4px; display: none; }
  .err.show { display: block; }
`,
    body: `
<h2>${isNew ? '+ ' + vscode.l10n.t('Create new snippet') : vscode.l10n.t('Edit snippet')}</h2>

<div class="row">
  <div class="field">
    <label>${vscode.l10n.t('Trigger')}<span class="hint">${vscode.l10n.t('— trigger word in autocomplete')}</span></label>
    <input id="trigger" type="text" value="${escapeHtml(trigger)}"
      placeholder="${vscode.l10n.t('e.g. errchk')}" spellcheck="false" autocomplete="off" />
    <div class="err" id="err-trigger">${vscode.l10n.t('Required field.')}</div>
  </div>
  <div class="field">
    <label>${vscode.l10n.t('Name')}<span class="hint">${vscode.l10n.t('— display name')}</span></label>
    <input id="name" type="text" value="${escapeHtml(name)}"
      placeholder="${vscode.l10n.t('e.g. Error-Handling template')}" />
    <div class="err" id="err-name">${vscode.l10n.t('Required field.')}</div>
  </div>
</div>

<div class="row">
  <div class="field" style="flex:1.7">
    <label>${vscode.l10n.t('Description')}<span class="hint">${vscode.l10n.t('— optional')}</span></label>
    <input id="description" type="text" value="${escapeHtml(description)}"
      placeholder="${vscode.l10n.t('Short description (shown in autocomplete)')}" />
  </div>
  <div class="field" style="flex:1">
    <label>${vscode.l10n.t('Server')}<span class="hint">${vscode.l10n.t('— optional, semicolon-separated')}</span></label>
    <input id="servers" type="text" value="${escapeHtml(servers)}"
      placeholder="${vscode.l10n.t('e.g. Prod; Dev')}" spellcheck="false" autocomplete="off" />
  </div>
</div>

<div class="field">
  <label>${vscode.l10n.t('Code')}<span class="hint">${vscode.l10n.t('— $1 $2 $0 for tab stops &nbsp;·&nbsp; ${1:placeholder} for named placeholders')}</span></label>
  <textarea id="body" spellcheck="false">${escapeHtml(body)}</textarea>
</div>

<div class="actions">
  <button id="btn-save">${vscode.l10n.t('Save')}</button>
  <button id="btn-cancel">${vscode.l10n.t('Cancel')}</button>
</div>

`,
    globals: { __snippetEditor: { isNew } },
    scriptUris: [scriptUri],
  });
}
