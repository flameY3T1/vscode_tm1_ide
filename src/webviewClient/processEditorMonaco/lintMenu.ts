/**
 * Linter rule config dropdown. Groups all ruleIds; each row = enable checkbox
 * + severity select. Posts setLintConfig; host persists, re-broadcasts
 * lintConfig, and the webview re-lints (onLintConfig).
 */
import { vscode } from './state';
import { requestLint } from './lint';
import {
  LINT_RULE_DEFAULTS, mergeLintConfig, type LintRuleConfig,
  UNUSED_VAR_SECTION_DEFAULTS, NAMING_PREFIX_DEFAULTS,
} from '../../tiLogicVisualizer/tiLinter/ruleConfig';
import type { LintRuleId, LintSeverity, TiSection } from '../../tiLogicVisualizer/lintTypes';
import { RULE_LABELS, SEVERITY_LABELS } from './lintRuleLabels';
import { getL10n, fmt } from '../_shared/l10n';

export {};

const L = getL10n();

let current: LintRuleConfig = { rules: {} };

const GROUPS: Array<{ label: string; ids: LintRuleId[] }> = [
  { label: L.lintGroupCorrectness, ids: ['parse-error', 'missing-semicolon', 'wrong-arg-count', 'wrong-param-type', 'type-mismatch-assignment', 'unknown-function', 'undefined-variable', 'expand-missing', 'invalid-arg-value'] },
  { label: L.lintGroupLogic, ids: ['endless-loop', 'dead-code-condition', 'dead-store', 'empty-if', 'empty-while', 'wrong-section', 'processquit-unreachable', 'unused-variable'] },
  { label: L.lintGroupTypes, ids: ['string-compare-without-at', 'numeric-compare-with-at'] },
  { label: L.lintGroupPerformance, ids: ['performance-hint', 'cellput-no-error-handling', 'cube-logging-not-restored', 'temp-object-not-destroyed', 'element-write-before-commit', 'ascii-output-overwrite', 'cellget-in-loop-constant'] },
  { label: L.lintGroupTm1Context, ids: ['ti-unknown-cube', 'ti-unknown-dimension', 'ti-unknown-process', 'ti-wrong-process-params', 'v12-deprecated', 'v12-only', 'v12-file-path', 'process-return-code-literal', 'tm1-error-code', 'hierarchy-style-mixed'] },
  { label: L.lintGroupSecurity, ids: ['exec-command-forbidden', 'process-call-not-literal', 'executeprocess-return-ignored', 'recursive-process-call', 'readonly-param-write', 'odbc-password-not-param', 'hardcoded-path'] },
  { label: L.lintGroupNaming, ids: ['var-naming-prefix', 'param-naming-prefix', 'datasource-var-naming', 'invalid-object-name', 'non-ascii-identifier', 'inconsistent-var-casing'] },
  { label: L.lintGroupComments, ids: ['missing-docstring', 'comment-before-if', 'comment-before-while'] },
];

const SEVERITIES: LintSeverity[] = ['error', 'warning', 'info', 'hint'];

const SECTION_KEYS: TiSection[] = ['prolog', 'metadata', 'data', 'epilog'];
const SECTION_SHORT: Record<TiSection, string> = { prolog: 'P', metadata: 'M', data: 'D', epilog: 'E' };

function existingIds(): LintRuleId[] {
  const grouped = new Set(GROUPS.flatMap(g => g.ids));
  return (Object.keys(LINT_RULE_DEFAULTS) as LintRuleId[]).filter(id => !grouped.has(id));
}

/**
 * True between a local edit's post() and the host's echoed lintConfig. The DOM
 * already reflects the local change (native checkbox/select/input), so we skip
 * the full re-render in onLintConfig — a rebuild would reset the scroll position.
 */
let suppressNextRender = false;

function post(): void {
  suppressNextRender = true;
  vscode.postMessage({ type: 'setLintConfig', config: current });
}

function setRule(id: LintRuleId, patch: { enabled?: boolean; severity?: LintSeverity }): void {
  const eff = mergeLintConfig(current)[id];
  current = { ...current, rules: { ...current.rules, [id]: { enabled: patch.enabled ?? eff.enabled, severity: patch.severity ?? eff.severity } } };
  post();
}

function setUnusedSection(sec: TiSection, on: boolean): void {
  current = { ...current, unusedVariableSections: { ...current.unusedVariableSections, [sec]: on } };
  post();
}

function setNamingPrefix(key: 'numeric' | 'string' | 'param' | 'datasource', val: string): void {
  current = { ...current, namingPrefixes: { ...current.namingPrefixes, [key]: val } };
  post();
}

function prefixInput(key: 'numeric' | 'string' | 'param' | 'datasource', label: string): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'lint-prefix';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'lint-prefix-input';
  inp.value = current.namingPrefixes?.[key] ?? NAMING_PREFIX_DEFAULTS[key];
  inp.size = 3;
  inp.title = fmt(L, 'lintExpectedPrefix', label);
  inp.addEventListener('change', () => setNamingPrefix(key, inp.value));
  wrap.append(label + ':', inp);
  return wrap;
}

