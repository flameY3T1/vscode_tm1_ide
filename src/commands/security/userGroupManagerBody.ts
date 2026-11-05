// src/commands/security/userGroupManagerBody.ts
import type { L10nMap } from '../../webviewClient/_shared/l10n';

export function buildUserGroupManagerBody(t: L10nMap): string {
  return `
<div class="header">
  <div>
    <h2>${t.heading}</h2>
    <span id="dirty-badge" class="dirty-badge">${t.unsavedMemberships}</span>
  </div>
  <div class="toolbar">
    <!-- With CAM the user name is an identifier from the directory service;
         only an alias attribute of }Clients is readable. The bar stays
         hidden as long as the dimension has no aliases at all. -->
    <input id="filter-input" class="input filter-input" type="search" placeholder="${t.filterName}">
    <label id="alias-row" class="alias-row" hidden>
      <span>${t.displayLabel}</span>
      <select id="alias-select" class="input" title="${t.aliasSelectTitle}">
        <option value="">${t.optName}</option>
      </select>
    </label>
    <button id="btn-refresh" class="secondary">${t.refresh}</button>
  </div>
</div>

<div class="tab-bar">
  <button class="tab active" data-tab="users">${t.tabUsers}</button>
  <button class="tab" data-tab="groups">${t.tabGroups}</button>
  <button class="tab" data-tab="memberships">${t.tabMemberships}</button>
</div>

<div id="tab-content"></div>

<div id="status" class="status"></div>

<!-- Modal: New User -->
<div id="modal-new-user" class="modal-bg">
  <div class="modal">
    <h3>${t.newUser}</h3>
    <div class="form-row">
      <label>${t.name}</label>
      <input id="nu-name" class="input" type="text" autocomplete="off">
    </div>
    <div class="form-row">
      <label>${t.type}</label>
      <select id="nu-type" class="input">
        <option value="User">User</option>
        <option value="Admin">Admin</option>
        <option value="SecurityAdmin">SecurityAdmin</option>
        <option value="DataAdmin">DataAdmin</option>
        <option value="OperationsAdmin">OperationsAdmin</option>
      </select>
    </div>
    <div class="form-row">
      <label>${t.password}</label>
      <input id="nu-password" class="input" type="password" autocomplete="new-password">
    </div>
    <div class="form-row">
      <label for="nu-copy-from">${t.copyGroupsFrom}</label>
      <select id="nu-copy-from" class="input"></select>
    </div>
    <div class="form-row">
      <label>${t.initialGroups}</label>
      <div id="nu-groups" class="checkboxes"></div>
    </div>
    <div class="form-error" id="nu-error"></div>
    <div class="form-actions">
      <button class="secondary" id="nu-cancel">${t.cancel}</button>
      <button id="nu-create">${t.create}</button>
    </div>
  </div>
</div>

<!-- Modal: Set Password -->
<div id="modal-set-password" class="modal-bg">
  <div class="modal">
    <h3>${t.setPasswordFor} <span id="sp-user">…</span></h3>
    <div class="form-row">
      <label>${t.newPassword}</label>
      <input id="sp-password" class="input" type="password" autocomplete="new-password">
    </div>
    <div class="form-error" id="sp-error"></div>
    <div class="form-actions">
      <button class="secondary" id="sp-cancel">${t.cancel}</button>
      <button id="sp-apply">${t.apply}</button>
    </div>
  </div>
</div>

<!-- Modal: Copy groups from another user -->
<div id="modal-copy-groups" class="modal-bg">
  <div class="modal">
    <h3>${t.copyGroupsTo} <span id="cg-user">…</span></h3>
    <div class="form-row">
      <label for="cg-source">${t.copyGroupsFrom}</label>
      <select id="cg-source" class="input"></select>
    </div>
    <div class="form-row">
      <label><input type="radio" name="cg-mode" value="replace" checked> ${t.copyGroupsReplace}</label>
      <label><input type="radio" name="cg-mode" value="add"> ${t.copyGroupsAdd}</label>
    </div>
    <div class="form-row cg-preview" id="cg-preview"></div>
    <div class="form-actions">
      <button class="secondary" id="cg-cancel">${t.cancel}</button>
      <button id="cg-apply">${t.apply}</button>
    </div>
  </div>
</div>

<!-- Modal: New Group -->
<div id="modal-new-group" class="modal-bg">
  <div class="modal">
    <h3>${t.newGroup}</h3>
    <div class="form-row">
      <label>${t.name}</label>
      <input id="ng-name" class="input" type="text" autocomplete="off">
    </div>
    <div class="form-error" id="ng-error"></div>
    <div class="form-actions">
      <button class="secondary" id="ng-cancel">${t.cancel}</button>
      <button id="ng-create">${t.create}</button>
    </div>
  </div>
</div>

<!-- Modal: Confirm -->
<!-- No #modal-confirm here: the delete confirmation is built in the client by
     _shared/confirmDialog.ts (focus trap, role=alertdialog, aria-labelledby).
     Its labels come from the same __l10n map — see L.confirm / L.cancel in
     webviewClient/securityUserGroup/index.ts#confirmModal. -->
`;
}
