/**
 * Rules-linter rule config — the rule editor's counterpart to the process editor's
 * lint config panel (`processEditorMonaco/lintMenu.ts`), down to the sub-tab layout:
 * the Linter tab holds "Results | Rules", so the rules that produce a finding sit one
 * click away from the finding itself.
 *
 * Same contract as over there: each row is an enable checkbox + a severity select;
 * any change posts `setRulesLintConfig`, the host persists it and echoes
 * `rulesLintConfig` back, so the host stays the single source of truth.
 */
import {
  RULES_LINT_DEFAULTS, RULES_LINT_GROUPS, mergeRulesLintConfig,
  type RulesLintConfig, type RulesLintRuleId, type RulesLintSeverity,
} from '../../tiLogicVisualizer/rulesLinter/ruleConfig';
import { RULES_RULE_LABELS, RULES_SEVERITY_LABELS, RULES_GROUP_LABELS } from './rulesLintRuleLabels';
import type { WebviewToHost } from './protocol';

export {};

type PostFn = (msg: WebviewToHost) => void;

const SEVERITIES: RulesLintSeverity[] = ['error', 'warning', 'info', 'hint'];

let current: RulesLintConfig = { rules: {} };
let postFn: PostFn | null = null;

/**
 * True between a local edit's post() and the host's echoed config. The DOM already
 * reflects the change (native checkbox/select), so the echo must not rebuild the
 * menu — a rebuild would reset the scroll position mid-click.
 */
let suppressNextRender = false;

function post(): void {
  suppressNextRender = true;
  postFn?.({ type: 'setRulesLintConfig', config: current });
}

function setRule(id: RulesLintRuleId, patch: { enabled?: boolean; severity?: RulesLintSeverity }): void {
  const eff = mergeRulesLintConfig(current)[id];
  current = {
    ...current,
    rules: {
      ...current.rules,
      [id]: { enabled: patch.enabled ?? eff.enabled, severity: patch.severity ?? eff.severity },
    },
  };
  post();
}

/** Any ruleId not covered by RULES_LINT_GROUPS — a newly added rule must still show up. */
function ungroupedIds(): RulesLintRuleId[] {
  const grouped = new Set(RULES_LINT_GROUPS.flatMap(g => g.ids));
  return (Object.keys(RULES_LINT_DEFAULTS) as RulesLintRuleId[]).filter(id => !grouped.has(id));
}

function renderRow(host: HTMLElement, id: RulesLintRuleId, eff: { enabled: boolean; severity: RulesLintSeverity }): void {
  const label = RULES_RULE_LABELS[id];
  const row = document.createElement('div');
  row.className = 'lint-rule-row';
  row.title = label.desc;

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'lint-rule-cb';
  cb.checked = eff.enabled;
  cb.addEventListener('change', () => setRule(id, { enabled: cb.checked }));

  const name = document.createElement('span');
  name.className = 'lint-rule-name';
  name.textContent = label.name;

  const sel = document.createElement('select');
  sel.className = 'lint-rule-sev';
  for (const s of SEVERITIES) {
    const o = document.createElement('option');
    o.value = s;
    o.textContent = RULES_SEVERITY_LABELS[s];
    o.selected = eff.severity === s;
    sel.append(o);
  }
  sel.addEventListener('change', () => setRule(id, { severity: sel.value as RulesLintSeverity }));

  row.append(cb, name, sel);
  host.append(row);
}

export function renderLintMenu(): void {
  const host = document.getElementById('lint-menu');
  if (!host) { return; }
  host.replaceChildren();
  const eff = mergeRulesLintConfig(current);

  const group = (label: string, ids: RulesLintRuleId[]): void => {
    if (!ids.length) { return; }
    const h = document.createElement('div');
    h.className = 'lint-group-head';
    h.textContent = label;
    host.append(h);
    for (const id of ids) { renderRow(host, id, eff[id]); }
  };

  for (const g of RULES_LINT_GROUPS) {
    group(RULES_GROUP_LABELS[g.key] ?? g.key, g.ids);
  }
  group(RULES_GROUP_LABELS.other, ungroupedIds());
}

/** Host pushed a new config: store it, re-render unless this is our own echo. */
export function onRulesLintConfig(cfg: RulesLintConfig): void {
  current = cfg ?? { rules: {} };
  if (suppressNextRender) {
    suppressNextRender = false;
    return;
  }
  renderLintMenu();
}

export function initLintMenu(post: PostFn): void {
  postFn = post;
  renderLintMenu();

  // Untertabs im Linter-Panel, gleiche Aufteilung wie im Prozesseditor:
  // links die Befunde, rechts die Regeln, die sie erzeugen.
  const tabResults = document.getElementById('lint-subtab-results');
  const tabRules = document.getElementById('lint-subtab-rules');
  const panResults = document.getElementById('lint-sub-results');
  const panRules = document.getElementById('lint-sub-rules');
  if (!tabResults || !tabRules || !panResults || !panRules) { return; }

  const show = (rules: boolean): void => {
    tabRules.classList.toggle('active', rules);
    tabResults.classList.toggle('active', !rules);
    panRules.classList.toggle('active', rules);
    panResults.classList.toggle('active', !rules);
  };
  tabResults.addEventListener('click', () => show(false));
  tabRules.addEventListener('click', () => show(true));
}
