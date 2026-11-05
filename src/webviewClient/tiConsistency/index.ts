export {};
import { getVsCodeApi } from '../_shared/vscodeApi';
import type { HostToWebview, WebviewToHost } from '../../tiConsistency/protocol';
import type { RuleKind, UnitKey } from '../../tiConsistency/types';
import { getL10n, fmt } from '../_shared/l10n';
import { resolveTarget } from './pure';
import { selectedProcesses, setLoading, wireListButton, renderProcessList, upsertPlanNote, showReport } from '../_shared/processPickerPanel';

const vscodeApi = getVsCodeApi<WebviewToHost>();
const L = getL10n();

type Occ = { process: string; unit: UnitKey; line: number };
type Variant = { spelling: string; count: number; occurrences: Occ[] };
type Group = { key: string; kind: string; targetSuggestion: string; editableTarget: boolean; variants: Variant[] };

const $ = (id: string) => document.getElementById(id) as HTMLElement;
// The <select> options are the RuleKind values (tiConsistencyBody.ts).
const ruleSel = () => ($('rule') as HTMLSelectElement).value as RuleKind;
const IDENT = /^[A-Za-z_]\w*$/;

// Per-rule explainer shown under the dropdown so the user knows what a rule
// does before running it.
const RULE_DESC: Record<string, string> = {
  'var-casing': L.ruleDescVarCasing,
  'param-casing': L.ruleDescParamCasing,
  'datasource-casing': L.ruleDescDatasourceCasing,
  'function-casing': L.ruleDescFunctionCasing,
  'keyword-casing': L.ruleDescKeywordCasing,
  'variable-naming': L.ruleDescVariableNaming,
  'param-naming': L.ruleDescParamNaming,
  'datasource-naming': L.ruleDescDatasourceNaming,
};

// Naming prefixes (shared with the linter config). Which slots a naming rule
// exposes: variable → numeric + string, param → param, datasource → datasource.
type PrefixSlot = 'numeric' | 'string' | 'param' | 'datasource';
const PREFIX_DEFAULTS: Record<PrefixSlot, string> = { numeric: 'n', string: 's', param: 'p', datasource: 'v' };
const RULE_PREFIX_SLOTS: Record<string, [PrefixSlot, string][]> = {
  'variable-naming': [['numeric', L.prefixNumeric], ['string', L.prefixString]],
  'param-naming': [['param', L.prefixParam]],
  'datasource-naming': [['datasource', L.prefixDatasource]],
};
let prefixes: Partial<Record<PrefixSlot, string>> = {};

function renderPrefixCfg(): void {
  const box = $('prefixCfg');
  box.textContent = '';
  const slots = RULE_PREFIX_SLOTS[ruleSel()];
  if (!slots) { box.classList.remove('show'); return; }
  box.classList.add('show');
  const note = document.createElement('span');
  note.className = 'note';
  note.textContent = L.prefixCfgNote;
  box.appendChild(note);
  for (const [slot, label] of slots) {
    const lab = document.createElement('label');
    lab.appendChild(document.createTextNode(label + ' '));
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = prefixes[slot] ?? PREFIX_DEFAULTS[slot];
    inp.addEventListener('change', () => {
      prefixes = { ...prefixes, [slot]: inp.value };
      vscodeApi.postMessage({ type: 'setNamingPrefixes', prefixes });
    });
    lab.appendChild(inp);
    box.appendChild(lab);
  }
}

($('rule') as HTMLSelectElement).addEventListener('change', () => {
  $('ruleDesc').textContent = RULE_DESC[ruleSel()] ?? '';
  renderPrefixCfg();
});
// Ask the host for the current (linter-shared) prefixes on load.
vscodeApi.postMessage({ type: 'getPrefixes' });

wireListButton(vscodeApi);
$('scanBtn').addEventListener('click', () => {
  setLoading(true);
  vscodeApi.postMessage({ type: 'scan', ruleKind: ruleSel(), selected: selectedProcesses() });
});

// The findings currently rendered — the source for "Apply all".
let currentGroups: Group[] = [];

$('applyAllBtn').addEventListener('click', () => {
  const targets: { groupKey: string; target: string }[] = [];
  for (const g of currentGroups) {
    const inp = document.querySelector<HTMLInputElement>(`input.target[data-key="${CSS.escape(g.key)}"]`);
    const target = resolveTarget(g, g.editableTarget ? inp?.value : undefined);
    if (!IDENT.test(target)) { $('unreadable').textContent = fmt(L, 'invalidTarget', target); return; }
    targets.push({ groupKey: g.key, target });
  }
  if (!targets.length) { return; }
  vscodeApi.postMessage({ type: 'applyAll', ruleKind: ruleSel(), selected: selectedProcesses(), targets });
});

/** Reads the current value of a group's editable target input, if any. */
function inputValueFor(g: Group, targetInput: HTMLInputElement | null): string | undefined {
  return g.editableTarget ? targetInput?.value : undefined;
}

