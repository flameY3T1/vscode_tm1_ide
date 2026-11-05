import { escapeHtml } from '../../utils/escapeHtml';
import type { TiParam } from '../../utils/proFile';
/** Pure helpers for processParams — no vscode dependencies. */

/** Localizable chrome of the parameter form. Pure module — the caller translates. */
export interface ParamFormLabels {
  /** Label of the secondary (dismiss) button. */
  cancel: string;
  /** Already-formatted parameter count, e.g. "2 Parameters". */
  paramCount: string;
  /** BCP-47 tag for the document `lang` attribute. */
  lang: string;
}

/**
 * Build styled HTML form for parameter input. Pure — emits VS Code
 * webview-compatible HTML with inline CSS; the script is the bundle
 * `webviewClient/paramForm/` (`security.scriptUri`).
 *
 * `processName` and `buttonLabel` are HTML-escaped to prevent injection.
 *
 * `security`: provides a nonce + cspSource for a strict nonce-based CSP.
 * Production callers MUST supply real values via getNonce() + webview.cspSource.
 * Defaults to empty strings so existing tests still parse the HTML structure.
 *
 * `labels`: chrome the caller has to localize (this module may not import
 * vscode). The defaults are English — a caller that forgets to translate must
 * fall back to the extension's base language, never to the author's.
 *
 * The bundle mirrors every keystroke into the webview state via `setState`
 * and restores it on load, so typed values survive VS Code tearing the
 * webview down while its tab sits in the background.
 */
export function buildFormHtmlStyled(
  processName: string,
  params: TiParam[],
  buttonLabel: string,
  security: { nonce: string; cspSource: string; scriptUri?: string } = { nonce: '', cspSource: '' },
  labels: Partial<ParamFormLabels> = {},
): string {
  const lbl: ParamFormLabels = {
    cancel: labels.cancel ?? 'Cancel',
    paramCount: labels.paramCount ?? `${params.length} Parameters`,
    lang: labels.lang ?? 'en',
  };
  const csp = [
    `default-src 'none'`,
    `style-src ${security.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${security.nonce}'`,
  ].join('; ');
  const esc = (s: unknown): string => escapeHtml(String(s ?? ''));

  const rows = params.map((p, i) => {
    const isNum = p.Type === 1;
    const inputType = isNum ? 'number' : 'text';
    const escaped = esc(p.Value);
    const label = esc(p.Prompt || p.Name);
    const name = esc(p.Name);
    const typeTag = isNum
      ? '<span class="type-badge numeric">Numeric</span>'
      : '<span class="type-badge string">String</span>';
    return `
      <div class="param-card">
        <div class="param-header">
          <span class="param-name">${name}</span>
          ${typeTag}
        </div>
        ${p.Prompt ? `<div class="param-desc">${label}</div>` : ''}
        <input type="${inputType}" name="${name}" value="${escaped}" step="any" placeholder="${isNum ? '0' : ''}" ${i === 0 ? 'autofocus' : ''} />
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="${esc(lbl.lang)}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    display: flex;
    justify-content: center;
    padding: 32px 16px;
  }
  .container { width: 100%; max-width: 520px; }
  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 24px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--vscode-editorGroup-border);
  }
  .header .icon {
    font-size: 20px;
    opacity: 0.7;
  }
  .header h2 {
    font-size: 1.1em;
    font-weight: 600;
    color: var(--vscode-foreground);
  }
  .header .count {
    margin-left: auto;
    font-size: 0.8em;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    padding: 2px 8px;
    border-radius: 10px;
  }
  .param-card {
    background: var(--vscode-editorGroupHeader-tabsBackground);
    border: 1px solid var(--vscode-editorGroup-border);
    border-radius: 6px;
    padding: 12px 14px;
    margin-bottom: 10px;
    transition: border-color 0.15s;
  }
  .param-card:focus-within {
    border-color: var(--vscode-focusBorder);
  }
  .param-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .param-name {
    font-weight: 600;
    font-size: 0.95em;
  }
  .type-badge {
    font-size: 0.7em;
    padding: 1px 6px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }
  .type-badge.string {
    background: rgba(78, 154, 6, 0.15);
    color: var(--vscode-debugTokenExpression-string, #6a9955);
  }
  .type-badge.numeric {
    background: rgba(181, 137, 0, 0.15);
    color: var(--vscode-debugTokenExpression-number, #b5cea8);
  }
  .param-desc {
    font-size: 0.85em;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 6px;
  }
  .param-card input {
    width: 100%;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    padding: 6px 10px;
    font-size: inherit;
    font-family: var(--vscode-editor-font-family);
    border-radius: 3px;
  }
  .param-card input:focus {
    outline: none;
    border-color: var(--vscode-focusBorder);
  }
  .buttons {
    margin-top: 20px;
    display: flex;
    gap: 8px;
  }
  button {
    padding: 8px 24px;
    border: none;
    cursor: pointer;
    font-size: inherit;
    border-radius: 3px;
  }
  button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <span class="icon">▶</span>
    <h2>${esc(processName)}</h2>
    <span class="count">${esc(lbl.paramCount)}</span>
  </div>
  <form id="f">
    ${rows}
    <div class="buttons">
      <button type="submit" class="primary">${esc(buttonLabel)}</button>
      <button type="button" class="secondary" id="cancel">${esc(lbl.cancel)}</button>
    </div>
  </form>
</div>
${security.scriptUri ? `<script nonce="${security.nonce}" src="${esc(security.scriptUri)}"></script>` : ''}
</body>
</html>`;
}
