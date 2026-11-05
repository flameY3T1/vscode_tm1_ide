// src/webviewClient/securityUserGroup/index.ts
import type { HostToWebview, WebviewToHost } from './protocol';
import type { UserType, NewUserInput } from '../../security/types/user';
import {
  validatePassword, validateUserName, validateGroupName,
} from '../../security/core/userValidators';
import {
  initStore, setActiveTab, toggleMembership, revertMemberships,
  computeMembershipChanges, isMembershipDirty, isMember,
  setAlias, displayName, matchesFilter, planCopyGroups, applyCopyGroups, stagedGroups,
  type Store, type TabId,
} from './statePure';
import { getL10n, fmt } from '../_shared/l10n';
import { askConfirm } from '../_shared/confirmDialog';
import { escCloses } from '../_shared/escCloses';
import { escapeHtml } from '../htmlUtils';
import { mountTitleCombo, closeTitleCombo } from '../_shared/filterCombo';
import { getVsCodeApi, type VsCodeApi } from '../_shared/vscodeApi';

const L = getL10n();

type VsApi = VsCodeApi<WebviewToHost>;
const vscode = getVsCodeApi<WebviewToHost>();
// For the column drag script (webviews/columnResize.ts): the API can be acquired only once per webview.
(window as unknown as { tm1VsApi: VsApi }).tm1VsApi = vscode;

let store: Store = initStore([], []);

/**
 * View takeover: only TM1 11 (v12 does not know the header) and never for the
 * logged-in user themselves. Both arrive with `init` and are kept here instead of in
 * the store — they do not change during the lifetime of a panel.
 */
/**
 * After "Copy groups": the changed user and the template stand on top of the
 * memberships matrix, so the result can be read without hunting through every
 * user. Display only — the order of `store.users` is untouched.
 */
let _pinned: { target: string; source: string } | null = null;

/** Filter box text; lives outside the store because it only hides rows. */
let _filter = '';

let _impersonateOk = false;
let _self = '';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

function showStatus(kind: 'ok' | 'error', msg: string): void {
  const s = $('status');
  s.className = `status ${kind}`;
  s.textContent = msg;
}

function clearStatus(): void {
  const s = $('status');
  s.className = 'status';
  s.textContent = '';
}

function renderTabs(): void {
  document.querySelectorAll('.tab-bar .tab').forEach(tab => {
    const id = (tab as HTMLElement).getAttribute('data-tab') ?? '';
    tab.classList.toggle('active', id === store.activeTab);
    if (id === 'memberships') tab.classList.toggle('dirty', isMembershipDirty(store));
  });
}

function renderContent(): void {
  const c = $('tab-content');
  if (store.activeTab === 'users')      c.innerHTML = renderUsersTab();
  else if (store.activeTab === 'groups')      c.innerHTML = renderGroupsTab();
  else if (store.activeTab === 'memberships') c.innerHTML = renderMembershipsTab();
  attachContentHandlers();
  applyFilter();
}

/**
 * Hides rows instead of re-rendering, so the filter box keeps focus and the
 * staged checkbox state in the matrix is untouched. Users match by name or
 * alias, groups by name.
 */
function applyFilter(): void {
  $('tab-content').querySelectorAll<HTMLTableRowElement>('tr[data-user], tr[data-group]').forEach(tr => {
    const user = tr.getAttribute('data-user');
    tr.hidden = !matchesFilter(store, user ?? tr.getAttribute('data-group') ?? '', _filter);
  });
}

