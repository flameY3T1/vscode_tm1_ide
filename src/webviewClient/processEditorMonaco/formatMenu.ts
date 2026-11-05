/**
 * Renders the per-instance formatter config dropdown. On any change it posts
 * `setFormatConfig`; the host persists and re-broadcasts `formatConfig`,
 * which re-renders the menu (single source of truth = host).
 */
import { vscode } from './state';
import { getFormatConfig, formatAllSections } from './format';
import type { TiFormatConfig, FRuleId } from '../../tiLogicVisualizer/formatRules';
import { getL10n } from '../_shared/l10n';

export {};

const L = getL10n();

const RULE_LABELS: Array<[FRuleId, string]> = [
  ['keyword-case', L.fmtRuleKeywordCase],
  ['operator-spacing', L.fmtRuleOperatorSpacing],
  ['space-after-comma', L.fmtRuleSpaceAfterComma],
  ['no-space-before-semicolon', L.fmtRuleNoSpaceBeforeSemicolon],
  ['collapse-spaces', L.fmtRuleCollapseSpaces],
  ['no-trailing-space', L.fmtRuleNoTrailingSpace],
  ['space-after-comment', L.fmtRuleSpaceAfterComment],
  ['block-indent', L.fmtRuleBlockIndent],
  ['one-statement-per-line', L.fmtRuleOneStatementPerLine],
  ['max-blank-lines', L.fmtRuleMaxBlankLines],
  ['wrap-long-calls', L.fmtRuleWrapLongCalls],
];

function post(cfg: TiFormatConfig): void {
  vscode.postMessage({ type: 'setFormatConfig', config: cfg });
}

export function renderFormatMenu(cfg: TiFormatConfig): void {
  const host = document.getElementById('format-menu');
  if (!host) { return; }
  host.replaceChildren();

  // "Apply now" is the primary action of the dropdown; the rule toggles below
  // configure how it (and Ctrl+Shift+I) formats.
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'act';
  const applyLbl = document.createElement('span'); applyLbl.className = 'lbl'; applyLbl.textContent = L.fmtApplyNow;
  const applyKbd = document.createElement('span'); applyKbd.className = 'kbd'; applyKbd.textContent = 'Ctrl+Shift+I';
  apply.append(applyLbl, applyKbd);
  apply.addEventListener('click', () => { formatAllSections(); host.hidden = true; });
  host.append(apply);
  const sep = document.createElement('div'); sep.className = 'menu-sep'; host.append(sep);

  for (const [id, label] of RULE_LABELS) {
    const wrap = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = cfg.enabled[id];
    cb.addEventListener('change', () => {
      post({ ...cfg, enabled: { ...cfg.enabled, [id]: cb.checked } });
    });
    wrap.append(cb, ' ' + label);
    host.append(wrap);

    if (id === 'keyword-case') {
      const sel = document.createElement('select');
      for (const v of ['upper', 'lower', 'camel'] as const) {
        const o = document.createElement('option');
        o.value = v; o.textContent = v; o.selected = cfg.keywordCase === v;
        sel.append(o);
      }
      sel.addEventListener('change', () => {
        post({ ...cfg, keywordCase: sel.value as TiFormatConfig['keywordCase'] });
      });
      const l = document.createElement('label'); l.append('  ' + L.fmtStyleLabel, sel); host.append(l);
    }
  }

  const parenWrap = document.createElement('label');
  const parenSel = document.createElement('select');
  for (const v of ['tight', 'spaced', 'off'] as const) {
    const o = document.createElement('option');
    o.value = v; o.textContent = v; o.selected = cfg.parenStyle === v;
    parenSel.append(o);
  }
  parenSel.addEventListener('change', () => {
    post({ ...cfg, parenStyle: parenSel.value as TiFormatConfig['parenStyle'] });
  });
  parenWrap.append(L.fmtParenLabel, parenSel);
  host.append(parenWrap);
}

/** Toggle dropdown visibility; render from the current (host-pushed) config. */
export function initFormatMenu(): void {
  const btn = document.getElementById('btn-format');
  const menu = document.getElementById('format-menu');
  if (!btn || !menu) { return; }
  btn.addEventListener('click', () => {
    if (menu.hidden) {
      const r = btn.getBoundingClientRect();
      menu.style.left = `${r.left}px`;
      menu.style.top = `${r.bottom + 2}px`;
      renderFormatMenu(getFormatConfig());
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
