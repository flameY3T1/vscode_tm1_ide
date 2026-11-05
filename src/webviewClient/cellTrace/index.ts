// src/webviewClient/cellTrace/index.ts
import type { TraceKind, TracePanelIn } from './protocol';
import { renderRuleTree, renderFeeders, renderUnfed, renderError, renderLoading, setAllExpanded, deliverChildren } from './render';
import { getL10n, fmt } from '../_shared/l10n';
import { vscode } from './vscodeApi';
import { nameMap } from '../../utils/nameMapPure';

const L = getL10n();

const content = () => document.getElementById('trace-content') as HTMLElement;
const title = () => document.getElementById('trace-title') as HTMLElement;
const subtitle = () => document.getElementById('trace-subtitle') as HTMLElement;
const zeroToggle = () => document.getElementById('trace-zero-toggle') as HTMLInputElement;
const zeroWrap = () => document.getElementById('trace-zero-wrap') as HTMLElement;

let lastMsg: Exclude<TracePanelIn, { type: 'children' | 'childrenError' }> | null = null;
/** Dimensions per cube seen so far — shared with the tree for formula values. */
const cubeDims = nameMap<string[]>();
let activeKind: TraceKind = 'rule';

function setBusy(b: boolean): void {
  const el = document.getElementById('trace-spinner');
  if (el) { el.style.display = b ? '' : 'none'; }
}

/** Highlight the active tab and show only the actions that apply to it:
 *  the zero filter and expand/collapse are tree-only concepts. */
function setKind(kind: TraceKind): void {
  activeKind = kind;
  for (const tab of Array.from(document.querySelectorAll('.tab'))) {
    tab.classList.toggle('active', (tab as HTMLElement).dataset.kind === kind);
  }
  const treeMode = kind === 'rule';
  zeroWrap()?.toggleAttribute('hidden', !treeMode);
  document.getElementById('trace-expand')?.toggleAttribute('hidden', !treeMode);
  document.getElementById('trace-collapse')?.toggleAttribute('hidden', !treeMode);
}

/** Cube stays in the toolbar title; the (long) coordinates get their own row. */
function setHeader(cube: string, coords: string): void {
  title().textContent = fmt(L, 'traceTitle', cube);
  subtitle().textContent = coords;
}

/** Whole-panel messages; `children`/`childrenError` answer one node and never reach here. */
type PanelMsg = Exclude<TracePanelIn, { type: 'children' | 'childrenError' }>;

function render(msg: PanelMsg): void {
  setBusy(false);
  switch (msg.type) {
    case 'loading':
      if (msg.kind) { setKind(msg.kind); }
      // Drop the previous mode's result: the tab highlight has already moved,
      // so leaving e.g. the rule tree under an active "Check feeders" tab
      // (with its tree-only controls gone) shows a state that never existed.
      renderLoading(content());
      setBusy(true);
      return;
    case 'error': renderError(content(), msg.message); return;
    case 'ruleResult':
      setKind('rule');
      setHeader(msg.cube, msg.coords);
      cubeDims[msg.cube] = msg.dims;
      renderRuleTree(content(), msg.root, { hideZero: !zeroToggle()?.checked }, { rules: msg.rules, cube: msg.cube, dims: cubeDims });
      return;
    case 'feedersResult':
      setKind('feeders');
      setHeader(msg.cube, msg.coords);
      renderFeeders(content(), msg.feeders, { rules: msg.rules, cube: msg.cube });
      return;
    case 'checkResult':
      setKind('check');
      setHeader(msg.cube, msg.coords);
      renderUnfed(content(), msg.unfed);
      return;
  }
}

window.addEventListener('message', (ev: MessageEvent) => {
  const msg = ev.data as TracePanelIn;
  if (!msg?.type) { return; }
  // Children answer a node's own request; they change neither lastMsg nor the rest of the panel.
  if (msg.type === 'children') {
    if (msg.node.cube) { cubeDims[msg.node.cube] = msg.dims; }
    deliverChildren(msg.id, { node: msg.node });
    return;
  }
  if (msg.type === 'childrenError') { deliverChildren(msg.id, { error: msg.message }); return; }
  // The zero-toggle re-renders whatever is currently on screen — and `loading`
  // just wiped it, so there is nothing left to re-render until the result for
  // the newly active tab arrives.
  lastMsg = msg.type === 'loading' ? null : msg;
  render(msg);
});

window.addEventListener('DOMContentLoaded', () => {
  setKind(activeKind);
  zeroToggle()?.addEventListener('change', () => { if (lastMsg) { render(lastMsg); } });
  document.getElementById('trace-expand')?.addEventListener('click', () => setAllExpanded(content(), true));
  document.getElementById('trace-collapse')?.addEventListener('click', () => setAllExpanded(content(), false));
  // Switching tabs re-traces the SAME cell in the other mode; the host answers
  // into this very panel (it is keyed per cell).
  for (const tab of Array.from(document.querySelectorAll('.tab'))) {
    tab.addEventListener('click', () => {
      const kind = (tab as HTMLElement).dataset.kind as TraceKind | undefined;
      if (!kind || kind === activeKind) { return; }
      setKind(kind);
      setBusy(true);
      vscode.postMessage({ type: 'switchMode', kind });
    });
  }
});