function renderUsersTab(): string {
  const rows = store.users.map(u => {
    // `u.disabled` maps to TM1 `IsActive === false` — it is live-session state,
    // not an account flag. Render it as a read-only Active/Inactive status.
    const active = !u.disabled;
    const cls = u.type === 'Admin' ? 'system' : '';
    // The label is display only, `data-user` remains the real name — it is the
    // key the server works with. If the label differs, the title adds
    // the real name.
    const shown = displayName(store, u.name);
    const title = shown === u.name ? '' : ` title="${escapeHtml(u.name)}"`;
    return `<tr class="${cls}" data-user="${escapeHtml(u.name)}">
      <td${title}>${escapeHtml(shown)}</td>
      <td>${escapeHtml(u.type)}</td>
      <td><span class="user-status ${active ? 'active' : 'inactive'}">${escapeHtml(active ? L.statusActive : L.statusInactive)}</span></td>
      <td>${u.groups.length}</td>
      <td>
        <button class="secondary user-pw" data-user="${escapeHtml(u.name)}">${escapeHtml(L.setPwShort)}</button>
        <button class="secondary user-copy-groups" data-user="${escapeHtml(u.name)}">${escapeHtml(L.copyGroupsShort)}</button>
        ${_impersonateOk && u.name.toLowerCase() !== _self.toLowerCase()
          ? `<button class="secondary user-impersonate" data-user="${escapeHtml(u.name)}">${escapeHtml(L.impersonateShort)}</button>`
          : ''}
        <button class="danger user-delete" data-user="${escapeHtml(u.name)}">${escapeHtml(L.delete)}</button>
      </td>
    </tr>`;
  }).join('');
  return `<div class="tab-actions">
    <button id="btn-new-user">${escapeHtml(L.newUserBtn)}</button>
  </div>
  <table class="list-table" data-resizable="users">
    <thead><tr><th>${escapeHtml(L.name)}</th><th>${escapeHtml(L.colType)}</th><th>${escapeHtml(L.colStatus)}</th><th>${escapeHtml(L.colGroupCount)}</th><th>${escapeHtml(L.colActions)}</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5" class="empty-state">${escapeHtml(L.noUsers)}</td></tr>`}</tbody>
  </table>`;
}

function renderGroupsTab(): string {
  const rows = store.groups.map(g => {
    const cls = g.isSystem ? 'system' : '';
    return `<tr class="${cls}" data-group="${escapeHtml(g.name)}">
      <td>${escapeHtml(g.name)}${g.isSystem ? ` <em>${escapeHtml(L.systemSuffix)}</em>` : ''}</td>
      <td>${g.memberCount}</td>
      <td>${g.isSystem ? '' : `<button class="danger group-delete" data-group="${escapeHtml(g.name)}">${escapeHtml(L.delete)}</button>`}</td>
    </tr>`;
  }).join('');
  return `<div class="tab-actions">
    <button id="btn-new-group">${escapeHtml(L.newGroupBtn)}</button>
  </div>
  <table class="list-table" data-resizable="groups">
    <thead><tr><th>${escapeHtml(L.name)}</th><th>${escapeHtml(L.colMembers)}</th><th>${escapeHtml(L.colActions)}</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="3" class="empty-state">${escapeHtml(L.noGroups)}</td></tr>`}</tbody>
  </table>`;
}

function renderMembershipsTab(): string {
  if (store.users.length === 0 || store.groups.length === 0) {
    return `<div class="empty-state">${escapeHtml(L.needUserAndGroup)}</div>`;
  }
  const head = `<thead><tr>
    <th class="row-head">${escapeHtml(L.userGroupHead)}</th>
    ${store.groups.map(g => `<th>${escapeHtml(g.name)}</th>`).join('')}
  </tr></thead>`;
  const pinOrder = _pinned ? [_pinned.target, _pinned.source] : [];
  const users = [
    ...pinOrder.map(n => store.users.find(u => u.name === n)).filter((u): u is typeof store.users[number] => !!u),
    ...store.users.filter(u => !pinOrder.includes(u.name)),
  ];
  const rows = users.map(u => {
    const cells = store.groups.map(g => {
      const checked = isMember(store, u.name, g.name) ? ' checked' : '';
      return `<td><input type="checkbox" data-user="${escapeHtml(u.name)}" data-group="${escapeHtml(g.name)}"${checked}></td>`;
    }).join('');
    const shown = displayName(store, u.name);
    const title = shown === u.name ? '' : ` title="${escapeHtml(u.name)}"`;
    const pin = _pinned?.target === u.name ? L.pinTarget : _pinned?.source === u.name ? L.pinSource : '';
    const tag = pin ? ` <span class="pin-tag">${escapeHtml(pin)}</span>` : '';
    return `<tr${pin ? ' class="pinned"' : ''} data-user="${escapeHtml(u.name)}"><td class="row-head"${title}>${escapeHtml(shown)}${tag}</td>${cells}</tr>`;
  }).join('');
  return `<div class="tab-actions">
    <button id="btn-save-memberships" ${isMembershipDirty(store) ? '' : 'disabled'}>${escapeHtml(L.saveMemberships)}</button>
    <button id="btn-revert-memberships" class="secondary" ${isMembershipDirty(store) ? '' : 'disabled'}>${escapeHtml(L.revert)}</button>
  </div>
  <div class="matrix-wrap">
    <table class="matrix">${head}<tbody>${rows}</tbody></table>
  </div>`;
}

