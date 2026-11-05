// Shared scaffolding of the two "scan processes, review groups, apply" webviews
// (tiConsistency, tiValueNaming): the filtered process checklist with its count,
// the loading bar, the list button, the preview note and the apply-report line.
// Both panels render the same element ids (#procList, #procCount, #loadingBar,
// #listBtn, #prefix/#suffix/#contains, #controlObjects).

import { fmt, type L10nMap } from './l10n';

interface PostApi { postMessage(m: unknown): void; }

function allProcessCheckboxes(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('#procList input.p'));
}

export function selectedProcesses(): string[] {
  return allProcessCheckboxes().filter(c => c.checked).map(c => c.value);
}

function updateCount(L: L10nMap): void {
  const all = allProcessCheckboxes();
  (document.getElementById('procCount') as HTMLElement).textContent = all.length
    ? fmt(L, 'countLabel', String(all.filter(c => c.checked).length), String(all.length))
    : '';
}

// Comma-separated → trimmed term list (matches Find/Replace's multi-value filter).
function splitList(v: string): string[] {
  return v.split(',').map(s => s.trim()).filter(s => s !== '');
}

// Indeterminate progress bar — fetching all process sources over one REST call
// can take a while on large systems (300+ processes). Shown while a list/scan
// request is in flight; cleared as soon as any reply lands (see message handler).
export function setLoading(on: boolean): void {
  const bar = document.getElementById('loadingBar');
  if (bar) { bar.hidden = !on; }
}

/** Wires #listBtn: posts `listProcesses` with the prefix/suffix/contains filter. */
export function wireListButton(api: PostApi): void {
  const val = (id: string): string => (document.getElementById(id) as HTMLInputElement).value;
  (document.getElementById('listBtn') as HTMLElement).addEventListener('click', () => {
    setLoading(true);
    api.postMessage({ type: 'listProcesses', filter: { prefix: splitList(val('prefix')), suffix: splitList(val('suffix')), contains: splitList(val('contains')), includeControl: (document.getElementById('controlObjects') as HTMLInputElement).checked } });
  });
}

export function renderProcessList(names: string[], L: L10nMap): void {
  const container = document.getElementById('procList') as HTMLElement;
  container.textContent = '';

  const allLabel = document.createElement('label');
  const selAll = document.createElement('input');
  selAll.type = 'checkbox';
  selAll.id = 'selAll';
  selAll.checked = true;
  allLabel.appendChild(selAll);
  allLabel.appendChild(document.createTextNode(' ' + L.allLabel));
  container.appendChild(allLabel);

  for (const n of names) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'p';
    cb.value = n; // DOM property assignment — no attribute-string injection.
    cb.checked = true;
    cb.addEventListener('change', () => updateCount(L));
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + n));
    container.appendChild(label);
  }

  selAll.addEventListener('change', () => {
    allProcessCheckboxes().forEach(c => { c.checked = selAll.checked; });
    updateCount(L);
  });
  updateCount(L);
}

type Plan = { edits: { process: string }[]; skipped: { process: string; reason: string }[] };

/** Writes a preview plan as a note into a container, REUSING an existing
 *  direct-child note instead of appending a fresh one — repeated Preview clicks
 *  update the single line rather than stacking a new line each time. */
export function upsertPlanNote(container: Element, plan: Plan, L: L10nMap): void {
  const edits = plan.edits.map(e => e.process).join(', ') || L.noneLabel;
  const skip = plan.skipped.map(s => `${s.process}: ${s.reason}`).join('; ');
  let note = container.querySelector(':scope > .note, :scope > .collision') as HTMLElement | null;
  if (!note) { note = document.createElement('div'); container.appendChild(note); }
  note.className = skip ? 'collision' : 'note';
  note.textContent = fmt(L, 'previewEditsLabel', edits) + (skip ? ' | ' + fmt(L, 'skippedSuffix', skip) : '');
}

type Report = { applied: string[]; failed?: { process: string; error: string }; skipped?: { process: string }[] };

/** Renders an apply report into the persistent #status div, NOT #groups — the
 *  caller re-scans afterwards, and renderGroups clears #groups before
 *  re-rendering, which would erase a banner placed inside it. */
export function showReport(r: Report, L: L10nMap): void {
  (document.getElementById('status') as HTMLElement).textContent = fmt(L, 'appliedLabel', r.applied.join(', ') || L.noneLabel) +
    (r.failed ? ' | ' + fmt(L, 'failedSuffix', r.failed.process, r.failed.error) : '') +
    (r.skipped && r.skipped.length ? ' | ' + fmt(L, 'skippedSuffix', r.skipped.map(s => s.process).join(', ')) : '');
}
