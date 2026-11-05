export {};
import { getVsCodeApi } from '../_shared/vscodeApi';
import type { HostToWebview, WebviewToHost } from '../../tiValueNaming/protocol';
import { getL10n, fmt } from '../_shared/l10n';
import { groupByProcess } from './pure';
import { selectedProcesses, setLoading, wireListButton, renderProcessList, upsertPlanNote, showReport } from '../_shared/processPickerPanel';

const vscodeApi = getVsCodeApi<WebviewToHost>();
const L = getL10n();

// Mirrors ValueName from src/tiValueNaming/types.ts — occurrences carry the
// section (`unit`) + section-relative line, same shape as tiConsistency's Occ,
// so the process editor reveal can jump to the exact site.
type UnitKey = 'prolog' | 'metadata' | 'data' | 'epilog';
type Occ = { process: string; unit: UnitKey; line: number };
type ValueName = { name: string; count: number; occurrences: Occ[] };
type ValueGroup = { valueKey: string; valueSample: string; canonicalSuggestion: string; names: ValueName[] };

// Mirrors src/tiLiveRange/types.ts DefView/MultiValueVar — per-def split/refuse
// view for a variable assigned >= 2 distinct string-literal values.
type DefView = { defId: number; unit: UnitKey; line: number; value?: string; binding: string; splittable: boolean; refused?: string };
type MultiValueVar = { process: string; varName: string; varLc: string; defs: DefView[] };

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const IDENT = /^[A-Za-z_]\w*$/;

// Per-server exclude list (variable-name globs). The host (globalState) is the
// authority: add/remove POST the full candidate list and re-render only from the
// echoed `excludes` message. Entries render via textContent — never innerHTML.
let currentExcludes: string[] = [];
// Preview staleness guard: every fresh scan bumps previewGen; a preview reply
// is only rendered if the list hasn't been re-scanned since the request went out.
let previewGen = 0;
let lastPreviewSentGen = -1;

function renderExcludes(entries: string[]): void {
  currentExcludes = entries;
  const box = $('excludeChips');
  box.textContent = '';
  for (const e of entries) {
    const chip = document.createElement('span');
    chip.className = 'exclude-chip';
    const label = document.createElement('span');
    label.textContent = e;
    chip.appendChild(label);
    const rm = document.createElement('span');
    rm.className = 'rm';
    rm.textContent = '×'; // ×
    rm.title = L.removeLabel ?? 'Remove';
    rm.addEventListener('click', () => {
      vscodeApi.postMessage({ type: 'setExcludes', entries: currentExcludes.filter(x => x !== e) });
    });
    chip.appendChild(rm);
    box.appendChild(chip);
  }
}

function addExclude(): void {
  const input = $('excludeInput') as HTMLInputElement;
  const v = input.value.trim();
  if (!v) { return; }
  // Skip a case-insensitive duplicate; otherwise append and let the host echo re-render.
  if (currentExcludes.some(x => x.toLowerCase() === v.toLowerCase())) { input.value = ''; return; }
  vscodeApi.postMessage({ type: 'setExcludes', entries: [...currentExcludes, v] });
  input.value = '';
}

$('excludeAddBtn').addEventListener('click', addExclude);
$('excludeInput').addEventListener('keydown', (ev: KeyboardEvent) => {
  if (ev.key === 'Enter') { ev.preventDefault(); addExclude(); }
});

wireListButton(vscodeApi);
$('scanBtn').addEventListener('click', () => {
  setLoading(true);
  vscodeApi.postMessage({ type: 'scan', selected: selectedProcesses() });
});
vscodeApi.postMessage({ type: 'getExcludes' });

// Tab switching — pure client-side DOM toggle, no postMessage. Each .tab
// button carries data-panel = the id of the .tab-panel it reveals.
function activateTab(panelId: string): void {
  document.querySelectorAll<HTMLElement>('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.panel === panelId);
  });
  document.querySelectorAll<HTMLElement>('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === panelId);
  });
}
document.querySelectorAll<HTMLElement>('.tab').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.panel ?? 'groups'));
});

// The findings currently rendered — the source for "Apply all".
let currentGroups: ValueGroup[] = [];

