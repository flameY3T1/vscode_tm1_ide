// src/webviewClient/serverConfigEditor/index.ts
// Bundle of the server configuration editor. Until 2026-10 this was an inline
// script in the host's template literal, invisible to tsc and eslint.
import type { ConfigRowView, ServerConfigBootstrap, ServerConfigState, WebviewToHost } from './protocol';
import { escapeHtml as esc } from '../htmlUtils';
import { getVsCodeApi } from '../_shared/vscodeApi';

const vscode = getVsCodeApi<WebviewToHost, ServerConfigState>();
const { rows: ROWS, original: ORIGINAL, clusters: CLUSTERS, initialCluster, texts: L } =
  (window as unknown as { __serverConfig: ServerConfigBootstrap }).__serverConfig;

const edited = new Map<string, unknown>(Object.entries(ORIGINAL));
// Saving and reloading rebuild the whole page. Without a remembered tab the
// form jumps back to the first one — the state therefore lives in the
// webview storage, which survives the replacement of the HTML.
const SAVED = vscode.getState() || {};
let activeCluster = SAVED.cluster && CLUSTERS.includes(SAVED.cluster) ? SAVED.cluster : initialCluster;
document.querySelectorAll('#tabs button').forEach((b) => {
  b.classList.toggle('active', b.getAttribute('data-cluster') === activeCluster);
});
const filter = { search: '', dirty: false, nondef: false };

const byId = <E extends HTMLElement = HTMLElement>(id: string): E => document.getElementById(id) as E;

// Deep-equal: primitives via Object.is, arrays/objects via JSON.stringify.
// Mirrors valuesEqual on host side so dirty-state agrees across postMessage clones.
function eq(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

function dirtyCount(): number {
  let n = 0;
  for (const [k, v] of edited) {
    if (!eq(ORIGINAL[k], v)) n++;
  }
  return n;
}

function updateSaveBtn(): void {
  byId<HTMLButtonElement>('save').disabled = dirtyCount() === 0;
}

function row(r: ConfigRowView): string {
  const cur = edited.get(r.name);
  const dirty = !eq(ORIGINAL[r.name], cur);
  // Three states: READONLY (cannot change), STATIC (cfg edit needs server restart to
  // take effect — i.e. tm1.cfg-only param), DYNAMIC (cfg edit takes effect on next
  // /StaticConfiguration PATCH without restart).
  // A fourth state sits above those: the server's config tree has no leaf for this param
  // at all (most of the schema on v12), so there is nothing to write and nothing to restart.
  const badge = r.unavailable ? 'N/A' : (r.readonly ? 'READONLY' : (r.requiresRestart ? 'STATIC' : 'DYNAMIC'));
  const safeName = esc(r.name);
  const safeCur = cur === undefined ? '' : esc(cur);

  // Name cell: nested keys split into parent path + leaf
  let nameHtml: string;
  const lastDot = r.name.lastIndexOf('.');
  if (lastDot > 0) {
    const parent = esc(r.name.slice(0, lastDot));
    const leaf = esc(r.name.slice(lastDot + 1));
    nameHtml = '<span class="name-parent">' + parent + '.</span><span class="name">' + leaf + '</span>';
  } else {
    nameHtml = '<span class="name">' + safeName + '</span>';
  }

  let editor: string;
  if (r.unavailable) {
    editor = '<span class="ro-value na-value" title="' + esc(L.notOnThisServer) + '">' + (safeCur || '—') + '</span>';
  } else if (r.readonly) {
    editor = '<span class="ro-value">' + safeCur + '</span>';
  } else if (r.type === 'bool') {
    const isOn = (cur === true || String(cur) === 'true');
    const checked = isOn ? ' checked' : '';
    editor = '<label class="bool-toggle"><input type="checkbox" data-name="' + safeName + '"' + checked + '/><span class="bool-state">' + esc(isOn ? L.enabled : L.disabled) + '</span></label>';
  } else if (r.type === 'enum' && Array.isArray(r.enumValues) && r.enumValues.length > 0) {
    // A value the schema does not list would otherwise show as the FIRST option
    // — a silently wrong reading, not a visible gap. Carry it as its own option.
    const vals = (cur === undefined || cur === null || String(cur) === '' || r.enumValues.some((v) => String(v) === String(cur)))
      ? r.enumValues : r.enumValues.concat([String(cur)]);
    const opts = vals.map((v) => {
      const sv = esc(v);
      const sel = String(cur) === String(v) ? ' selected' : '';
      return '<option value="' + sv + '"' + sel + '>' + sv + '</option>';
    }).join('');
    editor = '<select data-name="' + safeName + '">' + opts + '</select>';
  } else {
    const inputType = r.type === 'number' ? 'number' : 'text';
    editor = '<input type="' + inputType + '" data-name="' + safeName + '" value="' + safeCur + '"/>';
  }
  return '<div class="row' + (dirty ? ' dirty' : '') + '">'
    + '<div class="name-cell">' + nameHtml + '<div class="desc">' + esc(r.description) + '</div></div>'
    + '<div>' + editor + '</div>'
    + '<div><span class="badge ' + badge + '">' + badge + '</span></div>'
    + '</div>';
}

function visibleRows(): ConfigRowView[] {
  return ROWS.filter((r) => {
    if (r.cluster !== activeCluster) return false;
    if (filter.dirty && eq(ORIGINAL[r.name], edited.get(r.name))) return false;
    if (filter.nondef && (r.defaultValue === undefined || eq(edited.get(r.name), r.defaultValue))) return false;
    if (filter.search) {
      const t = filter.search.toLowerCase();
      if (!(r.name + ' ' + r.description).toLowerCase().includes(t)) return false;
    }
    return true;
  });
}

const editedObject = (): Record<string, unknown> => Object.fromEntries(edited);

function renderRaw(): string {
  return '<div class="raw"><textarea id="raw">' + esc(JSON.stringify(editedObject(), null, 2)) + '</textarea></div>';
}

function bindRowEditors(): void {
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('main input[data-name],main select[data-name]').forEach((el) => {
    const isTextInput = el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'number');
    el.addEventListener(isTextInput ? 'input' : 'change', () => {
      const name = el.getAttribute('data-name') ?? '';
      const isCheckbox = el instanceof HTMLInputElement && el.type === 'checkbox';
      const v = isCheckbox ? el.checked : el.value;
      edited.set(name, v);
      updateSaveBtn();
      el.closest('.row')?.classList.toggle('dirty', !eq(ORIGINAL[name], v));
      // Live-update the bool toggle's enabled/disabled label.
      if (isCheckbox) {
        const stateLabel = el.parentElement?.querySelector('.bool-state');
        if (stateLabel) { stateLabel.textContent = el.checked ? L.enabled : L.disabled; }
      }
    });
  });
}