function attachContentHandlers(): void {
  // Tab-specific
  if (store.activeTab === 'users') {
    const newBtn = document.getElementById('btn-new-user');
    if (newBtn) newBtn.addEventListener('click', openNewUserModal);
    document.querySelectorAll('.user-pw').forEach(b => b.addEventListener('click', onUserSetPw));
    document.querySelectorAll('.user-copy-groups').forEach(b => b.addEventListener('click', onCopyGroupsOpen));
    document.querySelectorAll('.user-delete').forEach(b => b.addEventListener('click', ev => { void onUserDelete(ev); }));
    document.querySelectorAll('.user-impersonate').forEach(b => b.addEventListener('click', ev => { void onUserImpersonate(ev); }));
  } else if (store.activeTab === 'groups') {
    const newBtn = document.getElementById('btn-new-group');
    if (newBtn) newBtn.addEventListener('click', openNewGroupModal);
    document.querySelectorAll('.group-delete').forEach(b => b.addEventListener('click', ev => { void onGroupDelete(ev); }));
  } else if (store.activeTab === 'memberships') {
    document.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', onMembershipToggle));
    const saveBtn = document.getElementById('btn-save-memberships');
    if (saveBtn) saveBtn.addEventListener('click', onSaveMemberships);
    const revertBtn = document.getElementById('btn-revert-memberships');
    if (revertBtn) revertBtn.addEventListener('click', onRevertMemberships);
  }
}

function renderDirty(): void {
  $('dirty-badge').classList.toggle('visible', isMembershipDirty(store));
}

function fullRender(): void {
  renderTabs();
  renderContent();
  renderDirty();
}

function onTabClick(ev: Event): void {
  const btn = ev.currentTarget as HTMLElement;
  const tab = (btn.getAttribute('data-tab') ?? 'users') as TabId;
  store = setActiveTab(store, tab);
  fullRender();
  clearStatus();
}

function onMembershipToggle(ev: Event): void {
  const cb = ev.target as HTMLInputElement;
  const user = cb.getAttribute('data-user') ?? '';
  const group = cb.getAttribute('data-group') ?? '';
  store = toggleMembership(store, user, group);
  renderTabs();
  renderDirty();
  ($('btn-save-memberships') as HTMLButtonElement).disabled = !isMembershipDirty(store);
  ($('btn-revert-memberships') as HTMLButtonElement).disabled = !isMembershipDirty(store);
}

function onSaveMemberships(): void {
  const changes = computeMembershipChanges(store);
  if (changes.length === 0) return;
  vscode.postMessage({ type: 'saveMemberships', changes });
  ($('btn-save-memberships') as HTMLButtonElement).disabled = true;
}

function onRevertMemberships(): void {
  _pinned = null;
  store = revertMemberships(store);
  renderTabs();
  renderContent();
  renderDirty();
  clearStatus();
}

// --- Modals ---

function openModal(id: string): void { document.getElementById(id)?.classList.add('visible'); }
function closeModal(id: string): void { closeTitleCombo(); document.getElementById(id)?.classList.remove('visible'); }

/**
 * Yes/no dialog — adapter over `_shared/confirmDialog.ts`.
 *
 * Both call sites (`onUserDelete`, `onGroupDelete`) delete something on the TM1
 * server, hence `danger: true`: focus starts on „Cancel", so a stray Enter can
 * only abort. This replaced the server-rendered `#modal-confirm` markup, which
 * had no `role`/`aria-modal`, no focus trap and no `aria-labelledby` — a screen
 * reader announced neither that a modal had opened nor what it asked.
 *
 * `title` becomes the headline, `message` the detail line — the same split the
 * old `<h3>`/`<p>` markup had.
 *
 * Exported for `src/test/dimEditorConfirmFocus.test.ts`; no runtime importer.
 */
export function confirmModal(title: string, message: string): Promise<boolean> {
  return askConfirm({
    message: title,
    detail: message,
    confirmLabel: L.confirm,
    cancelLabel: L.cancel,
    danger: true,
  });
}

