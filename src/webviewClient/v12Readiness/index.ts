export {};
import { getVsCodeApi } from '../_shared/vscodeApi';
import type { WebviewToHost } from '../../v12Readiness/protocol';
import type { ProcSection } from '../../v12Readiness/types';

/**
 * The host redraws the whole page after a decision (false-alarm badge, retire tile). Scroll
 * position and opened sections survive that through the webview state, otherwise every edit would throw the reader back to the top.
 */
interface ViewState { scrollY: number; open: string[] }
const api = getVsCodeApi<WebviewToHost, ViewState>();

function saveView(): void {
  const open = Array.from(document.querySelectorAll<HTMLDetailsElement>('details[data-key]'))
    .filter(d => d.open).map(d => d.dataset.key ?? '');
  api.setState({ scrollY: window.scrollY, open });
}

const restored = api.getState();
if (restored) {
  const open = new Set(restored.open);
  document.querySelectorAll<HTMLDetailsElement>('details[data-key]').forEach(d => { if (open.has(d.dataset.key ?? '')) { d.open = true; } });
  window.scrollTo(0, restored.scrollY);
}
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
window.addEventListener('scroll', () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(saveView, 150); });
document.addEventListener('toggle', saveView, true);

document.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest('a[data-process], a[data-cube], button[data-export], button[data-action]') as HTMLElement | null;
  if (!el) { return; }
  ev.preventDefault();
  saveView();
  const action = el.dataset.action;
  if (action === 'rescan' || action === 'compileV12' || action === 'saveAssessment' || action === 'openAssessment') {
    api.postMessage({ type: action });
    return;
  }
  if (el.dataset.cube) {
    api.postMessage({ type: 'openRules', cube: el.dataset.cube, line: Number(el.dataset.line ?? 0) });
    return;
  }
  if (el.dataset.export) {
    const [format, cut] = el.dataset.export.split(':') as ['html' | 'md', 'full' | 'extract'];
    api.postMessage({ type: 'export', format, cut });
    return;
  }
  api.postMessage({
    type: 'open',
    process: el.dataset.process ?? '',
    section: (el.dataset.section || undefined) as ProcSection | undefined,
    line: Number(el.dataset.line ?? 0),
  });
});

// Decisions: a checkbox per cause (known false alarm), a select per unused process.
document.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement | HTMLSelectElement;
  const id = el.dataset.id;
  if (!id || !el.dataset.decide) { return; }
  saveView();
  const value = el instanceof HTMLInputElement && el.type === 'checkbox'
    ? (el.checked ? 'not-an-issue' : 'open') : el.value;
  api.postMessage({ type: 'decide', id, value });
});


