/**
 * Renders the per-instance rules-formatter config dropdown. On any change it
 * posts `setFormatConfig`; the host persists and re-broadcasts `formatConfig`,
 * which re-renders the menu (single source of truth = host).
 */
import { getFormatConfig } from './format';
import type { RuleFormatConfig, RuleFormatRuleId } from '../../tiLogicVisualizer/formatRulesText';
import type { WebviewToHost } from './protocol';
import { getL10n } from '../_shared/l10n';

const L = getL10n();

type PostFn = (msg: WebviewToHost) => void;

const RULE_LABELS: Array<[RuleFormatRuleId, string]> = [
  ['casing', L.fmtCasing],
  ['operators', L.fmtOperators],
  ['commaSpace', L.fmtCommaSpace],
  ['semicolon', L.fmtSemicolon],
  ['collapseSpaces', L.fmtCollapseSpaces],
  ['trailing', L.fmtTrailing],
  ['commentHash', L.fmtCommentHash],
  ['blankLines', L.fmtBlankLines],
  ['splitStatements', L.fmtSplitStatements],
];

export function renderFormatMenu(post: PostFn, cfg: RuleFormatConfig, onApply?: () => void): void {
  const host = document.getElementById('format-menu');
  if (!host) { return; }
  host.replaceChildren();

  // "Apply now" is the primary action of the dropdown (analog to the process
  // editor); the rule toggles below configure how it (and Ctrl+Shift+I) formats.
  if (onApply) {
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'act';
    const applyLbl = document.createElement('span'); applyLbl.className = 'lbl'; applyLbl.textContent = L.fmtApplyNow;
    const applyKbd = document.createElement('span'); applyKbd.className = 'kbd'; applyKbd.textContent = 'Ctrl+Shift+I';
    apply.append(applyLbl, applyKbd);
    apply.addEventListener('click', () => { onApply(); host.hidden = true; });
    host.append(apply);
    const sep = document.createElement('div'); sep.className = 'menu-sep'; host.append(sep);
  }

  for (const [id, label] of RULE_LABELS) {
    const wrap = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = cfg.enabled[id];
    cb.addEventListener('change', () => {
      post({ type: 'setFormatConfig', config: { ...cfg, enabled: { ...cfg.enabled, [id]: cb.checked } } });
    });
    wrap.append(cb, ' ' + label);
    host.append(wrap);
  }

  const parenWrap = document.createElement('label');
  const parenSel = document.createElement('select');
  for (const v of ['tight', 'spaced', 'off'] as const) {
    const o = document.createElement('option');
    o.value = v; o.textContent = v; o.selected = cfg.parenStyle === v;
    parenSel.append(o);
  }
  parenSel.addEventListener('change', () => {
    post({ type: 'setFormatConfig', config: { ...cfg, parenStyle: parenSel.value as RuleFormatConfig['parenStyle'] } });
  });
  parenWrap.append(L.fmtParens, parenSel);
  host.append(parenWrap);
}

/** Toggle dropdown visibility; render from the current (host-pushed) config. */
export function initFormatMenu(post: PostFn, onApply?: () => void): void {
  const btn = document.getElementById('btn-format');
  const menu = document.getElementById('format-menu');
  if (!btn || !menu) { return; }
  btn.addEventListener('click', () => {
    if (menu.hidden) {
      const r = btn.getBoundingClientRect();
      menu.style.left = `${r.left}px`;
      menu.style.top = `${r.bottom + 2}px`;
      renderFormatMenu(post, getFormatConfig(), onApply);
      menu.hidden = false;
    } else {
      menu.hidden = true;
    }
  });
  document.addEventListener('click', (e) => {
    // btn contains <img> children, so guard on containment (not identity).
    const t = e.target as Node;
    if (!menu.hidden && !btn.contains(t) && !menu.contains(t)) { menu.hidden = true; }
  });
}