function bindRawEditor(): void {
  const raw = document.getElementById('raw');
  if (!raw) return;
  raw.addEventListener('input', (e) => {
    try {
      const parsed: unknown = JSON.parse((e.target as HTMLTextAreaElement).value);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        byId<HTMLButtonElement>('save').disabled = true;
        return;
      }
      edited.clear();
      for (const [k, v] of Object.entries(parsed)) edited.set(k, v);
      updateSaveBtn();
    } catch {
      byId<HTMLButtonElement>('save').disabled = true;
    }
  });
}

function render(): void {
  const main = byId('main');
  if (activeCluster === '__raw__') {
    main.innerHTML = renderRaw();
    bindRawEditor();
  } else {
    main.innerHTML = visibleRows().map(row).join('') || ('<p>' + esc(L.noParams) + '</p>');
    bindRowEditors();
  }
}

byId('tabs').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button[data-cluster]'); if (!btn) return;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  activeCluster = btn.getAttribute('data-cluster') ?? activeCluster;
  vscode.setState({ cluster: activeCluster });
  render();
});
byId('search').addEventListener('input', (e) => { filter.search = (e.target as HTMLInputElement).value; render(); });
byId('dirty').addEventListener('change', (e) => { filter.dirty = (e.target as HTMLInputElement).checked; render(); });
byId('nondef').addEventListener('change', (e) => { filter.nondef = (e.target as HTMLInputElement).checked; render(); });
byId('reload').addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
byId('save').addEventListener('click', () => {
  vscode.postMessage({ type: 'save', original: ORIGINAL, edited: editedObject() });
});
render();
