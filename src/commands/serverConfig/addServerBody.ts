// src/commands/serverConfig/addServerBody.ts
// Static body markup of the Add/Edit-Server webview. Rendered server-side from
// the shared l10n map (`buildAddServerL10n`) so all text is pre-translated.
import type { L10nMap } from '../../webviewClient/_shared/l10n';

export function buildAddServerBody(t: L10nMap): string {
  return `
<div class="wrap" id="wrap">
  <h1 id="heading">${t.headingAdd}</h1>
  <p class="hint">${t.hint}</p>

  <!-- The tiles pick WHAT is connected. Instance, PA as a Service and v12 are
       all kind "instance"; they only set the hidden version and auth-mode
       selects, which stay the single source of truth (index.ts#applyTile). -->
  <!-- Detection result: shown once the anonymous probe recognised the
       server; the tiles then fold away behind the link. -->
  <div class="detected" id="detected" hidden>
    <span id="detected-text"></span>
    <button id="btn-kind-change" class="link" type="button">${t.changeType}</button>
  </div>
  <div class="kind-switch" id="kind-switch">
    <div class="section-title">${t.kindQuestion}</div>
    <div class="tiles">
      <label class="tile"><input type="radio" name="kind" id="kind-instance" value="instance" checked /><span class="tile-text"><span class="tile-title">${t.kindInstance}</span><span class="tile-desc">${t.tileInstanceDesc}</span></span></label>
      <label class="tile"><input type="radio" name="kind" id="kind-saas" value="saas" /><span class="tile-text"><span class="tile-title">${t.tileSaas}</span><span class="tile-desc">${t.tileSaasDesc}</span></span></label>
      <label class="tile"><input type="radio" name="kind" id="kind-v12" value="v12" /><span class="tile-text"><span class="tile-title">${t.tileV12}</span><span class="tile-desc">${t.tileV12Desc}</span></span></label>
      <label class="tile"><input type="radio" name="kind" id="kind-admin" value="admin" /><span class="tile-text"><span class="tile-title">${t.kindAdmin}</span><span class="tile-desc">${t.tileAdminDesc}</span></span></label>
      <label class="tile"><input type="radio" name="kind" id="kind-paw" value="paw" /><span class="tile-text"><span class="tile-title">${t.kindPaw}</span><span class="tile-desc">${t.tilePawDesc}</span></span></label>
    </div>
  </div>
  <p class="hint" id="kind-hint" style="display:none">${t.kindHint}</p>

  <div class="form">
    <!-- Address first: in add mode it is the only step until the type is
         recognised (class awaiting on .wrap hides everything else). -->
    <label class="row url-step">
      <span class="lbl">${t.serverUrl}</span>
      <input id="f-url" type="text" placeholder="https://localhost:8010" autocomplete="off" />
    </label>
    <div id="url-preview" class="field-hint url-step"></div>
    <label class="row">
      <span class="lbl">${t.displayName}</span>
      <input id="f-name" type="text" placeholder="${t.namePlaceholder}" autocomplete="off" />
    </label>
    <div id="db-pick" hidden>
      <div class="db-pick-head">
        <span class="section-title" id="db-pick-title"></span>
        <span class="btn-row" id="db-pick-bulk">
          <button id="btn-db-all" class="link" type="button">${t.dbAll}</button>
          <button id="btn-db-none" class="link" type="button">${t.dbNone}</button>
        </span>
      </div>
      <div id="db-list"></div>
      <div class="field-hint" id="db-pick-mode" hidden></div>
      <div id="db-load-row" class="btn-row">
        <button id="btn-db-load" class="primary" type="button">${t.dbLoad}</button>
        <span class="field-hint">${t.dbLoadHint}</span>
      </div>
      <div class="field-hint">${t.dbPickHint}</div>
    </div>
    <div id="http-warn" class="warn" hidden></div>
    <div class="field-hint" id="url-hint">${t.urlHint}</div>
    <div class="field-hint" id="url-hint-gateway">${t.urlHintGateway}</div>
    <label class="row" id="row-paw-tenant">
      <span class="lbl">${t.tenantId}</span>
      <input id="f-paw-tenant" type="text" placeholder="ABCDEFGH1234" autocomplete="off" list="dl-paw-tenant" />
      <datalist id="dl-paw-tenant"></datalist>
    </label>
    <div id="cred-select-group">
      <label class="row">
        <span class="lbl" id="lbl-cred">${t.credLabel}</span>
        <select id="f-cred"></select>
      </label>
      <div class="row">
        <span class="lbl"></span>
        <span class="btn-row">
          <button id="btn-cred-new" class="ghost" type="button">${t.credNew}</button>
          <button id="btn-cred-edit" class="ghost" type="button">${t.credEdit}</button>
          <button id="btn-cred-del" class="ghost" type="button">${t.credDelete}</button>
        </span>
      </div>
      <div id="cred-edit-panel" style="display:none">
        <div class="panel-title" id="cred-edit-title">${t.credEditNew}</div>
        <label class="row">
          <span class="lbl">${t.credName}</span>
          <input id="f-cred-name" type="text" autocomplete="off" />
        </label>
        <label class="row">
          <span class="lbl">${t.username}</span>
          <input id="f-cred-user" type="text" autocomplete="off" />
        </label>
        <label class="row">
          <span class="lbl">${t.password}</span>
          <input id="f-cred-pass" type="password" autocomplete="new-password" />
        </label>
        <label class="row">
          <span class="lbl">${t.auth}</span>
          <select id="f-cred-auth">
            <option value="Basic">${t.authBasic}</option>
            <option value="CAM">${t.authCam}</option>
          </select>
        </label>
        <label class="row" id="row-cred-cam">
          <span class="lbl">${t.camNamespace}</span>
          <input id="f-cred-cam" type="text" autocomplete="off" />
        </label>
        <div class="actions">
          <span class="spacer"></span>
          <button id="btn-cred-cancel" class="ghost" type="button">${t.cancel}</button>
          <button id="btn-cred-save" class="primary" type="button">${t.credSaveBtn}</button>
        </div>
      </div>
    </div>
    <div id="credentials-group">
      <div id="signin">
        <div class="section-title">${t.signInQuestion}</div>
        <div class="choices">
        <label class="tile" id="si-row-basic"><input type="radio" name="signin" id="si-basic" value="auth:Basic" /><span class="tile-text"><span class="tile-title">${t.authBasic}</span><span class="tile-desc">${t.siBasicDesc}</span></span></label>
        <label class="tile" id="si-row-cam"><input type="radio" name="signin" id="si-cam" value="auth:CAM" /><span class="tile-text"><span class="tile-title">${t.authCam}</span><span class="tile-desc">${t.siCamDesc}</span></span></label>
        <label class="tile" id="si-row-integrated"><input type="radio" name="signin" id="si-integrated" value="auth:integrated" /><span class="tile-text"><span class="tile-title">${t.authIntegrated}</span><span class="tile-desc">${t.siIntegratedDesc}</span></span></label>
        <label class="tile" id="si-row-browser"><input type="radio" name="signin" id="si-browser" value="auth:browser" /><span class="tile-text"><span class="tile-title">${t.authBrowser}</span><span class="tile-desc">${t.siBrowserDesc}</span></span></label>
        <label class="tile" id="si-row-saas-browser"><input type="radio" name="signin" id="si-saas-browser" value="mode:saas-browser" /><span class="tile-text"><span class="tile-title">${t.authModeSaasBrowser}</span><span class="tile-desc">${t.siSaasBrowserDesc}</span></span></label>
        <label class="tile" id="si-row-saas"><input type="radio" name="signin" id="si-saas" value="mode:saas" /><span class="tile-text"><span class="tile-title">${t.authModeSaas}</span><span class="tile-desc">${t.siSaasDesc}</span></span></label>
        <label class="tile" id="si-row-s2s"><input type="radio" name="signin" id="si-s2s" value="mode:basic-s2s" /><span class="tile-text"><span class="tile-title">${t.authModeS2s}</span><span class="tile-desc">${t.siS2sDesc}</span></span></label>
        <label class="tile" id="si-row-native"><input type="radio" name="signin" id="si-native" value="mode:basic-native" /><span class="tile-text"><span class="tile-title">${t.authModeNative}</span><span class="tile-desc">${t.siNativeDesc}</span></span></label>
        </div>
      </div>
      <label class="row" id="row-auth" style="display:none">
        <span class="lbl">${t.auth}</span>
        <select id="f-auth">
          <option value="Basic">${t.authBasic}</option>
          <option value="CAM">${t.authCam}</option>
          <option value="integrated">${t.authIntegrated}</option>
          <option value="browser">${t.authBrowser}</option>
        </select>
      </label>
      <label class="row" id="row-cam">
        <span class="lbl">${t.camNamespace}</span>
        <input id="f-cam" type="text" placeholder="${t.camPlaceholder}" autocomplete="off" />
      </label>
      <div class="field-hint" id="hint-integrated">${t.authIntegratedHint}</div>
      <label class="row" id="row-spn">
        <span class="lbl">${t.spnLabel}</span>
        <input id="f-spn" type="text" placeholder="${t.spnPlaceholder}" autocomplete="off" />
      </label>
      <div class="field-hint" id="hint-spn">${t.spnHint}</div>
      <div class="field-hint" id="hint-browser">${t.authBrowserHint}</div>
      <label class="row" id="row-user">
        <span class="lbl" id="lbl-user">${t.username}</span>
        <input id="f-user" type="text" autocomplete="off" />
      </label>
      <label class="row" id="row-pass">
        <span class="lbl" id="lbl-pass">${t.password}</span>
        <input id="f-pass" type="password" autocomplete="new-password" />
      </label>
    </div>
    <label class="row check">
      <span class="lbl">${t.checkSsl}</span>
      <input id="f-ssl" type="checkbox" checked />
    </label>
    <div class="field-hint">${t.sslHelp}</div>
    <label class="row" id="row-version" style="display:none">
      <span class="lbl">${t.version}</span>
      <select id="f-version">
        <option value="v11">v11</option>
        <option value="v12">v12</option>
      </select>
    </label>
  </div>

  <div id="v12-rows" style="display:none">
    <label class="row">
      <span class="lbl" id="lbl-instance">${t.instance}</span>
      <input id="f-instance" type="text" placeholder="tm1" autocomplete="off" list="dl-tenant" />
      <datalist id="dl-tenant"></datalist>
    </label>
    <label class="row">
      <span class="lbl">${t.database}</span>
      <input id="f-database" type="text" placeholder="tm1db" autocomplete="off" list="dl-database" />
      <datalist id="dl-database"></datalist>
    </label>
    <label class="row" id="row-authmode" style="display:none">
      <span class="lbl">${t.authMode}</span>
      <select id="f-authmode">
        <option value="basic-s2s">${t.authModeS2s}</option>
        <option value="basic-native">${t.authModeNative}</option>
        <option value="saas">${t.authModeSaas}</option>
        <option value="saas-browser">${t.authModeSaasBrowser}</option>
      </select>
    </label>
    <div class="field-hint" id="authmode-hint"></div>
    <label class="row" id="row-tm1user">
      <span class="lbl">${t.tm1User}</span>
      <input id="f-tm1user" type="text" placeholder="admin" autocomplete="off" />
    </label>
  </div>

  <div id="status" class="status"></div>

  <div class="actions">
    <button id="btn-test" class="ghost" disabled>${t.testConn}</button>
    <button id="btn-saas-lists" class="ghost" style="display:none">${t.saasListsLoad}</button>
    <button id="btn-mgmt" class="ghost" style="display:none">${t.mgmtManage}</button>
    <button id="btn-delete" class="danger" style="display:none">${t.deleteServer}</button>
    <span class="spacer"></span>
    <button id="btn-cancel" class="ghost">${t.cancel}</button>
    <button id="btn-save" class="primary" disabled>${t.saveConnect}</button>
  </div>

  <div id="mgmt-panel" style="display:none">
    <h2>${t.mgmtTitle}</h2>
    <p class="hint">${t.mgmtHint}</p>
    <label class="row">
      <span class="lbl">${t.mgmtRootId}</span>
      <input id="f-mgmt-cid" type="text" autocomplete="off" />
    </label>
    <label class="row">
      <span class="lbl">${t.mgmtRootSecret}</span>
      <input id="f-mgmt-sec" type="password" autocomplete="new-password" />
    </label>
    <div class="actions">
      <span class="spacer"></span>
      <button id="btn-mgmt-load" class="primary">${t.mgmtLoad}</button>
    </div>
    <div id="mgmt-list"></div>
    <div class="actions" id="mgmt-create-row" style="display:none">
      <input id="f-mgmt-new" type="text" placeholder="${t.mgmtNewPlaceholder}" autocomplete="off" />
      <button id="btn-mgmt-create" class="ghost">${t.mgmtCreate}</button>
    </div>
  </div>
</div>
`;
}