function openNewUserModal(): void {
  // Reset
  ($('nu-name') as HTMLInputElement).value = '';
  ($('nu-password') as HTMLInputElement).value = '';
  ($('nu-type') as HTMLSelectElement).value = 'User';
  $('nu-error').textContent = '';
  // Populate group checkboxes
  const wrap = $('nu-groups');
  wrap.innerHTML = store.groups.map(g => `
    <label><input type="checkbox" value="${escapeHtml(g.name)}"> ${escapeHtml(g.name)}</label>
  `).join('');
  // "Same groups as": the usual way a new account is set up — like a colleague.
  // It only ticks the boxes; they stay editable.
  ($('nu-copy-from') as HTMLSelectElement).innerHTML = `<option value="">${escapeHtml(L.copyFromNone)}</option>`
    + store.users
      .map(u => `<option value="${escapeHtml(u.name)}">${escapeHtml(displayName(store, u.name))}</option>`)
      .join('');
  openModal('modal-new-user');
  ($('nu-name') as HTMLInputElement).focus();
}

function onCreateUserSubmit(): void {
  const name = ($('nu-name') as HTMLInputElement).value.trim();
  const type = ($('nu-type') as HTMLSelectElement).value as UserType;
  const password = ($('nu-password') as HTMLInputElement).value;
  const groups = Array.from($('nu-groups').querySelectorAll('input[type=checkbox]:checked'))
    .map(cb => (cb as HTMLInputElement).value);
  const nameV = validateUserName(name);
  if (!nameV.ok) { $('nu-error').textContent = nameV.reason ?? L.invalidName; return; }
  const pwV = validatePassword(password);
  if (!pwV.ok) { $('nu-error').textContent = pwV.reason ?? L.invalidPassword; return; }
  const input: NewUserInput = { name, type, password, groups };
  vscode.postMessage({ type: 'createUser', input });
  closeModal('modal-new-user');
}

function onUserSetPw(ev: Event): void {
  const btn = ev.currentTarget as HTMLElement;
  const user = btn.getAttribute('data-user') ?? '';
  $('sp-user').textContent = user;
  ($('sp-password') as HTMLInputElement).value = '';
  $('sp-error').textContent = '';
  openModal('modal-set-password');
  ($('sp-password') as HTMLInputElement).focus();
}

function onSetPwApply(): void {
  const user = $('sp-user').textContent ?? '';
  const password = ($('sp-password') as HTMLInputElement).value;
  const v = validatePassword(password);
  if (!v.ok) { $('sp-error').textContent = v.reason ?? L.invalidPassword; return; }
  vscode.postMessage({ type: 'setPassword', userName: user, password });
  closeModal('modal-set-password');
}

// --- Copy groups: "give X the same rights as Y" ---
// Rights hang on groups, so copying the groups is copying the rights. The
// result is only STAGED — it lands in the Memberships matrix and is saved with
// the existing button, so it can be checked and reverted like any hand edit.

let _copyTarget = '';

function copyMode(): 'replace' | 'add' {
  const checked = document.querySelector('input[name="cg-mode"]:checked') as HTMLInputElement | null;
  return checked?.value === 'add' ? 'add' : 'replace';
}

function copyPlan(): { add: string[]; remove: string[] } {
  return planCopyGroups(store, _copyTarget, ($('cg-source') as HTMLSelectElement).value, copyMode());
}

function renderCopyPreview(): void {
  // No other user to copy from: an empty source would read as "no groups" and
  // a replace would strip the target of everything.
  if (($('cg-source') as HTMLSelectElement).value === '') {
    $('cg-preview').textContent = L.copyGroupsNothing;
    ($('cg-apply') as HTMLButtonElement).disabled = true;
    return;
  }
  const plan = copyPlan();
  const lines: string[] = [];
  if (plan.add.length > 0) { lines.push(fmt(L, 'copyGroupsAdds', plan.add.join(', '))); }
  if (plan.remove.length > 0) { lines.push(fmt(L, 'copyGroupsRemoves', plan.remove.join(', '))); }
  $('cg-preview').textContent = lines.length > 0 ? lines.join('\n') : L.copyGroupsNothing;
  ($('cg-apply') as HTMLButtonElement).disabled = lines.length === 0;
}

