// src/webviewClient/processCoverage/index.ts
// Bundle of the "Run with Coverage" window (commands/processCoverage.ts). Until
// 2026-10 an inline script in the host's template literal.
import { getVsCodeApi } from '../_shared/vscodeApi';
import { showParamPrompt } from '../_shared/paramPrompt';
import type { ParamAsk } from '../_shared/paramPromptProtocol';

type WebviewToHost =
  | { type: 'run'; cap: number }
  | { type: 'reset' }
  | { type: 'open'; section: string; line: number }
  | { type: 'ready' };
const vscode = getVsCodeApi<WebviewToHost, { onlyMiss?: boolean }>();

const el = <E extends HTMLElement = HTMLElement>(id: string): E => document.getElementById(id) as E;
const cap = (): number => Number(el<HTMLSelectElement>('capSel').value);
el('runBtn').addEventListener('click', () => vscode.postMessage({ type: 'run', cap: cap() }));
el('resetBtn').addEventListener('click', () => vscode.postMessage({ type: 'reset' }));
const missChk = el<HTMLInputElement>('missChk');
missChk.checked = !!vscode.getState()?.onlyMiss;
const applyMiss = (): void => {
  el('code').classList.toggle('only-miss', missChk.checked);
  vscode.setState({ onlyMiss: missChk.checked });
};
missChk.addEventListener('change', applyMiss);
applyMiss();
el('code').addEventListener('click', (e) => {
  const ln = (e.target as HTMLElement).closest<HTMLElement>('.ln');
  if (ln) { vscode.postMessage({ type: 'open', section: ln.dataset.s ?? '', line: Number(ln.dataset.l) }); }
});
// The parameter prompt of a run appears in this window (2026-10-28).
window.addEventListener('message', (e: MessageEvent<ParamAsk>) => {
  if (e.data?.type === 'askParams') { showParamPrompt(e.data); }
});
// Tell the host this (re)rendered page listens — it waits for this before asking.
vscode.postMessage({ type: 'ready' });
