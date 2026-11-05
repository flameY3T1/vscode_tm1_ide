// src/commands/serverConfig/addServerCss.ts
// Styles des Add-/Edit-Server-Webinterfaces — angelehnt an serverConfigEditor.
export const ADD_SERVER_CSS = `
body{font:13px/1.4 var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:0;}
.wrap{max-width:560px;margin:0 auto;padding:20px 24px;}
h1{font-size:16px;margin:0 0 4px;}
.hint{font-size:11px;opacity:.7;margin:0 0 18px;}
.form{display:flex;flex-direction:column;gap:12px;}
.kind-switch{margin:0 0 16px;}
.section-title{font-weight:600;margin:0 0 8px;}
.detected{display:flex;align-items:center;gap:10px;margin:0 0 16px;padding:8px 10px;border:1px solid var(--vscode-focusBorder);border-radius:4px;}
#detected-text{flex:1;}
/* Add mode before detection: only the address. !important beats the inline
   display that syncForm sets on the groups. */
.wrap.awaiting #kind-switch,.wrap.awaiting #kind-hint,.wrap.awaiting .form > :not(.url-step){display:none !important;}
button.link{background:none;border:none;padding:0;color:var(--vscode-textLink-foreground);cursor:pointer;}
button.link:hover{text-decoration:underline;}
#db-pick{display:flex;flex-direction:column;gap:6px;}
.db-pick-head{display:flex;align-items:baseline;justify-content:space-between;}
.db-pick-head .section-title{margin:0;}
#db-list{display:flex;flex-direction:column;gap:2px;max-height:240px;overflow:auto;border:1px solid var(--vscode-panel-border);border-radius:4px;padding:6px 8px;}
.db-row{display:flex;align-items:center;gap:8px;cursor:pointer;}
.db-row input{accent-color:var(--vscode-focusBorder);margin:0;}
.db-row .db-off{color:var(--vscode-descriptionForeground);font-size:11px;}
/* Type tiles and sign-in choices: same radio, larger target, one line of
   explanation. The checked one carries the focus colour, not only the dot. */
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;}
.choices{display:flex;flex-direction:column;gap:6px;}
.tile{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border:1px solid var(--vscode-panel-border);border-radius:4px;cursor:pointer;}
.tile:hover{background:var(--vscode-toolbar-hoverBackground,rgba(128,128,128,.18));}
.tile:has(input:checked){border-color:var(--vscode-focusBorder);background:var(--vscode-list-inactiveSelectionBackground,rgba(128,128,128,.12));}
.tile input{accent-color:var(--vscode-focusBorder);cursor:pointer;width:14px;height:14px;margin:2px 0 0;flex:none;}
.tile-text{display:flex;flex-direction:column;gap:2px;}
.tile-desc{font-size:11px;color:var(--vscode-descriptionForeground);}
#mgmt-panel{border-top:1px solid var(--vscode-panel-border);margin-top:14px;padding-top:12px;display:flex;flex-direction:column;gap:12px;}
#mgmt-panel h2{font-size:13px;margin:0 0 4px;}
#mgmt-list{display:flex;flex-direction:column;gap:4px;margin:8px 0;}
.mgmt-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 8px;background:var(--vscode-editorWidget-background);border-radius:3px;}
.mgmt-name{font-family:var(--vscode-editor-font-family);}
#mgmt-create-row{display:flex;gap:8px;align-items:center;}
#mgmt-create-row input{
  flex:1;box-sizing:border-box;padding:5px 8px;font:inherit;
  background:var(--vscode-input-background);color:var(--vscode-input-foreground);
  border:1px solid var(--vscode-input-border, var(--vscode-panel-border));border-radius:3px;
}
#mgmt-create-row input:focus{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px;}
/* The UA stylesheet does bring hidden -> display:none, but an author
   stylesheet always beats it: .row with display:grid therefore left the row
   with the (since removed) OIDC fields visible, even though syncForm sets the attribute correctly. Backticks
   in this comment would end the surrounding template literal. */
[hidden]{display:none !important;}
.row{display:grid;grid-template-columns:160px 1fr;gap:12px;align-items:center;}
.row .lbl{opacity:.85;}
.row input[type=text],.row input[type=password],.row select{
  width:100%;box-sizing:border-box;padding:5px 8px;font:inherit;
  background:var(--vscode-input-background);color:var(--vscode-input-foreground);
  border:1px solid var(--vscode-input-border, var(--vscode-panel-border));border-radius:3px;
}
.row input:focus,.row select:focus{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px;}
.row.check{grid-template-columns:160px auto;justify-content:start;}
.row.check input[type=checkbox]{width:16px;height:16px;margin:0;accent-color:var(--vscode-focusBorder);cursor:pointer;}
.status{min-height:18px;margin:16px 0;padding:8px 10px;border-radius:4px;font-size:12px;display:none;}
.status.ok,.status.err,.status.info,.status.warn{display:block;}
.status.ok{background:var(--vscode-inputValidation-infoBackground,rgba(58,154,58,.15));border:1px solid var(--vscode-charts-green,#3a9a3a);}
.status.err{background:var(--vscode-inputValidation-errorBackground,rgba(198,40,40,.15));border:1px solid var(--vscode-inputValidation-errorBorder,#c62828);}
.status.info{background:var(--vscode-toolbar-hoverBackground,rgba(128,128,128,.18));border:1px solid var(--vscode-panel-border);opacity:.9;}
/* Security downgrade (cert verification off / insecure save declined) — must be
   visually distinct from the neutral .info notice. Theme tokens only. */
.status.warn{background:var(--vscode-inputValidation-warningBackground,rgba(191,135,0,.15));border:1px solid var(--vscode-inputValidation-warningBorder,var(--vscode-editorWarning-foreground));color:var(--vscode-inputValidation-warningForeground,var(--vscode-editorWarning-foreground));font-weight:600;}
.actions{display:flex;align-items:center;gap:8px;margin-top:8px;}
/* Button row inside a .row grid cell — without its own flex the three
   buttons stick together and carry none of the .ghost/.primary spacing. */
.btn-row{display:flex;gap:8px;}
/* The field groups are children of .form and therefore get spacing ONLY
   between each other — their own rows stuck together, while the display name
   and the server URL (direct .form children) carried 12px. Same column, same
   spacing: the groups carry the same flex layout as .form itself. */
#cred-select-group,#credentials-group,#v12-rows{display:flex;flex-direction:column;gap:12px;}
/* The credential-profile edit panel unfolds in the MIDDLE of the form. Without
   its own border it stood unseparated between the other rows and ran into
   the button row above it: nothing indicated that name/user/password belong
   to it and not to the server. Its own box with a heading. */
#cred-edit-panel{
  display:flex;flex-direction:column;gap:12px;
  border:1px solid var(--vscode-panel-border);border-radius:4px;
  padding:12px;background:var(--vscode-editorWidget-background);
}
#cred-edit-panel .panel-title{font-weight:600;}
.actions .spacer{flex:1;}
button{font:inherit;padding:5px 14px;border-radius:4px;cursor:pointer;border:1px solid transparent;}
button:disabled{opacity:.5;cursor:default;}
button.ghost{background:transparent;color:var(--vscode-foreground);border-color:var(--vscode-panel-border);}
button.ghost:hover:not(:disabled){background:var(--vscode-toolbar-hoverBackground,rgba(128,128,128,.18));}
button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground);}
button.primary:hover:not(:disabled){background:var(--vscode-button-hoverBackground);}
button.danger{background:transparent;color:var(--vscode-errorForeground,#c62828);border-color:var(--vscode-errorForeground,#c62828);}
button.danger:hover:not(:disabled){background:var(--vscode-errorForeground,#c62828);color:var(--vscode-button-foreground,#ffffff);border-color:var(--vscode-errorForeground,#c62828);}
#v12-rows{border-top:1px solid var(--vscode-panel-border);margin-top:8px;padding-top:8px;}
.field-hint{color:var(--vscode-descriptionForeground);font-size:11px;margin:2px 0 6px;}
.warn{color:var(--vscode-inputValidation-warningForeground, var(--vscode-editorWarning-foreground));border:1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground));font-size:11px;padding:4px 6px;border-radius:3px;margin:2px 0 6px;}
`;