function onCopyGroupsOpen(ev: Event): void {
  _copyTarget = (ev.currentTarget as HTMLElement).getAttribute('data-user') ?? '';
  $('cg-user').textContent = displayName(store, _copyTarget);
  const select = $('cg-source') as HTMLSelectElement;
  select.innerHTML = store.users
    .filter(u => u.name !== _copyTarget)
    .map(u => `<option value="${escapeHtml(u.name)}">${escapeHtml(displayName(store, u.name))}</option>`)
    .join('');
  renderCopyPreview();
  openModal('modal-copy-groups');
  select.focus();
}

function onCopyGroupsApply(): void {
  _pinned = { target: _copyTarget, source: ($('cg-source') as HTMLSelectElement).value };
  store = applyCopyGroups(store, _copyTarget, copyPlan());
  closeModal('modal-copy-groups');
  store = setActiveTab(store, 'memberships');
  fullRender();
  showStatus('ok', fmt(L, 'copyGroupsStaged', displayName(store, _copyTarget)));
}

async function onUserDelete(ev: Event): Promise<void> {
  const btn = ev.currentTarget as HTMLElement;
  const user = btn.getAttribute('data-user') ?? '';
  const ok = await confirmModal(L.deleteUserTitle, fmt(L, 'deleteUserConfirm', user));
  if (!ok) return;
  vscode.postMessage({ type: 'deleteUser', userName: user });
}

/**
 * Take over the view of a user. The confirmation prompt says what is different afterwards:
 * this window closes together with all others of this server, and the
 * takeover is ended in the status bar. After that NO reply comes any more — the panel
 * is gone by then.
 */
async function onUserImpersonate(ev: Event): Promise<void> {
  const user = (ev.currentTarget as HTMLElement).getAttribute('data-user') ?? '';
  const label = displayName(store, user);
  const ok = await confirmModal(L.impersonateTitle, fmt(L, 'impersonateConfirm', label));
  if (!ok) return;
  vscode.postMessage({ type: 'impersonate', userName: user, label });
}

function openNewGroupModal(): void {
  ($('ng-name') as HTMLInputElement).value = '';
  $('ng-error').textContent = '';
  openModal('modal-new-group');
  ($('ng-name') as HTMLInputElement).focus();
}

function onCreateGroupSubmit(): void {
  const name = ($('ng-name') as HTMLInputElement).value.trim();
  const v = validateGroupName(name, store.groups.map(g => g.name));
  if (!v.ok) { $('ng-error').textContent = v.reason ?? L.invalidName; return; }
  vscode.postMessage({ type: 'createGroup', name });
  closeModal('modal-new-group');
}

async function onGroupDelete(ev: Event): Promise<void> {
  const btn = ev.currentTarget as HTMLElement;
  const group = btn.getAttribute('data-group') ?? '';
  const ok = await confirmModal(L.deleteGroupTitle, fmt(L, 'deleteGroupConfirm', group));
  if (!ok) return;
  vscode.postMessage({ type: 'deleteGroup', groupName: group });
}

/**
 * Populate the alias bar. If `}Clients` has no alias attributes, it stays
 * hidden — an empty dropdown would be a promise without backing.
 */