/** Reads a value group's canonical-name input; empty/missing falls back to
 *  the server-suggested canonical (there is no non-editable case here — every
 *  value group's target is always user-adjustable, unlike tiConsistency's
 *  function/keyword-casing rules). */
function resolveCanonical(g: ValueGroup, inputValue?: string): string {
  return inputValue !== undefined && inputValue.trim() !== '' ? inputValue : g.canonicalSuggestion;
}

/** Names the user still wants folded into the canonical for a group's DOM node.
 *  Each name carries a per-name checkbox (default checked); unchecking keeps that
 *  variable's name as-is (e.g. sSource vs sTarget that legitimately share a value). */
function checkedNames(groupEl: Element): string[] {
  return Array.from(groupEl.querySelectorAll<HTMLInputElement>('input.nm-cb:checked')).map(c => c.value);
}

$('applyAllBtn').addEventListener('click', () => {
  const targets: { valueKey: string; canonical: string; names?: string[] }[] = [];
  for (const g of currentGroups) {
    const groupEl = document.querySelector(`.group[data-key="${CSS.escape(g.valueKey)}"]`);
    const inp = groupEl?.querySelector<HTMLInputElement>('input.target');
    const canonical = resolveCanonical(g, inp?.value);
    if (!IDENT.test(canonical)) { $('unreadable').textContent = fmt(L, 'invalidTarget', canonical); return; }
    targets.push({ valueKey: g.valueKey, canonical, names: groupEl ? checkedNames(groupEl) : undefined });
  }
  if (!targets.length) { return; }
  vscodeApi.postMessage({ type: 'applyAll', selected: selectedProcesses(), targets });
});

/** Opens an occurrence in the process editor at its exact section + line. */
function openOccurrence(o: Occ): void {
  vscodeApi.postMessage({ type: 'open', objectName: o.process, unit: o.unit, line: o.line });
}