function renderGroups(groups: Group[], unreadable: string[]): void {
  currentGroups = groups;
  $('unreadable').textContent = unreadable.length ? fmt(L, 'unreadableLabel', unreadable.join(', ')) : '';
  const container = $('groups');
  container.textContent = '';

  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'results-empty';
    empty.textContent = L.noGroups;
    container.appendChild(empty);
    return;
  }

  groups.forEach((g, i) => {
    const div = document.createElement('div');
    div.className = 'group';
    div.id = `grp-${i}`;
    div.dataset.key = g.key;

    const head = document.createElement('div');
    head.className = 'group-head';

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = g.kind;
    head.appendChild(badge);

    // Show the actual spelled variants (e.g. "DatasourceCubeView,
    // DataSourceCubeView"), not the lowercase match key — clearer at a glance.
    // g.key stays the internal match key for messages/dataset below.
    const names = document.createElement('span');
    names.className = 'names';
    names.textContent = g.variants.map(v => v.spelling).join(', ');
    head.appendChild(names);

    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '→';
    head.appendChild(arrow);

    // Target carrier for EVERY group: editable rules (var-casing,
    // naming-convention) get a live-editable input seeded with the canonical
    // suggestion; non-editable rules (function-casing, keyword-casing) get a
    // plain label — there is deliberately no input to read back for those, so
    // `resolveTarget` always returns `g.targetSuggestion` in that case.
    let targetInput: HTMLInputElement | null = null;
    if (g.editableTarget) {
      targetInput = document.createElement('input');
      targetInput.className = 'target';
      targetInput.dataset.key = g.key;
      targetInput.value = g.targetSuggestion;
      head.appendChild(targetInput);
    } else {
      const b = document.createElement('b');
      b.textContent = g.targetSuggestion;
      head.appendChild(b);
    }

    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    head.appendChild(spacer);

    const prevBtn = document.createElement('button');
    prevBtn.className = 'prevBtn secondary';
    prevBtn.textContent = L.previewBtn;
    prevBtn.addEventListener('click', () => {
      const target = resolveTarget(g, inputValueFor(g, targetInput));
      vscodeApi.postMessage({ type: 'preview', ruleKind: ruleSel(), groupKey: g.key, target, selected: selectedProcesses() });
    });
    head.appendChild(prevBtn);

    const applyBtn = document.createElement('button');
    applyBtn.className = 'applyBtn';
    applyBtn.textContent = L.applyBtn;
    applyBtn.addEventListener('click', () => {
      const target = resolveTarget(g, inputValueFor(g, targetInput));
      if (!IDENT.test(target)) { $('unreadable').textContent = fmt(L, 'invalidTarget', target); return; }
      vscodeApi.postMessage({ type: 'applyGroup', ruleKind: ruleSel(), groupKey: g.key, target, selected: selectedProcesses() });
    });
    head.appendChild(applyBtn);

    div.appendChild(head);

    const variants = document.createElement('div');
    variants.className = 'variants';
    for (const v of g.variants) {
      const vDiv = document.createElement('div');
      vDiv.className = 'variant';
      const sp = document.createElement('span');
      sp.className = 'sp';
      sp.textContent = v.spelling;
      vDiv.appendChild(sp);
      const cnt = document.createElement('span');
      cnt.className = 'cnt';
      cnt.textContent = `×${v.count}`;
      vDiv.appendChild(cnt);

      // One clickable chip PER PROCESS (grouped), not one per occurrence —
      // otherwise a variant used many times sprawls off-screen to the right.
      // The chip jumps to the first occurrence in that process.
      const byProc = new Map<string, Occ[]>();
      for (const o of v.occurrences) {
        const arr = byProc.get(o.process);
        if (arr) { arr.push(o); } else { byProc.set(o.process, [o]); }
      }
      for (const [proc, occs] of byProc) {
        const first = occs[0];
        const chip = document.createElement('span');
        chip.className = 'occ';
        chip.textContent = occs.length > 1 ? `${proc} (${occs.length})` : `${proc}:${first.line}`;
        chip.addEventListener('click', () => {
          vscodeApi.postMessage({ type: 'open', objectName: first.process, unit: first.unit, line: first.line });
        });
        vDiv.appendChild(chip);
      }
      variants.appendChild(vDiv);
    }
    div.appendChild(variants);

    container.appendChild(div);
  });
}

window.addEventListener('message', (ev: MessageEvent) => {
  const m = ev.data as HostToWebview;
  setLoading(false); // any reply means the in-flight list/scan finished
  if (m.type === 'prefixes') { prefixes = m.prefixes || {}; renderPrefixCfg(); }
  else if (m.type === 'processList') { renderProcessList(m.names, L); }
  else if (m.type === 'groups') { renderGroups(m.groups, m.unreadable); }
  else if (m.type === 'previewResult') {
    const el = document.querySelector(`.group[data-key="${CSS.escape(m.groupKey)}"]`);
    if (el) {
      upsertPlanNote(el, m.plan, L);
    }
  }
  else if (m.type === 'report') {
    showReport(m.report, L);
    vscodeApi.postMessage({ type: 'scan', ruleKind: ruleSel(), selected: selectedProcesses() });
  }
});