function renderAliasBar(): void {
  const row = $('alias-row');
  const sel = $('alias-select') as HTMLSelectElement;
  if (store.aliasDefs.length === 0) { row.hidden = true; return; }
  row.hidden = false;
  const opts = [`<option value="">${escapeHtml(L.optName)}</option>`]
    .concat(store.aliasDefs.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`));
  sel.innerHTML = opts.join('');
  sel.value = store.alias;
}

// --- Host messages ---

function handleHost(msg: HostToWebview): void {
  if (msg.type === 'init' || msg.type === 'refreshed') {
    const activeTab = store.activeTab;
    // The alias choice survives a reload of the lists — it affects the
    // display, not the data. With `init` the host brings it along (remembered
    // per server); the values for it arrive afterwards as a separate message.
    const carried = msg.type === 'init'
      ? { defs: msg.aliasDefs, alias: msg.alias, values: {} as Record<string, string> }
      : { defs: store.aliasDefs, alias: store.alias, values: store.aliasValues };
    store = initStore(msg.users, msg.groups, carried.defs);
    store = setActiveTab(store, activeTab);
    store = setAlias(store, carried.alias, carried.values);
    if (msg.type === 'init') {
      _impersonateOk = !msg.v12Mode;
      _self = msg.self;
      renderAliasBar();
    }
    fullRender();
    if (msg.type === 'refreshed') showStatus('ok', L.refreshed);
  } else if (msg.type === 'aliasValues') {
    store = setAlias(store, msg.alias, msg.values);
    fullRender();
  } else if (msg.type === 'userCreated') {
    showStatus('ok', fmt(L, 'userCreated', msg.user.name));
    requestRefresh();
  } else if (msg.type === 'userDeleted') {
    showStatus('ok', fmt(L, 'userDeleted', msg.userName));
    requestRefresh();
  } else if (msg.type === 'passwordSet') {
    showStatus('ok', fmt(L, 'passwordSet', msg.userName));
  } else if (msg.type === 'groupCreated') {
    showStatus('ok', fmt(L, 'groupCreated', msg.group.name));
    requestRefresh();
  } else if (msg.type === 'groupDeleted') {
    showStatus('ok', fmt(L, 'groupDeleted', msg.groupName));
    requestRefresh();
  } else if (msg.type === 'membershipsSaved') {
    if (msg.errors.length === 0) {
      showStatus('ok', fmt(L, 'membershipsSaved', msg.ok.length));
    } else {
      showStatus('error', fmt(L, 'savedPartial', msg.ok.length, msg.errors.length));
    }
    requestRefresh();
  } else if (msg.type === 'error') {
    showStatus('error', msg.message);
  }
}

function requestRefresh(): void {
  vscode.postMessage({ type: 'refresh' });
}

window.addEventListener('message', ev => handleHost(ev.data as HostToWebview));

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab-bar .tab').forEach(t => t.addEventListener('click', onTabClick));
  $('btn-refresh').addEventListener('click', () => { vscode.postMessage({ type: 'refresh' }); clearStatus(); });
  $('filter-input').addEventListener('input', ev => {
    _filter = (ev.currentTarget as HTMLInputElement).value;
    applyFilter();
  });
  $('alias-select').addEventListener('change', ev => {
    vscode.postMessage({ type: 'setAlias', alias: (ev.currentTarget as HTMLSelectElement).value });
  });
  $('nu-cancel').addEventListener('click', () => closeModal('modal-new-user'));
  $('nu-create').addEventListener('click', onCreateUserSubmit);
  // User lists run long: filterable list on top of each select (filterCombo.ts).
  for (const id of ['nu-copy-from', 'cg-source']) { mountTitleCombo($(id) as HTMLSelectElement); }
  $('nu-copy-from').addEventListener('change', ev => {
    const from = (ev.currentTarget as HTMLSelectElement).value;
    const groups = new Set(from ? stagedGroups(store, from) : []);
    $('nu-groups').querySelectorAll('input[type=checkbox]').forEach(cb => {
      (cb as HTMLInputElement).checked = groups.has((cb as HTMLInputElement).value);
    });
  });
  $('sp-cancel').addEventListener('click', () => closeModal('modal-set-password'));
  $('sp-apply').addEventListener('click', onSetPwApply);
  $('ng-cancel').addEventListener('click', () => closeModal('modal-new-group'));
  $('cg-cancel').addEventListener('click', () => closeModal('modal-copy-groups'));
  $('cg-apply').addEventListener('click', onCopyGroupsApply);
  $('cg-source').addEventListener('change', renderCopyPreview);
  document.querySelectorAll('input[name="cg-mode"]').forEach(r => r.addEventListener('change', renderCopyPreview));
  $('ng-create').addEventListener('click', onCreateGroupSubmit);
  // Enter in a modal's text field ends the dialog. Routed through the button so a
  // disabled one still refuses, and so the click handler stays the single submit path.
  for (const [field, button] of [['nu-name', 'nu-create'], ['sp-password', 'sp-apply'], ['ng-name', 'ng-create']]) {
    $(field).addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key !== 'Enter') { return; }
      ev.preventDefault();
      ($(button) as HTMLButtonElement).click();
    });
  }
  // …and Escape aborts it, from anywhere in the modal.
  for (const id of ['modal-new-user', 'modal-set-password', 'modal-new-group', 'modal-copy-groups']) {
    escCloses($(id), () => closeModal(id));
  }
  vscode.postMessage({ type: 'ready' });
});
