// src/webviewClient/_shared/paramPrompt.ts
//
// Parameter prompt as an overlay in the window the run was started from
// (process editor, coverage), instead of a separate tab (2026-10-28). The host
// posts `askParams` (commands/processEditor/processParams.ts#askParamsInPanel),
// we answer with `paramsAnswer` — values on submit, null on Cancel / Escape.
// Looks like the shared confirm dialog and reuses its sheet.
import { ensureStyle } from './confirmDialog';
import { getVsCodeApi } from './vscodeApi';

import type { ParamAsk, ParamsAnswer } from './paramPromptProtocol';

type Ask = ParamAsk;

const vscode = getVsCodeApi<ParamsAnswer>();

const CSS = `
.tm1-param-row { margin: 10px 0; }
.tm1-param-row label { display: block; font-weight: 600; margin-bottom: 2px; }
.tm1-param-row .tm1-param-desc { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 4px; }
.tm1-param-row input {
  width: 100%; box-sizing: border-box; padding: 4px 6px; font: inherit;
  background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 2px;
}
.tm1-param-row input:focus { outline: 1px solid var(--vscode-focusBorder); }
.tm1-param-box { min-width: 360px; max-width: 560px; max-height: 80vh; overflow: auto; }
`;

function ensureParamStyle(): void {
  ensureStyle();
  if (document.getElementById('tm1-param-style')) { return; }
  const style = document.createElement('style');
  style.id = 'tm1-param-style';
  style.textContent = CSS;
  document.head.appendChild(style);
}

export function showParamPrompt(ask: Ask): void {
  ensureParamStyle();
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const backdrop = document.createElement('div');
  backdrop.className = 'tm1-confirm-backdrop';
  const form = document.createElement('form');
  form.className = 'tm1-confirm-box tm1-param-box';
  form.setAttribute('role', 'dialog');
  form.setAttribute('aria-modal', 'true');

  const title = document.createElement('div');
  title.className = 'tm1-confirm-message';
  title.textContent = ask.title;
  form.appendChild(title);

  const inputs: HTMLInputElement[] = [];
  ask.params.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'tm1-param-row';
    const id = `tm1-param-${i}`;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = p.name;
    row.appendChild(label);
    if (p.prompt) {
      const desc = document.createElement('div');
      desc.className = 'tm1-param-desc';
      desc.textContent = p.prompt;
      row.appendChild(desc);
    }
    const input = document.createElement('input');
    input.id = id;
    input.name = p.name;
    input.type = p.numeric ? 'number' : 'text';
    input.step = 'any';
    input.value = p.value;
    row.appendChild(input);
    inputs.push(input);
    form.appendChild(row);
  });

  const actions = document.createElement('div');
  actions.className = 'tm1-confirm-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'secondary';
  cancel.textContent = ask.cancelLabel;
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = ask.submitLabel;
  actions.append(cancel, submit);
  form.appendChild(actions);
  backdrop.appendChild(form);

  let done = false;
  function close(values: Record<string, string> | null): void {
    if (done) { return; }
    done = true;
    backdrop.remove();
    vscode.postMessage({ type: 'paramsAnswer', requestId: ask.requestId, values });
    previouslyFocused?.focus?.();
  }
  // A submit button inside a form: Enter in any input submits.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    close(Object.fromEntries(inputs.map((i) => [i.name, i.value])));
  });
  cancel.addEventListener('click', () => close(null));
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
  });

  document.body.appendChild(backdrop);
  (inputs[0] ?? submit).focus();
  inputs[0]?.select();
}