function buildSeveritySelect(id: LintRuleId, eff: { severity: LintSeverity }): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = 'lint-rule-sev';
  for (const s of SEVERITIES) {
    const o = document.createElement('option');
    o.value = s; o.textContent = SEVERITY_LABELS[s]; o.selected = eff.severity === s;
    sel.append(o);
  }
  sel.addEventListener('change', () => setRule(id, { severity: sel.value as LintSeverity }));
  return sel;
}

function renderRow(host: HTMLElement, id: LintRuleId, eff: { enabled: boolean; severity: LintSeverity }): void {
  const row = document.createElement('div');
  row.className = 'lint-rule-row';
  const label = RULE_LABELS[id];
  row.title = label.desc;

  if (id === 'unused-variable') {
    // Per-section toggles instead of one enable checkbox.
    const secWrap = document.createElement('span');
    secWrap.className = 'lint-rule-sections';
    for (const sec of SECTION_KEYS) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = current.unusedVariableSections?.[sec] ?? UNUSED_VAR_SECTION_DEFAULTS[sec];
      cb.title = `${label.name} in ${sec}`;
      cb.addEventListener('change', () => setUnusedSection(sec, cb.checked));
      const t = document.createElement('label');
      t.className = 'lint-sec-toggle';
      t.append(cb, SECTION_SHORT[sec]);
      secWrap.append(t);
    }
    const name = document.createElement('span');
    name.className = 'lint-rule-name';
    name.textContent = label.name;
    row.append(secWrap, name, buildSeveritySelect(id, eff));
    host.append(row);
    return;
  }

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'lint-rule-cb';
  cb.checked = eff.enabled;
  cb.addEventListener('change', () => setRule(id, { enabled: cb.checked }));
  const name = document.createElement('span');
  name.className = 'lint-rule-name';
  name.textContent = label.name;
  const sevSel = buildSeveritySelect(id, eff);
  if (id === 'var-naming-prefix') {
    row.append(cb, name, prefixInput('numeric', 'n'), prefixInput('string', 's'), sevSel);
  } else if (id === 'param-naming-prefix') {
    row.append(cb, name, prefixInput('param', 'p'), sevSel);
  } else if (id === 'datasource-var-naming') {
    row.append(cb, name, prefixInput('datasource', 'v'), sevSel);
  } else {
    row.append(cb, name, sevSel);
  }
  host.append(row);
}

export function renderLintMenu(): void {
  const host = document.getElementById('lint-config-host');
  if (!host) { return; }
  host.replaceChildren();
  const eff = mergeLintConfig(current);
  const group = (label: string, ids: LintRuleId[]) => {
    const h = document.createElement('div');
    h.className = 'lint-group-head';
    h.textContent = label;
    host.append(h);
    for (const id of ids) { renderRow(host, id, eff[id]); }
  };
  for (const g of GROUPS) { group(g.label, g.ids); }
  // Safety net: any ruleId not assigned to a group above (e.g. a newly added rule).
  const leftover = existingIds();
  if (leftover.length) { group(L.lintGroupOther, leftover); }

  // Import/Export footer. Host reads configs from globalState — no payload.
  const footer = document.createElement('div');
  footer.className = 'lint-config-footer';
  const heading = document.createElement('div');
  heading.className = 'lint-config-io-heading';
  heading.textContent = L.lintConfigIoHeading;
  const row = document.createElement('div');
  row.className = 'lint-config-io-row';
  const mkBtn = (label: string, type: 'exportTiConfig' | 'importTiConfig'): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lint-cfg-btn';
    b.textContent = label;
    b.addEventListener('click', () => vscode.postMessage({ type }));
    return b;
  };
  row.append(mkBtn(L.lintExportConfig, 'exportTiConfig'), mkBtn(L.lintImportConfig, 'importTiConfig'));
  footer.append(heading, row);
  host.append(footer);
}

/** Host pushed a new config: store, re-render, re-lint. */
export function onLintConfig(cfg: LintRuleConfig): void {
  current = cfg ?? { rules: {} };
  // Local edit echo: DOM is already up to date → only re-lint, don't rebuild
  // the menu (rebuild would jump the scroll position back to the top).
  if (suppressNextRender) {
    suppressNextRender = false;
    requestLint();
    return;
  }
  renderLintMenu();
  requestLint();
}

export function initLintMenu(): void {
  renderLintMenu();
  const tabResults = document.getElementById('lint-subtab-results');
  const tabRules = document.getElementById('lint-subtab-rules');
  const panResults = document.getElementById('lint-sub-results');
  const panRules = document.getElementById('lint-sub-rules');
  if (!tabResults || !tabRules || !panResults || !panRules) { return; }
  const show = (rules: boolean) => {
    tabRules.classList.toggle('active', rules);
    tabResults.classList.toggle('active', !rules);
    panRules.classList.toggle('active', rules);
    panResults.classList.toggle('active', !rules);
  };
  tabResults.addEventListener('click', () => show(false));
  tabRules.addEventListener('click', () => show(true));
}
