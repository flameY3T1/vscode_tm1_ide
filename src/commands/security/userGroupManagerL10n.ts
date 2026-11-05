// src/commands/security/userGroupManagerL10n.ts
// Resolved UI strings for the User/Group (Security) Manager webview. The body
// markup (`buildUserGroupManagerBody`) and the client (`window.__l10n`) share this
// single map, so each English source string is translated once. Keys are stable JS
// identifiers; the `vscode.l10n.t(...)` argument is the localization key (English
// source = key, per the Phase 2 convention). DE translations live in
// `l10n/bundle.l10n.de.json`.
import * as vscode from 'vscode';
import type { L10nMap } from '../../webviewClient/_shared/l10n';

export function buildUserGroupManagerL10n(): L10nMap {
  return {
    // static body
    heading: vscode.l10n.t('TM1 Security Manager'),
    unsavedMemberships: vscode.l10n.t('unsaved membership changes'),
    refresh: vscode.l10n.t('Refresh'),
    filterName: vscode.l10n.t('Filter (name)…'),
    displayLabel: vscode.l10n.t('Display'),
    aliasSelectTitle: vscode.l10n.t('Show users under an alias attribute of }Clients'),
    optName: vscode.l10n.t('Name'),
    tabUsers: vscode.l10n.t('Users'),
    tabGroups: vscode.l10n.t('Groups'),
    tabMemberships: vscode.l10n.t('Memberships'),
    newUser: vscode.l10n.t('New User'),
    name: vscode.l10n.t('Name'),
    type: vscode.l10n.t('Type'),
    password: vscode.l10n.t('Password'),
    initialGroups: vscode.l10n.t('Initial Groups'),
    cancel: vscode.l10n.t('Cancel'),
    create: vscode.l10n.t('Create'),
    setPasswordFor: vscode.l10n.t('Set Password for'),
    newPassword: vscode.l10n.t('New Password'),
    apply: vscode.l10n.t('Apply'),
    newGroup: vscode.l10n.t('New Group'),
    confirm: vscode.l10n.t('Confirm'),
    // client runtime — tables / actions
    setPwShort: vscode.l10n.t('Set PW…'),
    impersonateShort: vscode.l10n.t('Impersonate…'),
    copyGroupsShort: vscode.l10n.t('Copy groups…'),
    copyGroupsTo: vscode.l10n.t('Copy groups to'),
    copyGroupsFrom: vscode.l10n.t('Same groups as'),
    copyFromNone: vscode.l10n.t('(none)'),
    pinTarget: vscode.l10n.t('(changed)'),
    pinSource: vscode.l10n.t('(template)'),
    copyGroupsReplace: vscode.l10n.t('Replace: exactly the same groups'),
    copyGroupsAdd: vscode.l10n.t('Add: keep the current groups'),
    copyGroupsAdds: vscode.l10n.t('Adds: {0}'),
    copyGroupsRemoves: vscode.l10n.t('Removes: {0}'),
    copyGroupsNothing: vscode.l10n.t('Nothing changes.'),
    copyGroupsStaged: vscode.l10n.t('Staged for {0}. Check and save on the Memberships tab.'),
    impersonateTitle: vscode.l10n.t('Impersonate this user?'),
    impersonateConfirm: vscode.l10n.t('You will see the data and objects as "{0}" sees them, until you end it from the status bar. Open windows for this server are closed.'),
    delete: vscode.l10n.t('Delete'),
    colType: vscode.l10n.t('Type'),
    colStatus: vscode.l10n.t('Status'),
    statusActive: vscode.l10n.t('Active'),
    statusInactive: vscode.l10n.t('Inactive'),
    colGroupCount: vscode.l10n.t('Group-Count'),
    colActions: vscode.l10n.t('Actions'),
    colMembers: vscode.l10n.t('Members'),
    yes: vscode.l10n.t('yes'),
    no: vscode.l10n.t('no'),
    systemSuffix: vscode.l10n.t('(system)'),
    newUserBtn: vscode.l10n.t('+ New User…'),
    newGroupBtn: vscode.l10n.t('+ New Group…'),
    noUsers: vscode.l10n.t('No users.'),
    noGroups: vscode.l10n.t('No groups.'),
    needUserAndGroup: vscode.l10n.t('Need at least 1 user and 1 group to manage memberships.'),
    userGroupHead: vscode.l10n.t('User \\ Group'),
    saveMemberships: vscode.l10n.t('Save Memberships'),
    revert: vscode.l10n.t('Revert'),
    // validation fallbacks
    invalidName: vscode.l10n.t('Invalid name'),
    invalidPassword: vscode.l10n.t('Invalid password'),
    // modals (confirm)
    deleteUserTitle: vscode.l10n.t('Delete User'),
    deleteGroupTitle: vscode.l10n.t('Delete Group'),
    // runtime status — `{0}`/`{1}` filled client-side
    deleteUserConfirm: vscode.l10n.t("Delete user '{0}'? All group memberships will be lost."),
    deleteGroupConfirm: vscode.l10n.t("Delete group '{0}'?"),
    refreshed: vscode.l10n.t('Refreshed'),
    userCreated: vscode.l10n.t("User '{0}' created"),
    userDeleted: vscode.l10n.t("User '{0}' deleted"),
    passwordSet: vscode.l10n.t("Password set for '{0}'"),
    groupCreated: vscode.l10n.t("Group '{0}' created"),
    groupDeleted: vscode.l10n.t("Group '{0}' deleted"),
    membershipsSaved: vscode.l10n.t('Saved {0} membership change(s)'),
    savedPartial: vscode.l10n.t('{0} saved, {1} failed'),
    // filterCombo.ts reads these three.
    selectPlaceholder: vscode.l10n.t('Select…'),
    filterElements: vscode.l10n.t('Filter by name…'),
    noMatches: vscode.l10n.t('No matches'),
  };
}
