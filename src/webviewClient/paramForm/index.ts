// src/webviewClient/paramForm/index.ts
// Bundle of the process parameter form (commands/processEditor/processParamsPure.ts).
// Until 2026-10 an inline script. Mirrors every keystroke into the webview state
// and restores it on load, so typed values survive VS Code tearing the webview
// down while its tab sits in the background.
import { getVsCodeApi } from '../_shared/vscodeApi';

type WebviewToHost =
  | { command: 'submit'; values: Record<string, string> }
  | { command: 'cancel' };
const vscode = getVsCodeApi<WebviewToHost, { values?: Record<string, string> }>();

const inputs = (): NodeListOf<HTMLInputElement> => document.querySelectorAll<HTMLInputElement>('input[name]');
const collect = (): Record<string, string> => {
  const values: Record<string, string> = {};
  inputs().forEach((el) => { values[el.name] = el.value; });
  return values;
};
// Restore what was typed before VS Code discarded the hidden webview.
const saved = vscode.getState()?.values;
if (saved) {
  inputs().forEach((el) => {
    if (Object.prototype.hasOwnProperty.call(saved, el.name)) { el.value = saved[el.name]; }
  });
}
const form = document.getElementById('f') as HTMLFormElement;
document.addEventListener('input', () => { vscode.setState({ values: collect() }); });
form.addEventListener('submit', (e) => {
  e.preventDefault();
  vscode.postMessage({ command: 'submit', values: collect() });
});
document.getElementById('cancel')?.addEventListener('click', () => {
  vscode.postMessage({ command: 'cancel' });
});
// Enter in an input = submit
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
    e.preventDefault();
    form.requestSubmit();
  }
});
