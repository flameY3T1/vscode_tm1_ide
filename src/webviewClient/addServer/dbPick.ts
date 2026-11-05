// src/webviewClient/addServer/dbPick.ts
// Tick list of the databases a new admin server / gateway entry reports.
// Its own module: it owns its DOM (`#db-*`) and knows nothing of the form
// except the three facts its visibility needs (`initDbPick`).
import { getL10n, fmt } from '../_shared/l10n';
import { computeDbPickVisibility } from './formVisibilityPure';

type DbPickContext = Omit<Parameters<typeof computeDbPickVisibility>[0], 'count'>;

const L = getL10n();
let contextOf: () => DbPickContext = () => ({ addMode: false, adminKind: false, pawKind: false });

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) { throw new Error(`Missing #${id}`); }
  return e;
}

function boxes(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('#db-list input[type=checkbox]'));
}

function unchecked(): string[] {
  return boxes().filter(b => !b.checked).map(b => b.value);
}

/** Ticked names — `undefined` while the list is not on offer. */
export function tickedDatabases(): string[] | undefined {
  return el('db-pick').hidden ? undefined : boxes().filter(b => b.checked).map(b => b.value);
}

/** Names to store as `hidden` — `undefined` while the list is not on offer. */
export function hiddenDatabases(): string[] | undefined {
  return el('db-pick').hidden ? undefined : unchecked();
}

/** Database area after a list change or a tick — on its own, without the
 *  form's `syncForm`, which would reset the test gate a probe just set. */
export function syncDbPick(): void {
  const all = boxes();
  const v = computeDbPickVisibility({ ...contextOf(), count: all.length });
  el('db-pick').hidden = !v.pick;
  el('db-list').hidden = !v.list;
  el('db-pick-bulk').hidden = !v.list;
  el('db-load-row').hidden = !v.loadRow;
  el('db-pick-title').textContent = fmt(L, 'dbPickTitle', String(all.filter(b => b.checked).length), String(all.length));
}

/** All ticked by default — the old behaviour was "everything". A second
 *  list (Test after detection) keeps what the user unticked. */
export function renderDatabases(dbs: { name: string; acceptingClients: boolean }[]): void {
  const keepOff = new Set(unchecked());
  const list = el('db-list');
  list.innerHTML = '';
  for (const db of dbs) {
    const row = document.createElement('label');
    row.className = 'db-row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !keepOff.has(db.name);
    box.value = db.name;
    box.addEventListener('change', () => { syncDbPick(); onTicked(); });
    const name = document.createElement('span');
    name.textContent = db.name;
    row.appendChild(box);
    row.appendChild(name);
    if (!db.acceptingClients) {
      const off = document.createElement('span');
      off.className = 'db-off';
      off.textContent = L.dbNotRunning;
      row.appendChild(off);
    }
    list.appendChild(row);
  }
  if (wanted !== undefined && dbs.some(d => d.name === wanted)) { tickOnly(wanted); return; }
  syncDbPick();
}

/** The list belongs to the address it came from. */
export function clearDatabases(): void {
  wanted = undefined;
  el('db-list').innerHTML = '';
  syncDbPick();
}

/** Database named by a pasted instance URL that the current list does not
 *  show yet (a protected list arrives only after login). */
let wanted: string | undefined;

/** A pasted instance URL names the one database meant; the rest stays unticked. */
export function tickOnly(name: string): void {
  const all = boxes();
  if (!all.some(b => b.value === name)) { wanted = name; return; }
  wanted = undefined;
  all.forEach(b => { b.checked = b.value === name; });
  syncDbPick();
}

/** The user changed the ticks: with one database the form tests and saves that
 *  instance, with several the gateway — so the test gate starts over. */
let onTicked: () => void = () => {};

export function initDbPick(context: () => DbPickContext, ticked: () => void): void {
  contextOf = context;
  onTicked = ticked;
  const setAll = (on: boolean) => (): void => { boxes().forEach(b => { b.checked = on; }); syncDbPick(); onTicked(); };
  el('btn-db-all').addEventListener('click', setAll(true));
  el('btn-db-none').addEventListener('click', setAll(false));
}