function renderGroups(groups: ValueGroup[], unreadable: string[]): void {
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
    div.dataset.key = g.valueKey;

    const head = document.createElement('div');
    head.className = 'group-head';

    const code = document.createElement('code');
    code.textContent = g.valueSample;
    code.setAttribute('aria-label', L.valueLabel);
    head.appendChild(code);

    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '→';
    head.appendChild(arrow);

    const targetInput = document.createElement('input');
    targetInput.className = 'target';
    targetInput.dataset.key = g.valueKey;
    targetInput.value = g.canonicalSuggestion;
    head.appendChild(targetInput);

    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    head.appendChild(spacer);

    const prevBtn = document.createElement('button');
    prevBtn.className = 'prevBtn secondary';
    prevBtn.textContent = L.previewBtn;
    prevBtn.addEventListener('click', () => {
      const canonical = resolveCanonical(g, targetInput.value);
      lastPreviewSentGen = previewGen;
      vscodeApi.postMessage({ type: 'preview', valueKey: g.valueKey, canonical, selected: selectedProcesses(), names: checkedNames(div) });
    });
    head.appendChild(prevBtn);

    const applyBtn = document.createElement('button');
    applyBtn.className = 'applyBtn';
    applyBtn.textContent = L.applyBtn;
    applyBtn.addEventListener('click', () => {
      const canonical = resolveCanonical(g, targetInput.value);
      if (!IDENT.test(canonical)) { $('unreadable').textContent = fmt(L, 'invalidTarget', canonical); return; }
      vscodeApi.postMessage({ type: 'applyGroup', valueKey: g.valueKey, canonical, selected: selectedProcesses(), names: checkedNames(div) });
    });
    head.appendChild(applyBtn);

    div.appendChild(head);

    // Which group-names each process carries this value under. Used to flag
    // merge/collision sites dynamically (recomputeMarks) as the user toggles
    // name checkboxes or edits the canonical target.
    const namesByProc = new Map<string, Set<string>>();
    for (const n of g.names) {
      for (const o of n.occurrences) {
        let s = namesByProc.get(o.process);
        if (!s) { s = new Set(); namesByProc.set(o.process, s); }
        s.add(n.name);
      }
    }

    // A process is skipped (its chips flagged) when folding the CURRENTLY checked
    // names into the canonical would collapse >= 2 variables in it (merge) or the
    // canonical name already lives there (collision) — mirrors planNameUnify's
    // per-process skip. Re-runs on every checkbox / target-input change so the
    // ⚠ marker tracks the live selection instead of the initial scan.
    const recomputeMarks = (): void => {
      const canonLc = resolveCanonical(g, targetInput.value).toLowerCase();
      const checked = new Set(checkedNames(div).map(s => s.toLowerCase()));
      const skip = new Set<string>();
      for (const [proc, procNames] of namesByProc) {
        let candidates = 0;
        let canonicalHere = false;
        for (const nm of procNames) {
          const lc = nm.toLowerCase();
          if (lc === canonLc) { canonicalHere = true; continue; }
          if (checked.has(lc)) { candidates += 1; }
        }
        if (candidates === 0) { continue; } // nothing to rename here
        if (canonicalHere || candidates >= 2) { skip.add(proc); }
      }
      div.querySelectorAll<HTMLElement>('.occ').forEach(chip => {
        const dup = skip.has(chip.dataset.proc ?? '');
        chip.classList.toggle('occ-dup', dup);
        if (dup) { chip.title = L.dupHint; } else { chip.removeAttribute('title'); }
      });
    };

    const namesDiv = document.createElement('div');
    namesDiv.className = 'names';
    for (const n of g.names) {
      const row = document.createElement('div');
      row.className = 'name-row';

      const label = document.createElement('label');
      label.className = 'nm-label';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'nm-cb';
      cb.value = n.name; // DOM property — planNameUnify lowercases for matching.
      cb.checked = true; // default: fold all (unchanged behaviour); uncheck keeps the name.
      cb.addEventListener('change', recomputeMarks);
      label.appendChild(cb);

      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = n.name;
      label.appendChild(nm);

      const cnt = document.createElement('span');
      cnt.className = 'cnt';
      cnt.textContent = ` (${n.count})`;
      label.appendChild(cnt);
      row.appendChild(label);

      for (const o of n.occurrences) {
        const chip = document.createElement('span');
        chip.className = 'occ';
        chip.dataset.proc = o.process;
        chip.textContent = `${o.process}:${o.line}`;
        chip.addEventListener('click', () => openOccurrence(o));
        row.appendChild(chip);
      }
      namesDiv.appendChild(row);
    }
    div.appendChild(namesDiv);
    targetInput.addEventListener('input', recomputeMarks);
    recomputeMarks(); // initial marks (all names checked)

    container.appendChild(div);
  });
}

/** Localizes a `DefView.binding` kind to the matching L10n label. */
function bindingLabel(binding: string): string {
  switch (binding) {
    case 'literal': return L.bindingLiteral;
    case 'numeric': return L.bindingNumeric;
    case 'param': return L.bindingParam;
    case 'datasource': return L.bindingDatasource;
    case 'dynamic': return L.bindingDynamic;
    default: return binding;
  }
}

/** Localizes a `DefView.refused` reason; unknown reasons fall back to the raw string. */
function refusedLabel(refused: string): string {
  if (refused === 'merge') { return L.refusedMerge; }
  if (refused === 'collision') { return L.refusedCollision; }
  if (refused === 'ambiguous') { return L.refusedAmbiguous; }
  return refused;
}

/**
 * Renders the "Multi-value variables" section: one `.mv-var` block per
 * variable, one `.def-row` per def (write site). `groups` supplies the
 * Phase-1 canonical-name suggestion for the def's value (if any), used as
 * the split target input's default so the two features stay in sync.
 */
function renderMultiValue(list: MultiValueVar[], groups: ValueGroup[]): void {
  const canonicalByValue = new Map<string, string>();
  for (const g of groups) { canonicalByValue.set(g.valueKey, g.canonicalSuggestion); }

  const container = $('multiValue');
  container.textContent = '';

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'results-empty';
    empty.textContent = L.noGroups;
    container.appendChild(empty);
    return;
  }

  for (const grp of groupByProcess(list)) {
    const procDiv = document.createElement('div');
    procDiv.className = 'mv-proc';

    const procHead = document.createElement('div');
    procHead.className = 'mv-proc-head';
    procHead.textContent = grp.process;
    procDiv.appendChild(procHead);

    for (const mv of grp.vars) {
      const varDiv = document.createElement('div');
      varDiv.className = 'mv-var';

      const name = document.createElement('span');
      name.className = 'mv-name';
      name.textContent = mv.varName;
      varDiv.appendChild(name);

      for (const def of mv.defs) {
        const row = document.createElement('div');
        row.className = 'def-row';
        row.dataset.row = `${mv.process}:${mv.varLc}:${def.defId}`;
        if (!def.splittable && !def.refused) { row.classList.add('def-nonliteral'); }

        const lineSpan = document.createElement('span');
        lineSpan.className = 'occ';
        lineSpan.textContent = fmt(L, 'defLineLabel', String(def.line));
        lineSpan.addEventListener('click', () => {
          vscodeApi.postMessage({ type: 'open', objectName: mv.process, unit: def.unit, line: def.line });
        });
        row.appendChild(lineSpan);

        if (def.value !== undefined) {
          const valSpan = document.createElement('code');
          valSpan.className = 'def-val';
          valSpan.textContent = def.value;
          row.appendChild(valSpan);
        }

        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = bindingLabel(def.binding);
        row.appendChild(badge);

        if (def.splittable) {
          const targetInput = document.createElement('input');
          targetInput.className = 'target';
          targetInput.value = canonicalByValue.get(def.value?.toLowerCase() ?? '') ?? mv.varName;
          row.appendChild(targetInput);

          const prevBtn = document.createElement('button');
          prevBtn.className = 'prevBtn secondary';
          prevBtn.textContent = L.previewBtn;
          prevBtn.addEventListener('click', () => {
            lastPreviewSentGen = previewGen;
            vscodeApi.postMessage({
              type: 'previewSplit', process: mv.process, varLc: mv.varLc, defId: def.defId, newName: targetInput.value,
            });
          });
          row.appendChild(prevBtn);

          const splitBtn = document.createElement('button');
          splitBtn.className = 'applyBtn';
          splitBtn.textContent = L.splitBtn;
          splitBtn.addEventListener('click', () => {
            const newName = targetInput.value;
            if (!IDENT.test(newName)) { $('unreadable').textContent = fmt(L, 'invalidTarget', newName); return; }
            vscodeApi.postMessage({ type: 'applySplit', process: mv.process, varLc: mv.varLc, defId: def.defId, newName });
          });
          row.appendChild(splitBtn);
        } else if (def.refused) {
          const refusedSpan = document.createElement('span');
          refusedSpan.className = 'refused';
          refusedSpan.textContent = refusedLabel(def.refused);
          row.appendChild(refusedSpan);
        }

        varDiv.appendChild(row);
      }

      procDiv.appendChild(varDiv);
    }

    container.appendChild(procDiv);
  }
}

window.addEventListener('message', (ev: MessageEvent) => {
  const m = ev.data as HostToWebview;
  setLoading(false); // any reply means the in-flight list/scan finished
  if (m.type === 'processList') { renderProcessList(m.names, L); }
  else if (m.type === 'groups') {
    previewGen++; // a fresh scan rebuilt the list — drop any in-flight preview reply
    renderGroups(m.groups, m.unreadable);
    renderMultiValue(m.multiValue, m.groups);
    $('cntGroups').textContent = `(${m.groups.length})`;
    $('cntMulti').textContent = `(${m.multiValue.length})`;
  }
  else if (m.type === 'splitPreview') {
    if (lastPreviewSentGen !== previewGen) { return; } // stale: list re-scanned since the request
    const row = document.querySelector(`[data-row="${CSS.escape(`${m.process}:${m.varLc}:${m.defId}`)}"]`);
    if (row) {
      upsertPlanNote(row, m.plan, L);
    }
  }
  else if (m.type === 'previewResult') {
    if (lastPreviewSentGen !== previewGen) { return; } // stale: list re-scanned since the request
    const el = document.querySelector(`.group[data-key="${CSS.escape(m.valueKey)}"]`);
    if (el) {
      upsertPlanNote(el, m.plan, L);
    }
  }
  else if (m.type === 'report') {
    showReport(m.report, L);
    vscodeApi.postMessage({ type: 'scan', selected: selectedProcesses() });
  }
  else if (m.type === 'excludes') { renderExcludes(m.entries); }
});
